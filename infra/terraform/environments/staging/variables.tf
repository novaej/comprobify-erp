# Secrets come from TF_VAR_* in CI (.github/workflows/terraform.yml), never from a file.
variable "do_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_token" {
  type      = string
  sensitive = true
}

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
