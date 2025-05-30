# Google Cloud Run service for the API orchestrator (Go/Gin)
locals {
  api_service_name = "api-service"
}

resource "google_cloud_run_service" "api_service" {
  provider = google
  project  = var.gcp_project_id
  name     = local.api_service_name
  location = var.gcp_region

  template {
    spec {
      service_account_name = google_service_account.api_service_sa.email
      containers {
        image = "us-east1-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.default.repository_id}/${local.api_service_name}:latest"
        ports {
          container_port = 8080
        }
        resources {
          limits = {
            memory = "256Mi"
            cpu    = "1000m"
          }
        }
        env {
          name  = "GCP_PROJECT_ID"
          value = var.gcp_project_id
        }
        env {
          name  = "GCP_REGION"
          value = var.gcp_region
        }
        env {
          name  = "CLOUD_TASKS_QUEUE_ID"
          value = google_cloud_tasks_queue.default.name
        }
        env {
          name  = "PYTHON_WORKER_SERVICE_URL"
          value = google_cloud_run_service.python_worker.status[0].url
        }
        env {
          name  = "PYTHON_WORKER_SA_EMAIL"
          value = google_service_account.code_execution_worker_sa.email
        }
        env {
          name  = "LOG_LEVEL"
          value = "info"
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [
    google_project_iam_member.api_service_datastore_user,
    google_cloud_tasks_queue_iam_member.api_service_enqueuer,
    google_artifact_registry_repository.default,
    google_service_account.api_service_sa,
    google_cloud_run_service.python_worker,
    google_service_account.code_execution_worker_sa
  ]
}

# IAM policy to allow unauthenticated invocations for the API service
resource "google_cloud_run_service_iam_member" "api_service_invoker" {
  provider = google
  project  = var.gcp_project_id
  location = var.gcp_region
  service  = local.api_service_name
  role     = "roles/run.invoker"
  member   = "allUsers"
} 