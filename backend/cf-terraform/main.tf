terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
  }
}

# Provider for Cloudflare (managing the bucket itself)
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "cloudflare_api_token" {
  type        = string
  description = "Your Cloudflare API token."
  sensitive   = true
}

variable "cloudflare_account_id" {
  type        = string
  description = "Your Cloudflare Account ID."
}

variable "r2_access_key_id" {
  type        = string
  description = "The Access Key ID for your Cloudflare R2 API token."
  sensitive   = true
}

variable "r2_secret_access_key" {
  type        = string
  description = "The Secret Access Key for your Cloudflare R2 API token."
  sensitive   = true
}

variable "r2_bucket_name" {
  type        = string
  description = "The desired globally unique name for your R2 bucket."
  default     = "remote-ide-storage-bucket"
}

# Cloudflare R2 Bucket for IDE Storage
resource "cloudflare_r2_bucket" "ide_storage_bucket" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name
  location   = "enam"
}

resource "cloudflare_r2_bucket_cors" "ide_storage_bucket_cors" {
  account_id = var.cloudflare_account_id
  bucket_name = var.r2_bucket_name
  rules = [{
    allowed = {
      methods = ["GET", "PUT", "DELETE", "HEAD"]
      origins = ["https://www.apeirondev.tech", "http://localhost:8080"]
      headers = ["*"]
    }
    expose_headers = ["*"]
    max_age_seconds = 3000
  }]
  
  depends_on = [cloudflare_r2_bucket.ide_storage_bucket]
}

# It can be useful to output the bucket name
output "r2_bucket_name_output" {
  value       = cloudflare_r2_bucket.ide_storage_bucket.name
  description = "The name of the created R2 bucket."
} 