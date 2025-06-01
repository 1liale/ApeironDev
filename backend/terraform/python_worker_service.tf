locals {
  python_worker_service_name = "python-worker-service"
}

# Google Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "default" {
  provider      = google
  project       = var.gcp_project_id
  location      = var.gcp_region
  repository_id = "remoteide-repo" # Your Artifact Registry repo name
  description   = "Docker repository for Remote IDE services"
  format        = "DOCKER"
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
          name  = "COLLECTION_ID_JOBS"
          value = "Job"
        }
        env {
          name = "DEFAULT_EXECUTION_TIMEOUT_SEC"
          value = "10"
        }
        env {
          name = "LOG_LEVEL"
          value = "INFO"
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