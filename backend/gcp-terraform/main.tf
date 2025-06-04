terraform {
  backend "gcs" {
    bucket = "remotepythonide-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

variable "gcp_project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "gcp_region" {
  description = "The GCP region for resources."
  type        = string
  default     = "us-east1"
}

variable "firestore_jobs_collection" {
  description = "Name of the Firestore collection for jobs"
  type        = string
  default     = "jobs" 
}

variable "python_execution_timeout" {
  description = "Default execution timeout in seconds for Python worker"
  type        = string # Cloud Run env vars are strings
  default     = "60"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}