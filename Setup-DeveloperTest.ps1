[CmdletBinding()]
param([switch]$WithTests)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'DeveloperTest.Tools.ps1')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$projectPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$runtimeDirectory = Join-Path $PSScriptRoot '.runtime'
$portableDirectory = Join-Path $runtimeDirectory 'python'
$portablePython = Join-Path $portableDirectory 'python.exe'
$downloadDirectory = Join-Path $runtimeDirectory 'downloads'

function Get-VerifiedDownload {
    param([string]$Uri, [string]$Destination, [string]$Sha256)
    if ((Test-Path -LiteralPath $Destination) -and
        (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Sha256) {
        return
    }
    $pendingDownload = $Destination + '.download'
    try {
        Invoke-WebRequest -Uri $Uri -OutFile $pendingDownload -UseBasicParsing -TimeoutSec 90
        if ((Get-FileHash -LiteralPath $pendingDownload -Algorithm SHA256).Hash -ne $Sha256) {
            throw "A verificacao de integridade falhou: $Destination"
        }
        Move-Item -LiteralPath $pendingDownload -Destination $Destination -Force
    } finally {
        if (Test-Path -LiteralPath $pendingDownload) { Remove-Item -LiteralPath $pendingDownload -Force }
    }
}

if (-not [Environment]::Is64BitOperatingSystem) { throw 'O Developer Test requer Windows e Python de 64 bits.' }
$developerPython = Get-DeveloperPython
if (-not $developerPython) {
    $installedPython = Get-DeveloperPython -IncludeInstalled
    if ($installedPython) {
        Invoke-DeveloperPython -PythonPath $installedPython -PythonArguments @('-m', 'venv', (Join-Path $PSScriptRoot '.venv')) -FailureMessage 'Nao foi possivel criar o ambiente Python'
        $developerPython = $projectPython
    } else {
        Write-Host 'Preparando Python local dentro do projeto...'
        New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
        $pythonArchive = Join-Path $downloadDirectory 'python-3.12.10-embed-amd64.zip'
        Get-VerifiedDownload -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -Destination $pythonArchive -Sha256 '4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3'
        Expand-Archive -LiteralPath $pythonArchive -DestinationPath $portableDirectory -Force
        $developerPython = $portablePython
    }
}

if ($developerPython -eq $portablePython) {
    $portablePaths = "python312.zip`n.`nLib\site-packages`n..\..`nimport site`n"
    [IO.File]::WriteAllText((Join-Path $portableDirectory 'python312._pth'), $portablePaths, (New-Object Text.UTF8Encoding($false)))
}

if (-not (Test-DeveloperPythonModule -PythonPath $developerPython -ModuleName 'pip')) {
    New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
    $pipBootstrap = Join-Path $downloadDirectory 'get-pip.py'
    Get-VerifiedDownload -Uri 'https://raw.githubusercontent.com/pypa/get-pip/af54dfe793b24685f8dc4ebba0630d9f2d77653c/public/get-pip.py' -Destination $pipBootstrap -Sha256 'FB24E693BAB954209A063D90953621412CCAD4A500905A726286E038F508DDF6'
    Invoke-DeveloperPython -PythonPath $developerPython -PythonArguments @($pipBootstrap, '--no-warn-script-location') -FailureMessage 'Nao foi possivel preparar o pip'
}

Write-Host 'Instalando dependencias do Developer Test...'
$requirementsFile = Join-Path $PSScriptRoot 'developer_test\requirements.txt'
if ($WithTests) {
    $requirementsFile = Join-Path $PSScriptRoot 'developer_test\requirements-dev.txt'
}
Invoke-DeveloperPython -PythonPath $developerPython -PythonArguments @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', '-r', $requirementsFile) -FailureMessage 'A instalacao das dependencias falhou'

Write-Host 'Preparando os modelos de IA...'
Invoke-DeveloperPython -PythonPath $developerPython -PythonArguments @('-m', 'developer_test.download_models') -FailureMessage 'O download ou a verificacao dos modelos falhou'
Write-Host 'Pronto. Execute .\Start-DeveloperTest.cmd e abra http://127.0.0.1:8765/DeveloperTest.html.'
