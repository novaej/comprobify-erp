# ADR-048: one droplet per environment runs Caddy, web and worker from one image (Docker Compose);
# Postgres is a managed cluster created by hand, outside Terraform. Adapted from the previous
# system's droplet module, which ran production from September 2026.
terraform {
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean" }
    cloudflare   = { source = "cloudflare/cloudflare" }
    http         = { source = "hashicorp/http" }
  }
}

resource "digitalocean_ssh_key" "deploy" {
  name       = "comprobify-${var.environment}"
  public_key = var.ssh_public_key
}

resource "digitalocean_droplet" "this" {
  name     = "comprobify-${var.environment}"
  region   = var.region
  size     = var.droplet_size
  image    = var.image_slug
  ssh_keys = [digitalocean_ssh_key.deploy.id]
  # A resize that grows the disk can never be undone; CPU and memory only, both ways.
  resize_disk = false

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    environment     = var.environment
    deploy_username = var.deploy_username
    ssh_public_key  = var.ssh_public_key
    swap_size       = var.swap_size
  })

  # A cloud-init edit would replace the droplet (PRD 12). Rebuild on purpose with
  # `terraform apply -replace=module.droplet.digitalocean_droplet.this` (docs/deployment.md).
  lifecycle {
    ignore_changes = [user_data]
  }
}

# Its own resource, assigned below: a droplet replacement only moves the assignment, so DNS and
# the deploy secret keep the same address.
resource "digitalocean_reserved_ip" "this" {
  region = var.region
  # The assignment owns the link; without this every plan would try to clear it.
  lifecycle {
    ignore_changes = [droplet_id]
  }
}

resource "digitalocean_reserved_ip_assignment" "this" {
  ip_address = digitalocean_reserved_ip.this.ip_address
  droplet_id = digitalocean_droplet.this.id
}

# Cloudflare's ranges, fetched live so the firewall never goes stale.
data "http" "cloudflare_ipv4" {
  url = "https://www.cloudflare.com/ips-v4"
}

locals {
  cloudflare_ipv4 = compact(split("\n", data.http.cloudflare_ipv4.response_body))
}

resource "digitalocean_firewall" "this" {
  name        = "comprobify-${var.environment}"
  droplet_ids = [digitalocean_droplet.this.id]

  # Web traffic only through Cloudflare's proxy, never the droplet's address directly.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = local.cloudflare_ipv4
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = local.cloudflare_ipv4
  }
  # SSH stays open: the deploy runs from GitHub's runners, which have no fixed address. Defence is
  # key-only login as an unprivileged user, no root, fail2ban and short limits (cloud-init).
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # UDP too: DNS needs it.
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# Looked up, never created: the project is a grouping in the dashboard, and owning it would let a
# change here destroy it with whatever else it holds.
data "digitalocean_project" "this" {
  name = var.project_name
}

resource "digitalocean_project_resources" "this" {
  project   = data.digitalocean_project.this.id
  resources = [digitalocean_droplet.this.urn]
}

# One proxied record per hostname: the landing, the app, later the API (ADR-048). Off while
# another system still owns the names (production before cutover).
resource "cloudflare_record" "host" {
  for_each = var.manage_dns ? toset(var.hostnames) : toset([])

  zone_id = var.cloudflare_zone_id
  name    = each.value == var.cloudflare_zone_name ? "@" : trimsuffix(each.value, ".${var.cloudflare_zone_name}")
  type    = "A"
  content = digitalocean_reserved_ip.this.ip_address
  proxied = true
  ttl     = 1 # required with proxied
}
