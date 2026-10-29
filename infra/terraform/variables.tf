variable "aws_region" {
  description = "Primary region for the control plane."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod"
  }
}

variable "availability_zones" {
  description = "Two AZs for the private subnets."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "db_instance_class" {
  description = "RDS instance class for the control-plane database."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_username" {
  description = "Master username. The password is managed by the secret manager."
  type        = string
  default     = "ultran"
}
