package main

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
	log "github.com/sirupsen/logrus"
)

// AppConfig holds all configuration for the application.
type AppConfig struct {
	GCPProjectID            string
	GCPRegion               string
	CloudTasksQueueID       string
	CloudTasksQueuePath     string
	PythonWorkerURL         string
	WorkerSAEmail           string
	FirestoreJobsCollection string
	R2AccountID             string
	R2AccessKeyID           string
	R2SecretAccessKey       string
	R2BucketName            string
	// JWTSecret               string // No longer used for Firebase Auth
	LogLevel                string
	Port                    string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() (*AppConfig, error) {
	if err := godotenv.Load(); err != nil {
		log.Info("No .env file found, using environment variables")
	}

	cfg := &AppConfig{
		// Load all values first
		GCPProjectID:            os.Getenv("GCP_PROJECT_ID"),
		GCPRegion:               os.Getenv("GCP_REGION"),
		CloudTasksQueueID:       os.Getenv("CLOUD_TASKS_QUEUE_ID"),
		PythonWorkerURL:         os.Getenv("PYTHON_WORKER_URL"),
		WorkerSAEmail:           os.Getenv("WORKER_SA_EMAIL"),
		FirestoreJobsCollection: os.Getenv("FIRESTORE_JOBS_COLLECTION"),
		R2AccountID:             os.Getenv("R2_ACCOUNT_ID"),
		R2AccessKeyID:           os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey:       os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2BucketName:            os.Getenv("R2_BUCKET_NAME"),
		// JWTSecret:               os.Getenv("JWT_SECRET"), // No longer used
		LogLevel:                os.Getenv("LOG_LEVEL"),
		Port:                    os.Getenv("PORT"),
	}

	// Define which environment variables are critical
	type criticalEnvVar struct {
		Name  string
		Value string
	}

	criticalVars := []criticalEnvVar{
		{"GCP_PROJECT_ID", cfg.GCPProjectID},
		{"GCP_REGION", cfg.GCPRegion},
		{"CLOUD_TASKS_QUEUE_ID", cfg.CloudTasksQueueID},
		{"PYTHON_WORKER_URL", cfg.PythonWorkerURL},
		{"WORKER_SA_EMAIL", cfg.WorkerSAEmail},
		{"FIRESTORE_JOBS_COLLECTION", cfg.FirestoreJobsCollection},
		// {"JWT_SECRET", cfg.JWTSecret}, // No longer used
		{"R2_ACCOUNT_ID", cfg.R2AccountID},
		{"R2_ACCESS_KEY_ID", cfg.R2AccessKeyID},
		{"R2_SECRET_ACCESS_KEY", cfg.R2SecretAccessKey},
		{"R2_BUCKET_NAME", cfg.R2BucketName},
	}

	for _, v := range criticalVars {
		if v.Value == "" {
			return nil, fmt.Errorf("missing critical environment variable: %s", v.Name)
		}
	}

	// Post-process and set defaults for non-critical or derived fields
	cfg.CloudTasksQueuePath = fmt.Sprintf("projects/%s/locations/%s/queues/%s", cfg.GCPProjectID, cfg.GCPRegion, cfg.CloudTasksQueueID)

	if cfg.FirestoreJobsCollection == "" {
		cfg.FirestoreJobsCollection = "jobs"
	}

	if cfg.LogLevel == "" {
		cfg.LogLevel = "info" // Default log level
	}

	if cfg.Port == "" {
		cfg.Port = "8080" // Default port
	}

	return cfg, nil
} 