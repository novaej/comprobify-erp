# Non-secret values only (ADR-048). Staging is brought up on demand for the rehearsal and the load
# test, then destroyed (STAGING_INFRA_ENABLED).
region          = "nyc1" # the staging Postgres cluster's region
droplet_size    = "s-1vcpu-2gb"
deploy_username = "cpfyerpdeploy3s"
project_name    = "Comprobify Staging"

cloudflare_zone_id = "7d75cca935a373030ac39b7f1ba7696c"
hostnames          = ["staging.comprobify.com", "app-staging.comprobify.com"]
