output "server_ipv4" {
  description = "Public IPv4 address. Point your API DNS A record here."
  value       = hcloud_server.api.ipv4_address
}

output "server_name" {
  value = hcloud_server.api.name
}

output "ssh_command" {
  description = "Connect using your own private key."
  value       = "ssh ${var.admin_user}@${hcloud_server.api.ipv4_address}"
}
