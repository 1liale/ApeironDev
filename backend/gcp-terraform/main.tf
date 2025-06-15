terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

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

# --- Shared Resources ---

# Google Artifact Registry repository for all service Docker images
resource "google_artifact_registry_repository" "default" {
  provider      = google
  project       = var.gcp_project_id
  location      = var.gcp_region
  repository_id = "remoteide-repo"
  description   = "Main Docker repository for all Remote IDE services"
  format        = "DOCKER"

  # cleanup_policy_dry_run = false
  # cleanup_policies {
  #   id     = "delete-untagged"
  #   action = "DELETE"
  #   condition {
  #     tag_state  = "UNTAGGED"
  #     older_than = "86400s" # 1 day in seconds
  #   }
  # }
}