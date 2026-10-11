[CmdletBinding()]
param([ValidateRange(1024, 65535)][int]$Port = 8765)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'DeveloperTest.Tools.ps1')

try {
    $runningService = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/dev/health" -TimeoutSec 2
} catch {
    $runningService = $null
}
if ($runningService.model.detector -eq 'YuNet' -and $runningService.model.recognizer -eq 'SFace') {
    Write-Host "Developer Test ja iniciado: http://127.0.0.1:$Port/DeveloperTest.html"
    return
}

$developerPython = Get-DeveloperPython
if (-not $developerPython) { throw 'Execute .\Setup-DeveloperTest.cmd para preparar Python 3.12 de 64 bits.' }

Invoke-DeveloperPython -PythonPath $developerPython -PythonArguments @('-c', 'import cv2, fastapi, uvicorn, python_multipart, PIL') -FailureMessage 'Dependencias incompletas. Execute .\Setup-DeveloperTest.cmd'
Write-Host "Developer Test: http://127.0.0.1:$Port/DeveloperTest.html"
Write-Host 'Pressione Ctrl+C para encerrar o servico.'
Invoke-DeveloperPython -PythonPath $developerPython -PythonArguments @('-m', 'developer_test.app', '--port', [string]$Port) -FailureMessage 'O servico encerrou com erro'
