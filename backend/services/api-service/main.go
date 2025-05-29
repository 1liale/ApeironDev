package main

import (
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	log "github.com/sirupsen/logrus"
)

// RequestBody struct for the /execute endpoint
type RequestBody struct {
	Code     string `json:"code" binding:"required"`
	Language string `json:"language" binding:"required"`
	Input    string `json:"input"` // Optional input field
}

// Job struct stores information about a code execution job.
// In a real application, this would be stored in a persistent database.
type Job struct {
	ID        string
	Status    string
	Output    string
	Submitted time.Time
	Finished  time.Time
}

var jobs = make(map[string]*Job) // In-memory job store

func init() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Info("No .env file found, using default or environment variables")
	}

	// Initialize logger
	log.SetFormatter(&log.JSONFormatter{})
	log.SetOutput(os.Stdout)
	logLevel, err := log.ParseLevel(os.Getenv("LOG_LEVEL"))
	if err != nil {
		logLevel = log.InfoLevel
	}
	log.SetLevel(logLevel)
}

func main() {
	r := gin.New()

	// Logger middleware
	r.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		fields := log.Fields{
			"timestamp":    param.TimeStamp.Format(time.RFC3339Nano),
			"status_code":  param.StatusCode,
			"latency_ms":   param.Latency.Milliseconds(),
			"client_ip":    param.ClientIP,
			"method":       param.Method,
			"path":         param.Path,
		}
		if param.ErrorMessage != "" {
			fields["error"] = param.ErrorMessage
		}

		logEntry := log.WithFields(fields)

		if param.StatusCode >= http.StatusInternalServerError {
			logEntry.Error("server error")
		} else if param.StatusCode >= http.StatusBadRequest {
			logEntry.Warn("client error")
		} else {
			logEntry.Info("request handled")
		}
		return ""
	}))

	// Recovery middleware recovers from any panics and writes a 500 if there was one.
	r.Use(gin.Recovery())

	// Health Check endpoint
	r.GET("/healthcheck", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Execute code endpoint
	r.POST("/execute", func(c *gin.Context) {
		var jsonBody RequestBody
		if err := c.ShouldBindJSON(&jsonBody); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		jobID := uuid.New().String()
		log.WithFields(log.Fields{"job_id": jobID, "language": jsonBody.Language, "input_present": jsonBody.Input != ""}).Info("New job received")

		// Store job (in-memory for now)
		jobs[jobID] = &Job{
			ID:        jobID,
			Status:    "pending",
			Submitted: time.Now(),
		}

		// TODO: Here you would typically send the job to Cloud Tasks
		// For now, we'll just log it.
		log.WithFields(log.Fields{"job_id": jobID, "code": jsonBody.Code, "language": jsonBody.Language, "input": jsonBody.Input}).Info("Job submitted to queue (simulated)")

		c.JSON(http.StatusOK, gin.H{"job_id": jobID})
	})

	// Get result endpoint
	r.GET("/result/:job_id", func(c *gin.Context) {
		jobID := c.Param("job_id")
		job, exists := jobs[jobID]

		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
			return
		}

		// TODO: Here you would typically fetch the result from GCS if the job is complete
		// For now, we'll simulate a completed job after a delay and update status.
		if job.Status == "pending" && time.Since(job.Submitted) > 10*time.Second { // Simulate job completion
			job.Status = "completed"
			job.Output = "//Simulated output for job " + jobID
			job.Finished = time.Now()
		}

		c.JSON(http.StatusOK, gin.H{
			"job_id":  job.ID,
			"status":  job.Status,
			"output":  job.Output,
			"submitted_at": job.Submitted.Format(time.RFC3339),
			"finished_at": func() string {
				if job.Status == "completed" {
					return job.Finished.Format(time.RFC3339)
				}
				return ""
			}(),
		})
	})

	port := os.Getenv("PORT")
	if port == "" { port = "8080" }

	log.Info("Starting server on port ", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal("Failed to start server: ", err)
	}
} 