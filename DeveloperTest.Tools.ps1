function Get-DeveloperPython {
    [CmdletBinding()]
    param([switch]$IncludeInstalled)

    $pythonCandidates = @(
        (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'),
        (Join-Path $PSScriptRoot '.runtime\python\python.exe')
    )
    if ($IncludeInstalled) {
        $pythonCandidates += @(Get-Command python.exe,python3.exe,py.exe -CommandType Application -ErrorAction SilentlyContinue |
            Where-Object { $_.Source -notlike '*\WindowsApps\*' } |
            Select-Object -ExpandProperty Source)
    }
    foreach ($pythonCandidate in ($pythonCandidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $pythonCandidate -PathType Leaf)) { continue }
        try {
            & $pythonCandidate -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) and sys.maxsize > 2**32 else 1)' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { return $pythonCandidate }
        } catch {
            Write-Verbose "Interpretador indisponivel: $pythonCandidate"
        }
    }
    return $null
}

function Test-DeveloperPythonModule {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$PythonPath,
        [Parameter(Mandatory)][ValidatePattern('^[A-Za-z_]\w*$')][string]$ModuleName
    )
    & $PythonPath -c "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('$ModuleName') is not None else 1)"
    return $LASTEXITCODE -eq 0
}

function Invoke-DeveloperPython {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$PythonPath,
        [Parameter(Mandatory)][string[]]$PythonArguments,
        [Parameter(Mandatory)][string]$FailureMessage
    )
    & $PythonPath @PythonArguments
    if ($LASTEXITCODE -ne 0) { throw "$FailureMessage (codigo $LASTEXITCODE)." }
}
