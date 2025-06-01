# Google Cloud Run service for the API orchestrator (Go/Gin)
locals {
  api_service_name = "api-service"
}

variable "python_worker_target_url" {
  description = "The target URL of the Python Worker Service. This should be the stable Cloud Run URL."
  type        = string
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
          value = google_cloud_tasks_queue.python_execution_queue.name
        }
        env {
          name  = "PYTHON_WORKER_SERVICE_URL"
          value = var.python_worker_target_url
        }
        env {
          name  = "CODE_EXECUTION_WORKER_SA_EMAIL"
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
    google_project_iam_member.api_service_project_tasks_enqueuer,
    google_artifact_registry_repository.default,
    google_service_account.api_service_sa,
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

resource "google_project_iam_member" "api_service_sa_token_creator" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/iam.serviceAccountTokenCreator"
  member   = "serviceAccount:${google_service_account.api_service_sa.email}"
}

# This is required for creating tasks on a queue that uses code_execution_worker_sa for OIDC.
resource "google_service_account_iam_member" "api_service_can_act_as_python_worker_sa" {
  provider           = google
  service_account_id = google_service_account.code_execution_worker_sa.name 
  role               = "roles/iam.serviceAccountUser"                 # Grants iam.serviceAccounts.actAs
  member             = "serviceAccount:${google_service_account.api_service_sa.email}"
} 