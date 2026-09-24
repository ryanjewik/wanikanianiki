output "api_url" {
  description = "Set this as EXPO_PUBLIC_API_URL once api_public is true; until then it only answers IAM-signed requests."
  value       = aws_lambda_function_url.api.function_url
}

output "event_bus_name" {
  value = aws_cloudwatch_event_bus.main.name
}

output "secret_path" {
  description = "Parameter Store path the functions read their secrets from."
  value       = local.secret_path
}

output "function_names" {
  value = { for key, fn in aws_lambda_function.fn : key => fn.function_name }
}
