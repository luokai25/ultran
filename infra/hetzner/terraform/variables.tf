variable "server_name" {
  description = "Hetzner server name."
  type        = string
  default     = "ultran-api"
}

variable "server_type" {
  description = "Hetzner server type. cx23 is a modest API-only starting point."
  type        = string
  default     = "cx23"
}

variable "location" {
  description = "Hetzner location, selected for latency and availability."
  type        = string
  default     = "nbg1"
}

variable "admin_ipv4_cidr" {
  description = "Your trusted public IPv4 CIDR for SSH, e.g. 203.0.113.10/32."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.admin_ipv4_cidr))
    error_message = "admin_ipv4_cidr must be a valid IPv4 CIDR."
  }
}

variable "ssh_public_key" {
  description = "Public SSH key for the non-root operator account. Never provide a private key."
  type        = string

  validation {
    condition     = can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) ", var.ssh_public_key))
    error_message = "ssh_public_key must be an OpenSSH public key."
  }
}

variable "admin_user" {
  description = "Non-root Linux operator account."
  type        = string
  default     = "ultranops"

  validation {
    condition     = can(regex("^[a-z_][a-z0-9_-]{0,30}$", var.admin_user))
    error_message = "admin_user must be a valid simple Linux username."
  }
}
