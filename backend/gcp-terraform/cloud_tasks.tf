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
    max_attempts       = 2
    min_backoff        = "1s"
    max_backoff        = "10s"
    max_doublings      = 2
    max_retry_duration = "3600s"
  }

  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}

# RAG Indexing Queue
resource "google_cloud_tasks_queue" "rag_indexing_queue" {
  provider = google
  project  = var.gcp_project_id
  name     = "rag-indexing-queue"
  location = var.gcp_region

  rate_limits {
    max_dispatches_per_second = 10  # Lower rate for RAG operations
    max_concurrent_dispatches = 5   # Lower concurrency for resource-intensive operations
  }

  retry_config {
    max_attempts       = 3
    min_backoff        = "5s"
    max_backoff        = "60s"
    max_doublings      = 3
    max_retry_duration = "7200s"    # 2 hours for indexing operations
  }

  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}

# RAG Query Queue
resource "google_cloud_tasks_queue" "rag_query_queue" {
  provider = google
  project  = var.gcp_project_id
  name     = "rag-query-queue"
  location = var.gcp_region

  rate_limits {
    max_dispatches_per_second = 20  # Moderate rate for queries
    max_concurrent_dispatches = 10  # Higher concurrency for user-facing queries
  }

  retry_config {
    max_attempts       = 2
    min_backoff        = "2s"
    max_backoff        = "30s"
    max_doublings      = 2
    max_retry_duration = "1800s"    # 30 minutes for queries
  }

  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}

output "python_execution_queue_name" {
  description = "Name of the dedicated Python execution Cloud Tasks queue"
  value       = google_cloud_tasks_queue.python_execution_queue.name
}

output "rag_indexing_queue_name" {
  description = "Name of the RAG indexing Cloud Tasks queue"
  value       = google_cloud_tasks_queue.rag_indexing_queue.name
}

output "rag_query_queue_name" {
  description = "Name of the RAG query Cloud Tasks queue"
  value       = google_cloud_tasks_queue.rag_query_queue.name
}