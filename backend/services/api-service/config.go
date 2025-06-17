package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/joho/godotenv"
	log "github.com/sirupsen/logrus"
)

// ServiceConfig represents configuration for a single service
type ServiceConfig struct {
	QueueID        string `json:"queue_id"`
	ServiceURL     string `json:"service_url"`
	ServiceAccount string `json:"service_account"`
}

// ServicesConfig represents the complete services configuration
type ServicesConfig struct {
	PythonWorker  ServiceConfig `json:"python_worker"`
	RagIndexing   ServiceConfig `json:"rag_indexing"`
	RagQuery      ServiceConfig `json:"rag_query"`
}

// AppConfig holds all configuration for the application.
type AppConfig struct {
	GCPProjectID            string
	GCPRegion               string
	Services                ServicesConfig
	FirestoreJobsCollection string
	R2AccountID             string
	R2AccessKeyID           string
	R2SecretAccessKey       string
	R2BucketName            string
	LogLevel                string
	Port                    string
}

// GetQueuePath returns the full Cloud Tasks queue path for a given queue ID
func (cfg *AppConfig) GetQueuePath(queueID string) string {
	return fmt.Sprintf("projects/%s/locations/%s/queues/%s", cfg.GCPProjectID, cfg.GCPRegion, queueID)
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() (*AppConfig, error) {
	if err := godotenv.Load(); err != nil {
		log.Info("No .env file found, using environment variables")
	}

	cfg := &AppConfig{
		// Load basic config
		GCPProjectID:            os.Getenv("GCP_PROJECT_ID"),
		GCPRegion:               os.Getenv("GCP_REGION"),
		FirestoreJobsCollection: os.Getenv("FIRESTORE_JOBS_COLLECTION"),
		R2AccountID:             os.Getenv("R2_ACCOUNT_ID"),
		R2AccessKeyID:           os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey:       os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2BucketName:            os.Getenv("R2_BUCKET_NAME"),
		LogLevel:                os.Getenv("LOG_LEVEL"),
		Port:                    os.Getenv("PORT"),
	}

	// Parse services configuration from JSON
	servicesConfigJSON := os.Getenv("SERVICES_CONFIG")
	if servicesConfigJSON == "" {
		return nil, fmt.Errorf("missing critical environment variable: SERVICES_CONFIG")
	}

	if err := json.Unmarshal([]byte(servicesConfigJSON), &cfg.Services); err != nil {
		return nil, fmt.Errorf("failed to parse SERVICES_CONFIG JSON: %w", err)
	}

	// Define which environment variables are critical
	type criticalEnvVar struct {
		Name  string
		Value string
	}

	criticalVars := []criticalEnvVar{
		{"GCP_PROJECT_ID", cfg.GCPProjectID},
		{"GCP_REGION", cfg.GCPRegion},
		{"FIRESTORE_JOBS_COLLECTION", cfg.FirestoreJobsCollection},
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

	// Validate services configuration
	if cfg.Services.PythonWorker.QueueID == "" || cfg.Services.PythonWorker.ServiceURL == "" {
		return nil, fmt.Errorf("incomplete python_worker configuration in SERVICES_CONFIG")
	}
	if cfg.Services.RagIndexing.QueueID == "" || cfg.Services.RagIndexing.ServiceURL == "" {
		return nil, fmt.Errorf("incomplete rag_indexing configuration in SERVICES_CONFIG")
	}
	if cfg.Services.RagQuery.QueueID == "" || cfg.Services.RagQuery.ServiceURL == "" {
		return nil, fmt.Errorf("incomplete rag_query configuration in SERVICES_CONFIG")
	}

	// Set defaults for non-critical fields
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info" // Default log level
	}

	if cfg.Port == "" {
		cfg.Port = "8080" // Default port
	}

	return cfg, nil
} 