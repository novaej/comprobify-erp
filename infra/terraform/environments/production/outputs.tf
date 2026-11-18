output "reserved_ip" {
  description = "Set the deploy's DROPLET_IP secret to this."
  value       = module.droplet.reserved_ip
}

output "dns_records" {
  value = module.droplet.dns_records
}
