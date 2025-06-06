# Python Execution Queue
resource "google_cloud_tasks_queue" "python_execution_queue" {
  provider = google
  project  = var.gcp_project_id
  name     = "python-execution-queue"
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

output "python_execution_queue_name" {
  description = "Name of the dedicated Python execution Cloud Tasks queue"
  value       = google_cloud_tasks_queue.python_execution_queue.name
}

output "api_service_sa_email" {
  description = "Email of the API Service Account"
  value       = google_service_account.api_service_sa.email
}