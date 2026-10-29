output "vpc_id" {
  description = "Control-plane VPC."
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnets for API workloads."
  value       = aws_subnet.private[*].id
}

output "database_endpoint" {
  description = "Postgres endpoint (host:port)."
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}
