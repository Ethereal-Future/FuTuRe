terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state (issue #1101). Deliberately left as a *partial* backend
  # config — bucket/key/region/dynamodb_table are supplied at `terraform
  # init` time via -backend-config flags, sourced from repository variables
  # in .github/workflows/terraform-plan.yml / terraform-apply.yml, so
  # staging and production can point at different buckets/state keys
  # without editing this file. See infra/README.md "First-Time Setup" for
  # the one-time bootstrap (creating the bucket/table) and local usage.
  backend "s3" {
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "FuTuRe"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}