# Non-secret values only (ADR-048). PRD 12: 2 vCPU / 4 GB to start.
region          = "nyc1" # the production Postgres cluster's region
droplet_size    = "s-2vcpu-4gb"
deploy_username = "cpfyerpdeploy8p"
project_name    = "Comprobify Production"

cloudflare_zone_id = "7d75cca935a373030ac39b7f1ba7696c"
# api.comprobify.com joins with the public API (Milestone 11+).
hostnames = ["comprobify.com", "app.comprobify.com"]
# Off until cutover: comprobify-web's Terraform owns these records until it releases them.
manage_dns = false
