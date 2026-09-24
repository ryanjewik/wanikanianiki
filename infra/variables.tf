variable "region" {
  description = "AWS region. Next to the Supabase project (us-east-2, Ohio): every request is at least one database round trip."
  type        = string
  default     = "us-east-2"
}

variable "name" {
  description = "Prefix for every resource, and the Parameter Store path the secrets live under (/<name>/)."
  type        = string
  default     = "kanji-workshop"
}

variable "log_level" {
  type    = string
  default = "INFO"
}

variable "schedule_timezone" {
  description = "IANA zone the schedules below are read in. Scheduler honours DST, so 07:00 stays 07:00 locally all year."
  type        = string
  default     = "UTC"
}

variable "sync_schedule" {
  description = "How often the WaniKani sync runs. A pass that finds nothing costs one request per resource type."
  type        = string
  default     = "rate(30 minutes)"
}

variable "lessons_schedule" {
  description = "The backstop for lesson top-ups. Events do the prompt refills; this catches anything they missed."
  type        = string
  default     = "cron(0 7,19 * * ? *)"
}

variable "api_public" {
  description = "Make the API's function URL reachable by the phone. The API still demands its bearer key; see README.md for what else to weigh first."
  type        = bool
  default     = false
}
