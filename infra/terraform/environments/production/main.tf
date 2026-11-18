terraform {
  required_version = ">= 1.7"
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean", version = "~> 2.40" }
    cloudflare   = { source = "cloudflare/cloudflare", version = "~> 4.0" }
    http         = { source = "hashicorp/http", version = "~> 3.4" }
  }
}

# Tokens from DIGITALOCEAN_TOKEN and CLOUDFLARE_API_TOKEN, never variables: a saved plan holds every
# variable's value, and the plan travels to the apply job as an artifact (ADR-051).
provider "digitalocean" {}

provider "cloudflare" {}

module "droplet" {
  source = "../../modules/droplet"

  environment        = "production"
  region             = var.region
  droplet_size       = var.droplet_size
  ssh_public_key     = var.ssh_public_key
  deploy_username    = var.deploy_username
  project_name       = var.project_name
  cloudflare_zone_id = var.cloudflare_zone_id
  hostnames          = var.hostnames
  manage_dns         = var.manage_dns
}
