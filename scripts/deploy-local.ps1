# Deploy the built aionui-panel artifacts into the active dsh web profile.
#
# The panel is installed through the `@linxin666/dsh-web-ui-all` aggregate, so
# a `dsh plugin update` / profile reinstall restores the registry copy and
# overwrites these files. Re-run this script after any such upgrade (it keeps a
# timestamped backup of whatever it replaces).
#
# Usage (PowerShell):
#   .\scripts\deploy-local.ps1
# Or with an explicit profile root:
#   .\scripts\deploy-local.ps1 -ProfileRoot "$HOME\.dsh\profiles\web"

param(
  [string]$ProfileRoot = (Join-Path $HOME '.dsh\profiles\web')
)

$ErrorActionPreference = 'Stop'
$built = Join-Path $PSScriptRoot '..\packages\dsh-aionui-panel\lib'
$target = Join-Path $ProfileRoot 'node_modules\@linxin666\dsh-client-ui-aionui-panel\lib'

if (-not (Test-Path (Join-Path $built 'client.js'))) {
  throw "Built client not found at $built — run `pnpm --filter @linxin666/dsh-client-ui-aionui-panel build` first."
}
if (-not (Test-Path $target)) {
  throw "Installed package not found at $target — is the web profile installed?"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $PSScriptRoot "..\deploy\backup-$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null

$files = @('client.js', 'client.js.map', 'index.js')
foreach ($name in $files) {
  $src = Join-Path $built $name
  $dst = Join-Path $target $name
  if (-not (Test-Path $src)) { continue }
  if (Test-Path $dst) { Copy-Item $dst (Join-Path $backup $name) -Force }
  Copy-Item $src $dst -Force
  Write-Host "deployed $name -> $dst"
}

Write-Host ""
Write-Host "Backup kept at $backup"
Write-Host "Next: restart the dsh web process (host routes) and refresh the GUI page (client bundle)."
