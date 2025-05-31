# Google Cloud Tasks Queue
resource "google_cloud_tasks_queue" "default" {
  provider = google
  project  = var.gcp_project_id
  name     = "code-execution-queue"
  location = var.gcp_region

  rate_limits {
    max_dispatches_per_second = 50
    max_concurrent_dispatches = 20
  }

  retry_config {
    max_attempts       = 3
    min_backoff        = "1s"
    max_backoff        = "10s"
    max_doublings      = 3
    max_retry_duration = "3600s"
  }

  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}

# Dedicated Service Account for api-service to enqueue tasks
resource "google_service_account" "api_service_sa" {
  provider     = google
  project      = var.gcp_project_id
  account_id   = "api-service-sa"
  display_name = "API Service Account"
}

# Allow the api-service SA to enqueue tasks to the queue
resource "google_cloud_tasks_queue_iam_member" "api_service_enqueuer" {
  provider = google
  project  = var.gcp_project_id
  location = google_cloud_tasks_queue.default.location
  name     = google_cloud_tasks_queue.default.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.api_service_sa.email}"
}

resource "google_service_account" "code_execution_worker_sa" {
  provider     = google
  project      = var.gcp_project_id
  account_id   = "code-exec-worker-sa"
  display_name = "Code Execution Worker Service Account"
}

# Grant the Cloud Tasks Service Agent permission to act as the Code Execution Worker SA
# This is required for Cloud Tasks to generate an OIDC token for the worker SA.
resource "google_service_account_iam_member" "tasks_agent_can_act_as_worker_sa" {
  provider           = google
  service_account_id = google_service_account.code_execution_worker_sa.name // The SA that will be impersonated
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-cloudtasks.iam.gserviceaccount.com" // The Cloud Tasks Service Agent
}

data "google_iam_policy" "tasks_invoker_policy" {
  provider = google
  binding {
    role = "roles/run.invoker"
    members = [
      "serviceAccount:service-${data.google_project.project.number}@gcp-sa-cloudtasks.iam.gserviceaccount.com",
    ]
  }
}

resource "google_cloud_run_service_iam_policy" "tasks_invokes_python_worker" {
  provider    = google
  project     = google_cloud_run_service.python_worker.project
  location    = google_cloud_run_service.python_worker.location
  service     = google_cloud_run_service.python_worker.name
  policy_data = data.google_iam_policy.tasks_invoker_policy.policy_data

  depends_on = [google_cloud_run_service.python_worker] 
}

output "cloud_tasks_queue_name" {
  value = google_cloud_tasks_queue.default.name
}

output "api_service_sa_email" {
  value = google_service_account.api_service_sa.email
}