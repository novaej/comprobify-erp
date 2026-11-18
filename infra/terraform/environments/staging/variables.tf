# From the GitHub Environment's INFRA_SSH_PUBLIC_KEY variable: one key pair per environment.
variable "ssh_public_key" {
  type = string
}

variable "region" {
  type = string
}

variable "droplet_size" {
  type = string
}

variable "deploy_username" {
  type = string
}

variable "project_name" {
  type = string
}

variable "cloudflare_zone_id" {
  type = string
}

variable "hostnames" {
  type = list(string)
}

variable "manage_dns" {
  type    = bool
  default = true
}

# Not used by Terraform: the deploy workflow reads them from terraform.tfvars, so each
# environment's settings live in one file (ADR-048). The containers' memory and CPU limits.
variable "web_memory" {
  type = string
}

variable "worker_memory" {
  type = string
}

variable "worker_cpus" {
  type = string
}
