locals {
  python_worker_service_name = "python-worker-service"
}

variable "python_execution_timeout" {
  description = "Default execution timeout in seconds for Python worker"
  type        = string # Cloud Run env vars are strings
  default     = "60"
}

# Google Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "default" {
  provider      = google
  project       = var.gcp_project_id
  location      = var.gcp_region
  repository_id = "remoteide-repo" # Your Artifact Registry repo name
  description   = "Docker repository for Remote IDE services"
  format        = "DOCKER"

  cleanup_policies {
    id     = "delete-untagged-images-after-2-days"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "172800s" # 2 days in seconds
    }
  }
}

# Google Cloud Run service for the Python worker
resource "google_cloud_run_service" "python_worker" {
  provider = google
  project  = var.gcp_project_id
  name     = local.python_worker_service_name
  location = var.gcp_region

  template {
    spec {
      service_account_name = google_service_account.code_execution_worker_sa.email
      containers {
        image = "us-east1-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.default.repository_id}/${local.python_worker_service_name}:latest" # Placeholder
        ports {
          container_port = 8080
        }
        resources {
          limits = {
            memory = "512Mi"
            cpu    = "1000m" # 1 CPU core
          }
        }
        env {
          name  = "GCP_PROJECT_ID"
          value = var.gcp_project_id
        }
        env {
          name  = "FIRESTORE_JOBS_COLLECTION"
          value = var.firestore_jobs_collection
        }
        env {
          name  = "PYTHON_EXECUTION_TIMEOUT"
          value = var.python_execution_timeout
        }
        env {
          name  = "LOG_LEVEL"
          value = "INFO"
        }
        env {
          name = "R2_ACCESS_KEY_ID"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.r2_access_key_id.secret_id
              key  = "latest"
            }
          }
        }
        env {
          name = "R2_SECRET_ACCESS_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.r2_secret_access_key.secret_id
              key  = "latest"
            }
          }
        }
        env {
          name = "R2_ACCOUNT_ID"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.r2_account_id.secret_id
              key  = "latest"
            }
          }
        }
        env {
          name = "R2_BUCKET_NAME"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.r2_bucket_name.secret_id
              key  = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [
    google_artifact_registry_repository.default,
    google_service_account.code_execution_worker_sa,
    google_project_iam_member.code_execution_worker_datastore_user
  ]
}

# Output the URL of the python-worker-service
output "python_worker_service_url" {
  description = "URL of the Python Worker Service"
  value       = google_cloud_run_service.python_worker.status[0].url
} 