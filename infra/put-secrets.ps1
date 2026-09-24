<#
.SYNOPSIS
  Copies the backend's secrets from backend/.env into Parameter Store, where the
  deployed functions read them at cold start (backend/app/parameters.py).

.DESCRIPTION
  Run it yourself, signed in with `aws login --profile kanji`:

      powershell -ExecutionPolicy Bypass -File infra\put-secrets.ps1

  It never prints a secret's value. Each one is handed to the AWS CLI through a
  temporary file that is deleted straight after, so it does not appear in this
  window, in shell history, or in the process list.

  Only what the functions use is uploaded — the WaniKani token, the database
  URL and the Anthropic key. The Supabase keys in the same .env are left behind:
  nothing deployed needs them, and a secret that is not there cannot leak.

  API_KEY — the key the phone presents — is taken from backend/.env if it is
  set there, and generated otherwise. A generated key is printed once at the end
  so it can be pasted into the app (My profile -> API key); it is the only value
  this script ever shows. Re-running is safe: parameters are overwritten, and a
  generated key is replaced, so paste the newest one.
#>
param(
  [string]$ProfileName = "kanji",
  [string]$Region = "us-east-2",
  [string]$Prefix = "/kanji-workshop/"
)

$ErrorActionPreference = "Stop"

# Mirrors infra/versions.tf: this account, and never the sumo-admin user.
$AllowedAccount = "050451388503"

$identity = aws sts get-caller-identity --profile $ProfileName --output json 2>$null | ConvertFrom-Json
if (-not $identity) {
  Write-Host "Not signed in. Run:  aws login --profile $ProfileName" -ForegroundColor Red
  exit 1
}
if ($identity.Account -ne $AllowedAccount -or $identity.Arn -like "*:user/sumo-admin") {
  Write-Host "Signed in as $($identity.Arn) - not the account this app deploys to. Stopping." -ForegroundColor Red
  exit 1
}

# Parse backend/.env: KEY=VALUE, comments and blanks skipped, split on the first
# '=' only (a database URL has more), surrounding quotes removed.
$envPath = Join-Path $PSScriptRoot "..\backend\.env"
if (-not (Test-Path $envPath)) {
  Write-Host "No backend/.env found at $envPath" -ForegroundColor Red
  exit 1
}
$values = @{}
foreach ($line in Get-Content $envPath) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
  $at = $trimmed.IndexOf("=")
  $name = $trimmed.Substring(0, $at).Trim()
  $value = $trimmed.Substring($at + 1).Trim().Trim('"').Trim("'")
  if ($value) { $values[$name] = $value }
}

$required = @("wanikani_apikey", "DATABASE_URL", "ANTHROPIC_API_KEY")
$optional = @("ANTHROPIC_WORKSPACE_ID")

$missing = $required | Where-Object { -not $values.ContainsKey($_) }
if ($missing) {
  Write-Host "backend/.env is missing: $($missing -join ', ')" -ForegroundColor Red
  exit 1
}

$generatedKey = $null
if (-not $values.ContainsKey("API_KEY")) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $generatedKey = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  $values["API_KEY"] = $generatedKey
}

$toUpload = @("API_KEY") + $required + ($optional | Where-Object { $values.ContainsKey($_) })

foreach ($name in $toUpload) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    # UTF-8 without a BOM and without a trailing newline: the CLI stores the
    # file's bytes as the value, so either would become part of the secret.
    [System.IO.File]::WriteAllText($tmp, $values[$name], (New-Object System.Text.UTF8Encoding($false)))
    aws ssm put-parameter `
      --profile $ProfileName --region $Region `
      --name "$Prefix$name" --type SecureString --overwrite `
      --value "file://$tmp" --output text --query Version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "put-parameter failed for $name" }
    Write-Host "  stored $Prefix$name" -ForegroundColor Green
  }
  finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Done: $($toUpload.Count) parameters in $Region under $Prefix."
if ($generatedKey) {
  Write-Host ""
  Write-Host "Your app's API key (shown once - paste it into My profile -> API key," -ForegroundColor Yellow
  Write-Host "and keep a copy in your password manager):" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  $generatedKey"
  Write-Host ""
}
