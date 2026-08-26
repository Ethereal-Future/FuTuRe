# ── CloudWatch → S3 Log Archival ─────────────────────────────────────────────
# aws_cloudwatch_log_group.backend (see ecs.tf) retains logs for only
# retention_in_days = 30. This pipeline streams every log event into S3 via
# Kinesis Firehose so entries remain retrievable long after CloudWatch expires
# them, satisfying financial recordkeeping / incident-postmortem needs.

# ── S3 Archive Bucket ─────────────────────────────────────────────────────────

resource "aws_s3_bucket" "log_archive" {
  bucket = "${local.name_prefix}-log-archive"
}

resource "aws_s3_bucket_versioning" "log_archive" {
  bucket = aws_s3_bucket.log_archive.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "log_archive" {
  bucket = aws_s3_bucket.log_archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "log_archive" {
  bucket = aws_s3_bucket.log_archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "log_archive" {
  bucket = aws_s3_bucket.log_archive.id

  rule {
    id     = "archive-to-glacier"
    status = "Enabled"

    filter {}

    transition {
      days          = var.log_archive_glacier_transition_days
      storage_class = "GLACIER"
    }

    transition {
      days          = var.log_archive_deep_archive_transition_days
      storage_class = "DEEP_ARCHIVE"
    }

    expiration {
      days = var.log_archive_expiration_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.log_archive_glacier_transition_days
    }
  }
}

# ── Kinesis Firehose Delivery Stream ─────────────────────────────────────────

resource "aws_iam_role" "firehose_log_archive" {
  name = "${local.name_prefix}-firehose-log-archive-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "firehose.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "firehose_log_archive" {
  name = "${local.name_prefix}-firehose-log-archive-policy"
  role = aws_iam_role.firehose_log_archive.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
        ]
        Resource = [
          aws_s3_bucket.log_archive.arn,
          "${aws_s3_bucket.log_archive.arn}/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:PutLogEvents"]
        Resource = ["arn:aws:logs:${var.aws_region}:*:log-group:/aws/kinesisfirehose/*:*"]
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "firehose_delivery" {
  name              = "/aws/kinesisfirehose/${local.name_prefix}-log-archive"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_stream" "firehose_delivery" {
  name           = "S3Delivery"
  log_group_name = aws_cloudwatch_log_group.firehose_delivery.name
}

resource "aws_kinesis_firehose_delivery_stream" "log_archive" {
  name        = "${local.name_prefix}-log-archive"
  destination = "extended_s3"

  extended_s3_configuration {
    role_arn             = aws_iam_role.firehose_log_archive.arn
    bucket_arn           = aws_s3_bucket.log_archive.arn
    prefix               = "ecs-backend-logs/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/"
    error_output_prefix  = "ecs-backend-logs-errors/!{firehose:error-output-type}/"
    buffering_size       = 5
    buffering_interval   = 300
    compression_format   = "GZIP"

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose_delivery.name
      log_stream_name = aws_cloudwatch_log_stream.firehose_delivery.name
    }
  }
}

# ── CloudWatch Logs Subscription Filter ──────────────────────────────────────
# Streams every event written to aws_cloudwatch_log_group.backend (ecs.tf)
# into the Firehose delivery stream above.

resource "aws_iam_role" "log_subscription" {
  name = "${local.name_prefix}-log-subscription-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "logs.${var.aws_region}.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "log_subscription" {
  name = "${local.name_prefix}-log-subscription-policy"
  role = aws_iam_role.log_subscription.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["firehose:PutRecord", "firehose:PutRecordBatch"]
      Resource = [aws_kinesis_firehose_delivery_stream.log_archive.arn]
    }]
  })
}

resource "aws_cloudwatch_log_subscription_filter" "backend_to_s3" {
  name            = "${local.name_prefix}-backend-log-archive"
  log_group_name  = aws_cloudwatch_log_group.backend.name
  filter_pattern  = ""
  destination_arn = aws_kinesis_firehose_delivery_stream.log_archive.arn
  role_arn        = aws_iam_role.log_subscription.arn
}
