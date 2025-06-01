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
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	log "github.com/sirupsen/logrus"
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
// Firestore tags are used for property names.
type Job struct {
	Status              string     `firestore:"status"`
	Code                string     `firestore:"code,omitempty"`
	Language            string     `firestore:"language"`
	Input               string     `firestore:"input,omitempty"`
	SubmittedAt         time.Time  `firestore:"submitted_at"`
	ProcessingStartedAt *time.Time `firestore:"processing_started_at,omitempty"`
	CompletedAt         *time.Time `firestore:"completed_at,omitempty"`
	Output              string     `firestore:"output,omitempty"`
	Error               string     `firestore:"error,omitempty"`
	JobID               string     `firestore:"-"` // Not stored in Firestore doc, it's the doc ID
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

	pythonWorkerURL         string
	workerSAEmail   string
	firestoreJobsCollections     = "Job" // This will now be the Firestore Collection ID
)

func init() {
	if err := godotenv.Load(); err != nil {
		log.Info("No .env file found, using environment variables")
	}

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
	workerSAEmail = os.Getenv("CODE_EXECUTION_WORKER_SA_EMAIL")

	if gcpProjectID == "" || gcpRegion == "" || cloudTasksQueueID == "" || pythonWorkerURL == "" || workerSAEmail == "" {
		log.Fatal("Missing one or more critical environment variables: GCP_PROJECT_ID, GCP_REGION, CLOUD_TASKS_QUEUE_ID, PYTHON_WORKER_SERVICE_URL, CODE_EXECUTION_WORKER_SA_EMAIL")
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

	log.Info("API Service initialized with Firestore client.")
}

func main() {
	defer func() {
		if tasksClient != nil {
			if err := tasksClient.Close(); err != nil {
				log.Errorf("Failed to close CloudTasks client: %v", err)
			}
		}
		if firestoreClient != nil {
			if err := firestoreClient.Close(); err != nil {
				log.Errorf("Failed to close Firestore client: %v", err)
			}
		}
	}()

	r := gin.New()

	// Add CORS middleware
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true // Allow all origins
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(config))

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

	r.POST("/execute", func(c *gin.Context) {
		var reqBody RequestBody
		if err := c.ShouldBindJSON(&reqBody); err != nil {
			log.WithError(err).Warn("Invalid request body for /execute")
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		jobID := uuid.New().String()
		ctx := c.Request.Context()

		job := Job{
			Status:      "queued",
			Code:        reqBody.Code,
			Language:    reqBody.Language,
			Input:       reqBody.Input,
			SubmittedAt: time.Now().UTC(),
		}

		docRef := firestoreClient.Collection(firestoreJobsCollections).Doc(jobID)

		if _, err := docRef.Set(ctx, job); err != nil {
			log.WithError(err).WithField("job_id", jobID).Error("Failed to create job in Firestore")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create job record"})
			return
		}
		log.WithFields(log.Fields{"job_id": jobID, "language": job.Language}).Info("Job queued in Firestore")

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

		taskReq := &cloudtaskspb.CreateTaskRequest{
			Parent: cloudTasksQueuePath,
			Task: &cloudtaskspb.Task{
				MessageType: &cloudtaskspb.Task_HttpRequest{
					HttpRequest: &cloudtaskspb.HttpRequest{
						HttpMethod: cloudtaskspb.HttpMethod_POST,
						Url:        fmt.Sprintf("%s/execute", pythonWorkerURL),
						Headers:    map[string]string{"Content-Type": "application/json"},
						Body:       payloadBytes,
						AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
							OidcToken: &cloudtaskspb.OidcToken{
								ServiceAccountEmail: workerSAEmail,
							},
						},
					},
				},
				DispatchDeadline: durationpb.New(10 * time.Minute),
				ScheduleTime:     timestamppb.New(time.Now().UTC().Add(1 * time.Second)),
			},
		}

		createdTask, err := tasksClient.CreateTask(ctx, taskReq)
		if err != nil {
			log.WithError(err).WithField("job_id", jobID).Error("Failed to create Cloud Task")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit job for execution"})
			return
		}

		log.WithFields(log.Fields{"job_id": jobID, "task_name": createdTask.GetName()}).Info("Job enqueued to Cloud Tasks")
		c.JSON(http.StatusOK, gin.H{"job_id": jobID})
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