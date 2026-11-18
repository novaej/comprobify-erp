output "reserved_ip" {
  description = "The stable address: DNS points at it, and the deploy's DROPLET_IP secret is it."
  value       = digitalocean_reserved_ip.this.ip_address
}

output "droplet_id" {
  value = digitalocean_droplet.this.id
}

output "dns_records" {
  description = "The records this environment manages."
  value       = [for record in cloudflare_record.host : record.hostname]
}
