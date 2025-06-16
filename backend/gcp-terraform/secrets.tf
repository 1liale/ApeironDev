# --- Secret Manager Definitions ---

# R2 Secrets (for S3 compatible storage)
resource "google_secret_manager_secret" "r2_access_key_id" {
  secret_id = "r2-access-key-id"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "r2_secret_access_key" {
  secret_id = "r2-secret-access-key"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "r2_account_id" {
  secret_id = "r2-account-id"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "r2_bucket_name" {
  secret_id = "r2-bucket-name"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "cohere_api_key" {
  secret_id = "cohere-api-key"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
} 

resource "google_secret_manager_secret" "google_api_key" {
  secret_id = "google-api-key"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
}