# Google Cloud Run service for the RAG Query Service (Python/FastAPI)
locals {
  rag_query_service_name = "rag-query-service"
}

resource "google_cloud_run_service" "rag_query_service" {
  project  = var.gcp_project_id
  name     = local.rag_query_service_name
  location = var.gcp_region

  template {
    spec {
      service_account_name = google_service_account.rag_query_sa.email
      containers {
        image = "us-east1-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.default.repository_id}/${local.rag_query_service_name}:latest"
        ports {
          container_port = 8080
        }
        resources {
          limits = {
            memory = "512Mi"
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
          name  = "LOG_LEVEL"
          value = "info"
        }
        env {
          name  = "LANCEDB_TABLE_NAME"
          value = var.lancedb_table_name
        }

        # Mount secrets as environment variables
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
          name = "COHERE_API_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.cohere_api_key.secret_id
              key  = "latest"
            }
          }
        }
        env {
          name = "GOOGLE_API_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.google_api_key.secret_id
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
    google_service_account.rag_query_sa,
    google_project_iam_member.rag_query_sa_aiplatform_user
  ]
}

output "rag_query_service_url" {
  description = "URL of the RAG Query Service"
  value       = google_cloud_run_service.rag_query_service.status[0].url
} 