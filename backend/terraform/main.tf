terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
      version = ">= 4.34.0"
    }
  }
}

resource "random_id" "default" {
  byte_length = 8
}

resource "google_cloud_run_service" "default" {
  name = "code-execution-service-${random_id.default.hex}"
  location = "us-central1"
  template {}
}