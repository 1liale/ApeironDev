package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	cloudtasks "cloud.google.com/go/cloudtasks/apiv2"
	"cloud.google.com/go/cloudtasks/apiv2/cloudtaskspb"
	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	log "github.com/sirupsen/logrus"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// RequestBody struct for the /execute endpoint
type RequestBody struct {
	Code     string `json:"code" binding:"required"`
	Language string `json:"language" binding:"required"`
	Input    string `json:"input"` // Optional input field
}

// Job struct stores information about a code execution job.
type Job struct {
	ID                  string     `firestore:"id"`
	Status              string     `firestore:"status"` // e.g., "queued", "processing", "completed", "failed"
	Code                string     `firestore:"code,omitempty"` // omitempty for potentially large fields
	Language            string     `firestore:"language"`
	Input               string     `firestore:"input,omitempty"`
	SubmittedAt         time.Time  `firestore:"submitted_at"`
	ProcessingStartedAt *time.Time `firestore:"processing_started_at,omitempty"`
	CompletedAt         *time.Time `firestore:"completed_at,omitempty"`
	Output              string     `firestore:"output,omitempty"` // Stored by the worker
	Error               string     `firestore:"error,omitempty"`  // Stored by the worker if execution fails
}

// CloudTaskPayload is the structure of the JSON payload sent to the Cloud Task
type CloudTaskPayload struct {
	JobID    string `json:"job_id"`
	Code     string `json:"code"`
	Language string `json:"language"`
	Input    string `json:"input"`
}

var (
	firestoreClient         *firestore.Client
	tasksClient             *cloudtasks.Client
	gcpProjectID            string
	gcpRegion               string // Added for Cloud Tasks queue path
	cloudTasksQueueID       string
	cloudTasksQueuePath     string

	// Initial assumption of only accessing python service
	pythonWorkerURL         string
	pythonWorkerSAEmail   string // SA for invoking the python worker
	firestoreCollectionJobs = "jobs"
)

func init() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Info("No .env file found, using environment variables")
	}

	// Initialize logger
	log.SetFormatter(&log.JSONFormatter{})
	log.SetOutput(os.Stdout)
	logLevel, err := log.ParseLevel(os.Getenv("LOG_LEVEL"))
	if err != nil {
		logLevel = log.InfoLevel
	}
	log.SetLevel(logLevel)

	gcpProjectID = os.Getenv("GCP_PROJECT_ID")
	gcpRegion = os.Getenv("GCP_REGION")
	cloudTasksQueueID = os.Getenv("CLOUD_TASKS_QUEUE_ID")
	pythonWorkerURL = os.Getenv("PYTHON_WORKER_SERVICE_URL")
	pythonWorkerSAEmail = os.Getenv("PYTHON_WORKER_SA_EMAIL")

	if gcpProjectID == "" || gcpRegion == "" || cloudTasksQueueID == "" || pythonWorkerURL == "" || pythonWorkerSAEmail == "" {
		log.Fatal("Missing one or more critical environment variables: GCP_PROJECT_ID, GCP_REGION, CLOUD_TASKS_QUEUE_ID, PYTHON_WORKER_SERVICE_URL, PYTHON_WORKER_SA_EMAIL")
	}

	cloudTasksQueuePath = fmt.Sprintf("projects/%s/locations/%s/queues/%s", gcpProjectID, gcpRegion, cloudTasksQueueID)

	ctx := context.Background()
	fsClient, err := firestore.NewClient(ctx, gcpProjectID)
	if err != nil {
		log.Fatalf("Failed to create Firestore client: %v", err)
	}
	firestoreClient = fsClient

	tClient, err := cloudtasks.NewClient(ctx)
	if err != nil {
		log.Fatalf("Failed to create Cloud Tasks client: %v", err)
	}
	tasksClient = tClient

	log.Info("API Service initialized.")
}

