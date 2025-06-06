package main

import (
	"context"
	"fmt"
	"os"
	"time"

	// Firebase Admin SDK
	firebase "firebase.google.com/go/v4"

	cloudtasks "cloud.google.com/go/cloudtasks/apiv2"
	"cloud.google.com/go/firestore"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config" // Renamed to avoid conflict with package 'config'
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	log "github.com/sirupsen/logrus"
)

// Global variables for clients that are initialized once and used throughout.
var (
	firestoreClient *firestore.Client
	tasksClient     *cloudtasks.Client
	r2PresignClient *s3.PresignClient
	r2S3Client      *s3.Client
	firebaseApp     *firebase.App // Added for Firebase Admin SDK
)

// initializeFirebase initializes the Firebase Admin SDK.
func initializeFirebase(ctx context.Context, projectID string) error {
	conf := &firebase.Config{ProjectID: projectID}
	app, err := firebase.NewApp(ctx, conf)
	if err != nil {
		return fmt.Errorf("error initializing Firebase app: %v", err)
	}
	firebaseApp = app
	log.Info("Firebase Admin SDK initialized successfully.")
	return nil
}

// AuthMiddleware has been moved to middleware.go

func main() {
	cfg, err := LoadConfig() // Load configuration first
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Setup logger based on config
	log.SetFormatter(&log.JSONFormatter{})
	log.SetOutput(os.Stdout)
	logLevel, parseErr := log.ParseLevel(cfg.LogLevel)
	if parseErr != nil {
		log.Warnf("Invalid log level '%s', defaulting to 'info'. Error: %v", cfg.LogLevel, parseErr)
		logLevel = log.InfoLevel
	}
	log.SetLevel(logLevel)

	ctx := context.Background()

	// Initialize Firebase Admin SDK
	if err := initializeFirebase(ctx, cfg.GCPProjectID); err != nil {
		log.Fatalf("Failed to initialize Firebase Admin SDK: %v", err)
	}

	// Initialize Firestore Client
	fsClient, err := firestore.NewClient(ctx, cfg.GCPProjectID)
	if err != nil {
		log.Fatalf("Failed to create Firestore client: %v", err)
	}
	firestoreClient = fsClient

	// Initialize CloudTasks Client
	tClient, err := cloudtasks.NewClient(ctx)
	if err != nil {
		log.Fatalf("Failed to create Cloud Tasks client: %v", err)
	}
	tasksClient = tClient
	log.Info("API Service initialized with Firestore and CloudTasks clients.")

	// Initialize R2/S3 Client
	r2AwsCfg, err := awsconfig.LoadDefaultConfig(context.TODO(),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.R2AccessKeyID, cfg.R2SecretAccessKey, "")),
		awsconfig.WithRegion("auto"),
	)
	if err != nil {
		log.Fatalf("Failed to load R2 S3 configuration: %v", err)
	}

	r2S3Client = s3.NewFromConfig(r2AwsCfg, func(o *s3.Options) {
		o.EndpointResolver = s3.EndpointResolverFunc(
			func(region string, options s3.EndpointResolverOptions) (aws.Endpoint, error) {
				return aws.Endpoint{
					URL:               fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.R2AccountID),
					HostnameImmutable: true,
					SigningRegion:     "auto",
					SigningName:       "s3",
				}, nil
			})
		o.UsePathStyle = true
	})
	r2PresignClient = s3.NewPresignClient(r2S3Client)
	log.Info("R2 S3 Client initialized.")

	// Defer client closing
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

	// CORS middleware remains the same
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowAllOrigins = true
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(corsConfig))

	// Request Logging middleware remains the same
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
		if len(c.Errors) > 0 {
			logFields["error"] = c.Errors.String()
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

	apiController := NewApiController(
		firestoreClient,
		tasksClient,
		r2PresignClient,
		r2S3Client,
		cfg.R2BucketName,
		cfg.PythonWorkerURL,
		cfg.WorkerSAEmail,
		cfg.CloudTasksQueuePath,
		cfg.FirestoreJobsCollection,
	)

	authenticatedRoutes := r.Group("/api")
	authenticatedRoutes.Use(AuthMiddleware()) // No longer pass JWTSecret
	{
		// Workspace and File Sync Endpoints
		authenticatedRoutes.POST("/workspaces", apiController.CreateWorkspace)      // Changed from /workspaces/create
		authenticatedRoutes.GET("/workspaces", apiController.ListWorkspaces)          // New route for listing workspaces
		authenticatedRoutes.POST("/workspaces/:workspaceId/sync", apiController.HandleSync)
		authenticatedRoutes.POST("/workspaces/:workspaceId/sync/confirm", apiController.ConfirmSync)
		authenticatedRoutes.GET("/workspaces/:workspaceId/manifest", apiController.GetWorkspaceManifest)

		// Authenticated Code Execution
		authenticatedRoutes.POST("/workspaces/:workspaceId/execute", apiController.ExecuteCodeAuthenticated)
	}

	// Setup public routes (no auth required)
	publicRoutes := r.Group("/api")
	{
		publicRoutes.POST("/execute", apiController.ExecuteCode) // Public code execution
	}

	log.Info("Starting API server on port ", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}