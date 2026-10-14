# Start PropPik 360 local stack (Node API, Vite, Go processor) — no Wrangler

$Root = "D:\Extra\proppik360"

$Platform = Join-Path $Root "tour_saas_platform"

$Processor = Join-Path $Root "tour_processor"



New-Item -ItemType Directory -Force -Path (Join-Path $Root "data") | Out-Null

New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\temp") | Out-Null

& (Join-Path $Platform "scripts\free-port-8787.ps1")
Start-Sleep -Seconds 1

Write-Host "Starting API (Node) on http://127.0.0.1:8787 ..."

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Platform'; npm run dev:api"



Start-Sleep -Seconds 3



Write-Host "Starting Frontend on http://localhost:5173 ..."

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Platform'; npm run dev:frontend"



Start-Sleep -Seconds 2



Write-Host "Starting Go processor on http://127.0.0.1:9000 ..."

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Processor'; go run ."



Write-Host ""

Write-Host "Done. Open http://localhost:5173"

Write-Host "API health: http://127.0.0.1:8787/health"

Write-Host "DB file:    D:\Extra\proppik360\data\platform.sqlite"


