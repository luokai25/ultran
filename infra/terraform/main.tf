terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # State is supplied per environment, e.g. env/prod.backend.hcl.
  # Never use local state outside a sandbox.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ultran"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name_prefix = "ultran-${var.environment}"
}

# ---------------------------------------------------------------------------
# Networking - private-by-default VPC for the control plane.
# ---------------------------------------------------------------------------
resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = var.availability_zones[count.index]
}

# ---------------------------------------------------------------------------
# Control-plane database - private subnet only, encrypted at rest.
# ---------------------------------------------------------------------------
resource "aws_db_instance" "postgres" {
  identifier        = "${local.name_prefix}-pg"
  engine            = "postgres"
  engine_version    = "16.4"
  instance_class    = var.db_instance_class
  allocated_storage = 20
  storage_encrypted = true

  db_name  = "ultran"
  username = var.db_username
  # Password is managed by the secret manager; never a .tfvars value.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  backup_retention_period = var.environment == "prod" ? 14 : 1
  deletion_protection     = var.environment == "prod"
  skip_final_snapshot     = var.environment != "prod"
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "db" {
  name        = "${local.name_prefix}-db"
  description = "Postgres ingress from within the control-plane VPC"
  vpc_id      = aws_vpc.main.id

  # TODO: restrict to the API security group once the compute module lands.
  ingress {
    description = "Postgres from within the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
