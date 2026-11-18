# State in the existing comprobify-terraform-state bucket (DO Spaces, nyc3), under this repo's own
# key. Backend blocks can't take variables, so the endpoint is written out. Spaces has no STS or
# IAM, hence the skips; credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (a Spaces
# key for this repo's pipeline only).
terraform {
  backend "s3" {
    endpoints = {
      s3 = "https://nyc3.digitaloceanspaces.com"
    }
    region                      = "us-east-1" # required by the syntax, ignored by Spaces
    bucket                      = "comprobify-terraform-state"
    key                         = "production/comprobify-erp/terraform.tfstate"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}
