[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
. (Join-Path $projectDirectory 'DeveloperTest.Tools.ps1')
$scriptTokens = $null
$scriptErrors = $null
Get-ChildItem -LiteralPath $projectDirectory -File -Filter '*.ps1' | ForEach-Object {
    [Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$scriptTokens, [ref]$scriptErrors) | Out-Null
    if ($scriptErrors.Count -gt 0) { throw ('PowerShell invalido: ' + $_.Name) }
}
$selectedPython = Get-DeveloperPython
if (-not $selectedPython) { throw 'Nenhum Python valido detectado. Execute Setup-DeveloperTest.cmd.' }
if (-not (Test-DeveloperPythonModule -PythonPath $selectedPython -ModuleName 'pip')) { throw 'pip nao detectado.' }
if (Test-DeveloperPythonModule -PythonPath $selectedPython -ModuleName 'aegis_nonexistent_module') { throw 'Modulo inexistente aceito.' }
$invalidModuleRejected = $false
try { Test-DeveloperPythonModule -PythonPath $selectedPython -ModuleName 'invalid;module' | Out-Null }
catch { $invalidModuleRejected = $true }
if (-not $invalidModuleRejected) { throw 'Nome de modulo invalido aceito.' }
$nativeFailureCaught = $false
try { Invoke-DeveloperPython -PythonPath $selectedPython -PythonArguments @('-c', 'raise SystemExit(7)') -FailureMessage 'Teste de erro nativo' }
catch { $nativeFailureCaught = $_.Exception.Message.Contains('codigo 7') }
if (-not $nativeFailureCaught) { throw 'Erro nativo nao preservado.' }
Write-Output 'PowerShell: sintaxe, interpretador, validacao de modulo e propagacao de erro aprovados.'
exit 0
