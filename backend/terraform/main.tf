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