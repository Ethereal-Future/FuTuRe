terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — configure an S3 backend before first apply.
  # Uncomment and fill in once the state bucket exists.
  # backend "s3" {
  #   bucket         = "future-terraform-state"
  #   key            = "production/terraform.tfstate"
  #   region         = var.aws_region
  #   encrypt        = true
  #   dynamodb_table = "future-terraform-locks"
  # }
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
