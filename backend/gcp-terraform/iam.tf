# --- Service Account Definitions ---

resource "google_service_account" "api_service_sa" {
  project      = var.gcp_project_id
  account_id   = "api-service-sa"
  display_name = "API Service Account"
}

resource "google_service_account" "code_execution_worker_sa" {
  project      = var.gcp_project_id
  account_id   = "code-exec-worker-sa"
  display_name = "Code Execution Worker Service Account"
}

resource "google_service_account" "rag_indexing_sa" {
  project      = var.gcp_project_id
  account_id   = "rag-indexing-service"
  display_name = "RAG Indexing Service Account"
}

resource "google_service_account" "rag_query_sa" {
  project      = var.gcp_project_id
  account_id   = "rag-query-service"
  display_name = "RAG Query Service Account"
}

# --- Secret Access Management (Dynamic) ---

# Define which service accounts need access to which secrets
locals {
  # Service accounts that need R2 access
  r2_service_accounts = {
    api_service                = google_service_account.api_service_sa.email
    code_execution_worker      = google_service_account.code_execution_worker_sa.email
    rag_indexing_service       = google_service_account.rag_indexing_sa.email
    rag_query_service          = google_service_account.rag_query_sa.email
  }

  # R2 secrets that services need access to
  r2_secrets = {
    r2_access_key_id     = google_secret_manager_secret.r2_access_key_id
    r2_secret_access_key = google_secret_manager_secret.r2_secret_access_key
    r2_account_id        = google_secret_manager_secret.r2_account_id
    r2_bucket_name       = google_secret_manager_secret.r2_bucket_name
  }

  # Create a flattened map for for_each: service_account_name.secret_name -> {service_account_email, secret}
  secret_access_pairs = {
    for pair in setproduct(keys(local.r2_service_accounts), keys(local.r2_secrets)) :
    "${pair[0]}.${pair[1]}" => {
      service_account_email = local.r2_service_accounts[pair[0]]
      secret                = local.r2_secrets[pair[1]]
    }
  }
}

# Grant secret accessor permissions using for_each
resource "google_secret_manager_secret_iam_member" "service_accounts_can_access_r2_secrets" {
  for_each  = local.secret_access_pairs
  project   = each.value.secret.project
  secret_id = each.value.secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value.service_account_email}"
}

# Grant RAG Query Service access to Cohere API key
resource "google_secret_manager_secret_iam_member" "rag_query_sa_can_access_cohere_api_key" {
  project   = google_secret_manager_secret.cohere_api_key.project
  secret_id = google_secret_manager_secret.cohere_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.rag_query_sa.email}"
}

# --- API Service (api_service_sa) Permissions ---

# (Optional) allows for tracing of API service requests
resource "google_project_iam_member" "api_service_sa_trace_agent" {
  project = var.gcp_project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.api_service_sa.email}"
}

# (Optional) allows for monitoring of API service requests
resource "google_project_iam_member" "api_service_sa_monitoring_writer" {
  project = var.gcp_project_id
  role    = "roles/monitoring.metricWriter" # For custom metrics and observability
  member  = "serviceAccount:${google_service_account.api_service_sa.email}"
}

resource "google_project_iam_member" "api_service_project_tasks_enqueuer" {
  project = var.gcp_project_id
  role    = "roles/cloudtasks.enqueuer" # Allows enqueuing to any task queue in project
  member  = "serviceAccount:${google_service_account.api_service_sa.email}"
}

# Allows api_service_sa to impersonate code_execution_worker_sa for creating OIDC tokens for tasks
resource "google_service_account_iam_member" "api_service_can_act_as_python_worker_sa" {
  service_account_id = google_service_account.code_execution_worker_sa.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api_service_sa.email}"
}

# api-service needs to read/write to Firestore (for job status and results)
resource "google_project_iam_member" "api_service_datastore_user" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/datastore.user" # Provides full access to Datastore entities
  member   = "serviceAccount:${google_service_account.api_service_sa.email}"
}

# --- Code Execution Worker (code_execution_worker_sa) Permissions ---

# Allows Cloud Tasks Service Agent to create OIDC tokens for the code_execution_worker_sa
resource "google_service_account_iam_member" "tasks_agent_can_act_as_worker_sa" {
  service_account_id = google_service_account.code_execution_worker_sa.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
}

# python-worker-service needs to write to Firestore (job output and status updates)
resource "google_project_iam_member" "code_execution_worker_datastore_user" {
  provider = google
  project  = var.gcp_project_id
  role     = "roles/datastore.user"
  member   = "serviceAccount:${google_service_account.code_execution_worker_sa.email}"
}

# --- RAG Indexing Service (rag_indexing_sa) Permissions ---

# Allow RAG indexing service to access Vertex AI embedding models
resource "google_project_iam_member" "rag_indexing_sa_aiplatform_user" {
  project = var.gcp_project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.rag_indexing_sa.email}"
}

# --- RAG Query Service (rag_query_sa) Permissions ---

# Allow RAG query service to access Vertex AI embedding models
resource "google_project_iam_member" "rag_query_sa_aiplatform_user" {
  project = var.gcp_project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.rag_query_sa.email}"
}

# --- Cloud Run Service Permissions ---

# Allows unauthenticated invocations for the API service
resource "google_cloud_run_service_iam_member" "api_service_invoker" {
  project  = var.gcp_project_id
  location = var.gcp_region
  service  = google_cloud_run_service.api_service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Allows unauthenticated invocations for the RAG Query service
resource "google_cloud_run_service_iam_member" "rag_query_service_invoker" {
  project  = var.gcp_project_id
  location = var.gcp_region
  service  = google_cloud_run_service.rag_query_service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Allows code_execution_worker_sa to invoke the Python Worker Cloud Run service
data "google_iam_policy" "tasks_invoker_policy" {
  binding {
    role = "roles/run.invoker"
    members = [
      "serviceAccount:${google_service_account.code_execution_worker_sa.email}",
    ]
  }
}

resource "google_cloud_run_service_iam_policy" "tasks_invokes_python_worker" {
  project     = google_cloud_run_service.python_worker.project
  location    = google_cloud_run_service.python_worker.location
  service     = google_cloud_run_service.python_worker.name
  policy_data = data.google_iam_policy.tasks_invoker_policy.policy_data

  depends_on = [google_cloud_run_service.python_worker]
}