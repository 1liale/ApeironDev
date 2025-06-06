terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.20"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Provider for Cloudflare (managing the bucket itself)
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Provider for AWS S3 (managing R2 bucket policies like CORS)
# This is the standard way to manage R2 policies via Terraform.
provider "aws" {
  access_key = var.r2_access_key_id
  secret_key = var.r2_secret_access_key
  region     = "us-east-1" # Must be a valid AWS region, "us-east-1" is a common placeholder.

  endpoints {
    s3 = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
  }
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
  location   = "ENAM"
}

# CORS policy for the R2 bucket, managed via the AWS provider (Manually configured)
# resource "aws_s3_bucket_cors_configuration" "ide_storage_bucket_cors" {
#   provider = aws
#   bucket   = cloudflare_r2_bucket.ide_storage_bucket.name

#   cors_rule {
#     allowed_headers = ["*"]
#     allowed_methods = ["PUT", "GET", "DELETE"]
#     allowed_origins = ["https://www.apeirondev.tech", "http://localhost:8080"]
#     expose_headers  = []
#     max_age_seconds = 3000
#   }
# }

# It can be useful to output the bucket name
output "r2_bucket_name_output" {
  value       = cloudflare_r2_bucket.ide_storage_bucket.name
  description = "The name of the created R2 bucket."
} 