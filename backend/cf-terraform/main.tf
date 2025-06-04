terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0" # It's good practice to pin to a specific major version
    }
  }
}

# Configure the Cloudflare Provider
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "cloudflare_api_token" {
  type        = string
  description = "Your Cloudflare API token."
}

# Define an input variable for the Cloudflare Account ID
variable "cloudflare_account_id" {
  type        = string
  description = "Your Cloudflare Account ID."
}

# Define an input variable for the R2 bucket name
variable "r2_bucket_name" {
  type        = string
  description = "The desired globally unique name for your R2 bucket."
  default     = "remote-ide-storage-bucket" # Consider making this more unique or removing default
}

# Cloudflare R2 Bucket for IDE Storage
resource "cloudflare_r2_bucket" "ide_storage_bucket" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name
  location   = "ENAM"
}

# It can be useful to output the bucket name
output "r2_bucket_name_output" {
  value       = cloudflare_r2_bucket.ide_storage_bucket.name
  description = "The name of the created R2 bucket."
} 