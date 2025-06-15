variable "api_service_name" {
  description = "The name of the main API service."
  type        = string
  default     = "api-service"
}

variable "python_worker_service_name" {
  description = "The name of the Python worker service."
  type        = string
  default     = "python-worker-service"
}

variable "rag_indexing_service_name" {
  description = "The name of the RAG indexing service."
  type        = string
  default     = "rag-indexing-service"
}

variable "rag_query_service_name" {
  description = "The name of the RAG query service."
  type        = string
  default     = "rag-query-service"
}

variable "github_owner" {
  description = "The owner of the GitHub repository (username or organization)."
  type        = string
}

variable "github_repo_name" {
  description = "The name of the GitHub repository."
  type        = string
}

variable "github_app_installation_id" {
  description = "The installation ID of the Google Cloud Build GitHub App for the repository."
  type        = string
  sensitive   = true # This value can be sensitive
}

variable "lancedb_table_name" {
  description = "The name of the LanceDB table for vector storage."
  type        = string
  default     = "code-vectors"
} 