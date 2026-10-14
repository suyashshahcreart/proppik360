# Free port 8787 for the Node API (stale Wrangler/workerd or old API instances)
Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'wrangler' } |
  ForEach-Object {
    Write-Host "Stopping wrangler node (PID $($_.ProcessId))..."
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
taskkill /IM workerd.exe /F 2>$null | Out-Null
Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  Where-Object { $_ -gt 0 } |
  ForEach-Object {
    Write-Host "Stopping process $_ on port 8787..."
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
