# CI/CD Service Account for Cloud Build
resource "google_service_account" "cicd_runner" {
  provider     = google
  project      = var.gcp_project_id
  account_id   = "cloud-build-runner"
  display_name = "Cloud Build Runner Service Account"
}

# Allows the SA to manage Artifact Registry repositories
resource "google_project_iam_member" "cicd_artifact_registry_admin" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/artifactregistry.admin"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Allows the SA to manage Cloud Run services
resource "google_project_iam_member" "cicd_run_admin" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/run.admin"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Allows the SA to manage GCS objects (for Terraform state)
resource "google_project_iam_member" "cicd_storage_object_admin" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/storage.objectAdmin"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Allows Cloud Build to impersonate this Service Account
resource "google_project_iam_member" "cicd_service_account_user" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/iam.serviceAccountUser"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Allows the SA to access secrets (changed to admin for managing secrets with Terraform)
resource "google_project_iam_member" "cicd_secret_manager_admin" { # Renamed for clarity
  provider = google
  project  = var.gcp_project_id
  role     = "roles/secretmanager.admin"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Allows the SA to act as a Cloud Build builder
resource "google_project_iam_member" "cicd_cloud_build_builder" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/cloudbuild.builds.builder"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Allows the SA to manage Cloud Build connections
resource "google_project_iam_member" "cicd_cloudbuild_connection_admin" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/cloudbuild.connectionAdmin"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Grant permissions to manage project IAM policies (needed for google_project_iam_member resources)
resource "google_project_iam_member" "cicd_project_iam_admin" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/resourcemanager.projectIamAdmin"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Grant permissions to manage other Service Accounts' IAM policies
resource "google_project_iam_member" "cicd_service_account_admin" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/iam.serviceAccountAdmin"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Grant permissions for Cloud Tasks
resource "google_project_iam_member" "cicd_cloud_tasks_admin" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/cloudtasks.admin" 
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Grant permissions for Firestore
resource "google_project_iam_member" "cicd_firestore_user" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/datastore.user" # This role grants access to Firestore in Native mode
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

resource "google_project_iam_member" "cicd_firestore_index_admin" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/datastore.indexAdmin"
  member   = "serviceAccount:${google_service_account.cicd_runner.email}"
}

# Grant the default Cloud Build Service Agent access to the PAT secret
data "google_project" "project" {
  provider   = google
  project_id = var.gcp_project_id
}

# Cloud Build Trigger for Terraform apply
resource "google_cloudbuild_trigger" "terraform_apply" {
  provider    = google
  project     = var.gcp_project_id
  name        = "terraform-apply-trigger"
  description = "Triggers Terraform apply on changes to backend/gcp-terraform/**"
  location    = "global"

  github {
    owner = var.github_owner
    name  = var.github_repo_name
    pull_request {
      branch          = "^main$"
    }
  }

  included_files = ["backend/gcp-terraform/**.tf", "backend/gcp-terraform/**.tfvars", "backend/gcp-terraform/cloudbuild-tf.yaml"]
  filename = "backend/gcp-terraform/cloudbuild-tf.yaml"
  substitutions = {
    _CICD_RUNNER_SA_EMAIL = google_service_account.cicd_runner.email
  }
  service_account = "projects/${var.gcp_project_id}/serviceAccounts/${google_service_account.cicd_runner.email}"
}

# Output the email of the created CI/CD service account
output "cicd_service_account_email" {
  value       = google_service_account.cicd_runner.email
  description = "The email address of the CI/CD service account."
}

# Cloud Build Trigger for api-service build and deploy
resource "google_cloudbuild_trigger" "api_service_build_deploy" {
  provider    = google
  project     = var.gcp_project_id
  name        = "api-service-build-deploy-trigger"
  description = "Triggers build and deploy for api-service on changes to its directory"
  location    = "global"

  github {
    owner = var.github_owner
    name  = var.github_repo_name
    pull_request {
      branch          = "^main$"
    }
  }

  included_files = ["backend/services/api-service/**"]
  filename         = "backend/services/api-service/cloudbuild.yaml"
  service_account  = "projects/${var.gcp_project_id}/serviceAccounts/${google_service_account.cicd_runner.email}"

  substitutions = {
    _ARTIFACT_REGISTRY_REPO_ID = google_artifact_registry_repository.default.repository_id
    _GCP_REGION                = var.gcp_region
  }
}

# Cloud Build Trigger for python-worker-service build and deploy
resource "google_cloudbuild_trigger" "python_worker_build_deploy" {
  provider    = google
  project     = var.gcp_project_id
  name        = "python-worker-build-deploy-trigger"
  description = "Triggers build and deploy for python-worker-service on changes to its directory"
  location    = "global"

  github {
    owner = var.github_owner
    name  = var.github_repo_name
    pull_request {
      branch          = "^main$"
    }
  }

  included_files = ["backend/services/python-worker-service/**"]
  filename         = "backend/services/python-worker-service/cloudbuild.yaml"
  service_account  = "projects/${var.gcp_project_id}/serviceAccounts/${google_service_account.cicd_runner.email}"

  substitutions = {
    _ARTIFACT_REGISTRY_REPO_ID = google_artifact_registry_repository.default.repository_id
    _GCP_REGION                = var.gcp_region
  }
}

# Cloud Build Trigger for rag-query-service build and deploy
resource "google_cloudbuild_trigger" "rag_query_build_deploy" {
  project     = var.gcp_project_id
  name        = "rag-query-build-deploy-trigger"
  description = "Triggers build and deploy for rag-query-service on changes to its directory"
  location    = "global"

  github {
    owner = var.github_owner
    name  = var.github_repo_name
    pull_request {
      branch = "^main$"
    }
  }

  included_files  = ["backend/services/rag-query-service/**"]
  filename        = "backend/services/rag-query-service/cloudbuild.yaml"
  service_account = "projects/${var.gcp_project_id}/serviceAccounts/${google_service_account.cicd_runner.email}"

  substitutions = {
    _ARTIFACT_REGISTRY_REPO_ID = google_artifact_registry_repository.default.repository_id
    _GCP_REGION                = var.gcp_region
  }
}

# Cloud Build Trigger for rag-indexing-service build and deploy
resource "google_cloudbuild_trigger" "rag_indexing_service_build_deploy" {
  project     = var.gcp_project_id
  name        = "rag-indexing-build-deploy-trigger"
  description = "Triggers build and deploy for rag-indexing-service on changes to its directory"
  location    = "global"

  github {
    owner = var.github_owner
    name  = var.github_repo_name
    pull_request {
      branch = "^main$"
    }
  }

  included_files  = ["backend/services/rag-indexing-service/**"]
  filename        = "backend/services/rag-indexing-service/cloudbuild.yaml"
  service_account = "projects/${var.gcp_project_id}/serviceAccounts/${google_service_account.cicd_runner.email}"

  substitutions = {
    _ARTIFACT_REGISTRY_REPO_ID = google_artifact_registry_repository.default.repository_id
    _GCP_REGION                = var.gcp_region
  }
}