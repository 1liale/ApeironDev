# Google Firestore database in Native mode
resource "google_firestore_database" "default" {
  provider                 = google
  project                  = var.gcp_project_id
  name                     = "(default)"
  location_id              = var.gcp_region # Firestore location, e.g., us-east1. Cannot be changed after creation.
  type                     = "FIRESTORE_NATIVE"
  delete_protection_state  = "DELETE_PROTECTION_DISABLED"
}

# It's also good practice to grant the necessary IAM roles to your service accounts
# so they can interact with Firestore.

# api-service needs to read/write to Firestore (for job status and results)
resource "google_project_iam_member" "api_service_datastore_user" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/datastore.user" # Provides full access to Datastore entities
  member   = "serviceAccount:${google_service_account.api_service_sa.email}"
}

# python-worker-service needs to write to Firestore (job output and status updates)
resource "google_project_iam_member" "code_execution_worker_datastore_user" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/datastore.user"
  member   = "serviceAccount:${google_service_account.code_execution_worker_sa.email}"
}

output "firestore_database_name" {
  value = google_firestore_database.default.name
}