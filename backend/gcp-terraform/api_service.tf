# Google Cloud Run service for the API orchestrator (Go/Gin)
locals {
  api_service_name = "api-service"
  
  # Centralized service configuration
  services_config = {
    python_worker = {
      queue_id        = google_cloud_tasks_queue.python_execution_queue.name
      service_url     = var.python_worker_target_url
      service_account = google_service_account.code_execution_worker_sa.email
    }
    rag_indexing = {
      queue_id        = google_cloud_tasks_queue.rag_indexing_queue.name
      service_url     = google_cloud_run_service.rag_indexing_service.status[0].url
      service_account = google_service_account.rag_indexing_sa.email
    }
    rag_query = {
      queue_id        = google_cloud_tasks_queue.rag_query_queue.name
      service_url     = google_cloud_run_service.rag_query_service.status[0].url
      service_account = google_service_account.rag_query_sa.email
    }
  }
}

variable "python_worker_target_url" {
  description = "The target URL of the Python Worker Service. This should be the stable Cloud Run URL or the URL output by its own deployment."
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
          name  = "SERVICES_CONFIG"
          value = jsonencode(local.services_config)
        }
        env {
          name  = "LOG_LEVEL"
          value = "info"
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
        env {
          name  = "FIRESTORE_JOBS_COLLECTION"
          value = var.firestore_jobs_collection
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
    google_service_account.code_execution_worker_sa,
    google_cloud_run_service.rag_indexing_service,
    google_cloud_run_service.rag_query_service
  ]
}