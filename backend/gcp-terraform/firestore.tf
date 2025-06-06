# Google Firestore database in Native mode
resource "google_firestore_database" "default" {
  provider                 = google
  project                  = var.gcp_project_id
  name                     = "(default)"
  location_id              = var.gcp_region # Firestore location, e.g., us-east1. Cannot be changed after creation.
  type                     = "FIRESTORE_NATIVE"
  delete_protection_state  = "DELETE_PROTECTION_DISABLED"
}

variable "firestore_jobs_collection" {
  description = "Name of the Firestore collection for jobs"
  type        = string
  default     = "jobs" 
}

# Enable TTL policy on the 'expires_at' field for the 'Job' collection
resource "google_firestore_field" "job_ttl_policy" {
  project    = var.gcp_project_id
  database   = google_firestore_database.default.name
  collection = var.firestore_jobs_collection
  field      = "expires_at"

  # The ttl_config block enables the TTL policy for this field
  ttl_config {}

  # Ensure this depends on the database existing
  depends_on = [google_firestore_database.default]
}
output "firestore_database_name" {
  value = google_firestore_database.default.name
}