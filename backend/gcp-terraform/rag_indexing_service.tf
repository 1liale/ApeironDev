# --- RAG Indexing Service (Cloud Run) ---

# This service is private and invoked by the Go API service.
resource "google_cloud_run_service" "rag_indexing_service" {
  provider = google
  name     = var.rag_indexing_service_name
  location = var.gcp_region
  project  = var.gcp_project_id

  template {
    spec {
      service_account_name = google_service_account.rag_indexing_sa.email
      
      containers {
        image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.default.repository_id}/${var.rag_indexing_service_name}:latest"
        ports {
          container_port = 8080
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "1Gi"
          }
        }

        # Mount secrets as environment variables
        env {
          name  = "GCP_PROJECT_ID"
          value = var.gcp_project_id
        }
        env {
          name  = "GCP_REGION"
          value = var.gcp_region
        }
        env {
          name  = "LANCEDB_TABLE_NAME"
          value = var.lancedb_table_name
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
  ]
}

# IAM policy to allow invoking the service from the API service
resource "google_cloud_run_service_iam_member" "rag_indexing_service_invoker" {
  provider = google
  project  = google_cloud_run_service.rag_indexing_service.project
  location = google_cloud_run_service.rag_indexing_service.location
  service  = google_cloud_run_service.rag_indexing_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.api_service_sa.email}"
}