func main() {
	defer func() {
		if firestoreClient != nil {
			if err := firestoreClient.Close(); err != nil {
				log.Errorf("Failed to close Firestore client: %v", err)
			}
		}
		if tasksClient != nil {
			if err := tasksClient.Close(); err != nil {
				log.Errorf("Failed to close CloudTasks client: %v", err)
			}
		}
	}()

	r := gin.New()

	// Custom Logger that's less verbose than gin.Logger()
	r.Use(func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()
		method := c.Request.Method
		traceID := c.Request.Header.Get("X-Cloud-Trace-Context")

		logFields := log.Fields{
			"status_code": statusCode,
			"latency_ms":  latency.Milliseconds(),
			"client_ip":   clientIP,
			"method":      method,
			"path":        path,
			"trace_id":    traceID,
		}
		if raw != "" {
			logFields["query"] = raw
		}
		if c.Errors.ByType(gin.ErrorTypePrivate).String() != "" {
			logFields["error"] = c.Errors.ByType(gin.ErrorTypePrivate).String()
		}

		entry := log.WithFields(logFields)
		if statusCode >= 500 {
			entry.Error("Request completed with server error")
		} else if statusCode >= 400 {
			entry.Warn("Request completed with client error")
		} else {
			entry.Info("Request completed")
		}
	})

	r.GET("/healthcheck", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	r.POST("/execute", func(c *gin.Context) {
		var reqBody RequestBody
		if err := c.ShouldBindJSON(&reqBody); err != nil {
			log.WithError(err).Warn("Invalid request body for /execute")
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		jobID := uuid.New().String()
		ctx := c.Request.Context() // Use request context

		job := Job{
			ID:          jobID,
			Status:      "queued",
			Code:        reqBody.Code,
			Language:    reqBody.Language,
			Input:       reqBody.Input,
			SubmittedAt: time.Now().UTC(),
		}

		// Store initial job in Firestore
		_, err := firestoreClient.Collection(firestoreCollectionJobs).Doc(jobID).Set(ctx, job)
		if err != nil {
			log.WithError(err).WithField("job_id", jobID).Error("Failed to create job in Firestore")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create job record"})
			return
		}
		log.WithFields(log.Fields{"job_id": jobID, "language": job.Language}).Info("Job queued in Firestore")

		// Prepare payload for Cloud Tasks
		taskPayload := CloudTaskPayload{
			JobID:    jobID,
			Code:     reqBody.Code,
			Language: reqBody.Language,
			Input:    reqBody.Input,
		}
		payloadBytes, err := json.Marshal(taskPayload)
		if err != nil {
			log.WithError(err).WithField("job_id", jobID).Error("Failed to marshal task payload")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare job for execution"})
			return
		}

		// Create Cloud Task
		taskReq := &cloudtaskspb.CreateTaskRequest{
			Parent: cloudTasksQueuePath,
			Task: &cloudtaskspb.Task{
				MessageType: &cloudtaskspb.Task_HttpRequest{
					HttpRequest: &cloudtaskspb.HttpRequest{
						HttpMethod: cloudtaskspb.HttpMethod_POST,
						Url:        fmt.Sprintf("%s/execute", pythonWorkerURL), // Worker's /execute endpoint
						Headers:    map[string]string{"Content-Type": "application/json"},
						Body:       payloadBytes,
						AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
							OidcToken: &cloudtaskspb.OidcToken{
								ServiceAccountEmail: pythonWorkerSAEmail,
							},
						},
					},
				},
				DispatchDeadline: durationpb.New(10 * time.Minute),      // Corrected usage
				ScheduleTime:     timestamppb.New(time.Now().UTC().Add(1 * time.Second)), // Corrected usage, ensure UTC
			},
		}

		createdTask, err := tasksClient.CreateTask(ctx, taskReq)
		if err != nil {
			log.WithError(err).WithField("job_id", jobID).Error("Failed to create Cloud Task")
			// Potentially try to update Firestore status to "failed_to_queue" or similar
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit job for execution"})
			return
		}

		log.WithFields(log.Fields{"job_id": jobID, "task_name": createdTask.GetName()}).Info("Job enqueued to Cloud Tasks")
		c.JSON(http.StatusOK, gin.H{"job_id": jobID})
	})

	r.GET("/result/:job_id", func(c *gin.Context) {
		jobID := c.Param("job_id")
		ctx := c.Request.Context()

		doc, err := firestoreClient.Collection(firestoreCollectionJobs).Doc(jobID).Get(ctx)
		if err != nil {
			st, ok := status.FromError(err)
			if ok && st.Code() == codes.NotFound {
				log.WithField("job_id", jobID).Info("Job not found")
				c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
				return
			}
			// If it's not a NotFound error, or not a gRPC status error, log it as a server error.
			log.WithError(err).WithField("job_id", jobID).Error("Failed to retrieve job from Firestore")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve job status"})
			return
		}

		var job Job
		if err := doc.DataTo(&job); err != nil {
			log.WithError(err).WithField("job_id", jobID).Error("Failed to parse job data from Firestore")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse job data"})
			return
		}

		log.WithFields(log.Fields{"job_id": jobID, "status": job.Status}).Info("Job result retrieved")
		c.JSON(http.StatusOK, job) // Return the whole job object
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Info("Starting API server on port ", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
} 