resource "hcloud_ssh_key" "admin" {
  name       = "${var.server_name}-admin"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "api" {
  name = "${var.server_name}-firewall"

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = [var.admin_ipv4_cidr]
    description = "SSH only from the administrator's trusted IPv4 address"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTP for ACME certificate issuance and HTTPS redirect"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTPS API traffic"
  }

  rule {
    direction   = "in"
    protocol    = "udp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTP/3 traffic"
  }
}

resource "hcloud_server" "api" {
  name               = var.server_name
  server_type        = var.server_type
  image              = "ubuntu-24.04"
  location           = var.location
  ssh_keys            = [hcloud_ssh_key.admin.id]
  firewall_ids        = [hcloud_firewall.api.id]

  backups             = true
  delete_protection   = true
  rebuild_protection  = true

  user_data          = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    admin_user       = var.admin_user
    ssh_public_key   = var.ssh_public_key
    admin_ipv4_cidr  = var.admin_ipv4_cidr
  })

  labels = {
    project     = "ultran"
    environment = "production"
    managed_by  = "terraform"
  }
}
