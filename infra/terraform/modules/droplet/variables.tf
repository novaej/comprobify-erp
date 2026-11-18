variable "environment" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "DigitalOcean region: the one the environment's Postgres cluster is in, for its private network."
  type        = string
}

variable "droplet_size" {
  description = "DigitalOcean size slug."
  type        = string
}

variable "image_slug" {
  description = "A plain Ubuntu image; Docker comes from cloud-init (Marketplace images need more disk)."
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "swap_size" {
  description = "Swap file size, a backstop against a memory spike, not a substitute for sizing."
  type        = string
  default     = "2G"
}

variable "ssh_public_key" {
  description = "Public half of this environment's deploy key (one key per environment). Safe to publish."
  type        = string
}

variable "deploy_username" {
  description = "The unprivileged user the deploy logs in as: docker group, no sudo. Not a guessable name."
  type        = string
}

variable "project_name" {
  description = "Existing DigitalOcean Project to group the droplet in (looked up, never created)."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID of comprobify.com."
  type        = string
}

variable "cloudflare_zone_name" {
  description = "The zone's domain."
  type        = string
  default     = "comprobify.com"
}

variable "hostnames" {
  description = "Every hostname this environment answers on: the landing, the app, later the API."
  type        = list(string)
}

variable "manage_dns" {
  description = "Create the hostnames' records. Off while another system still owns them."
  type        = bool
  default     = true
}
