# Non-secret values only (ADR-048). Staging is brought up on demand for the rehearsal and the load
# test, then destroyed (STAGING_INFRA_ENABLED).
region          = "nyc1" # the staging Postgres cluster's region
droplet_size    = "s-1vcpu-2gb"
deploy_username = "cpfydeploy3s"
project_name    = "Comprobify Staging"

cloudflare_zone_id = "7d75cca935a373030ac39b7f1ba7696c"
hostnames          = ["staging.comprobify.com", "app-staging.comprobify.com"]

# Read by the deploy workflow: what the containers may use of the 2 GB, beside the OS and Caddy.
web_memory    = "768m"
worker_memory = "512m"
worker_cpus   = "1"
