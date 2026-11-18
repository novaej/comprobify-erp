# Non-secret values only (ADR-048). 1 vCPU / 2 GB to start, like staging; resized in place when
# the load test or real traffic asks for more (PRD 12 planned 2 vCPU / 4 GB).
region          = "nyc1" # the production Postgres cluster's region
droplet_size    = "s-1vcpu-2gb"
deploy_username = "cpfydeploy8p"
project_name    = "Comprobify Production"

cloudflare_zone_id = "7d75cca935a373030ac39b7f1ba7696c"
# api.comprobify.com joins with the public API (Milestone 11+).
hostnames = ["comprobify.com", "app.comprobify.com"]
# The previous system's records were deleted with it, so the ERP creates its own.
manage_dns = true

# Read by the deploy workflow: what the containers may use of the 2 GB, beside the OS and Caddy.
web_memory    = "768m"
worker_memory = "512m"
worker_cpus   = "1"
