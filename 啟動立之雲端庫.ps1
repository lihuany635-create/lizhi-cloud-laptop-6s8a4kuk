$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodePath = $nodeCommand.Source
} else {
  $nodePath = 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $nodePath)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('找不到 Node.js，請先安裝 Node.js。','立之雲端庫') | Out-Null
  exit 1
}
$portOpen = Get-NetTCPConnection -LocalPort 4180 -State Listen -ErrorAction SilentlyContinue
if (-not $portOpen) {
  Start-Process -FilePath $nodePath -ArgumentList 'server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden
  Start-Sleep -Milliseconds 900
}
Start-Process 'http://127.0.0.1:4180'
