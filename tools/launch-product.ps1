# Finds Python 3.9+ without requiring it on PATH, then starts the product.
# A Microsoft Store "python.exe" alias is ignored. If nothing usable is installed,
# a private interpreter is downloaded once into runtime\windows.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot

function Get-PythonInfo([string]$Executable, [string[]]$LeadingArgs) {
    if (-not $Executable) { return $null }
    $resolved = $Executable
    if (-not [System.IO.Path]::IsPathRooted($Executable)) {
        $command = Get-Command $Executable -ErrorAction SilentlyContinue
        if (-not $command) { return $null }
        $resolved = $command.Source
    }
    if ($resolved -match '\\Microsoft\\WindowsApps\\python(3)?\.exe$') { return $null }
    if (-not (Test-Path -LiteralPath $resolved) -and -not (Get-Command $resolved -ErrorAction SilentlyContinue)) { return $null }
    $argumentList = @()
    if ($LeadingArgs) { $argumentList += $LeadingArgs }
    $argumentList += @('-c', 'import sys; print(sys.executable); print(str(sys.version_info[0]) + chr(46) + str(sys.version_info[1]) + chr(46) + str(sys.version_info[2])); raise SystemExit(0 if (sys.version_info[0], sys.version_info[1]) >= (3, 9) else 1)')
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $resolved @argumentList 2>&1 | Where-Object { $_ -is [string] }
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous
    if ($exitCode -ne 0 -or -not $output) { return $null }
    $lines = @($output | Where-Object { $_ -and $_.ToString().Trim() })
    if ($lines.Count -lt 2) { return $null }
    $path = $lines[-2].ToString().Trim()
    $versionText = $lines[-1].ToString().Trim()
    if ($path -match '\\Microsoft\\WindowsApps\\') { return $null }
    try { $version = [version]$versionText } catch { return $null }
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    return [pscustomobject]@{ Path = $path; Version = $version }
}

function Add-Unique([System.Collections.Generic.List[string]]$Items, [string]$Path) {
    if ($Path -and (Test-Path -LiteralPath $Path) -and -not $Items.Contains($Path)) {
        $Items.Add($Path) | Out-Null
    }
}

function Find-InstalledPython {
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    $patterns = @(
        "$env:LOCALAPPDATA\Python\pythoncore-*\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
        "$env:ProgramFiles\Python3*\python.exe",
        "${env:ProgramFiles(x86)}\Python3*\python.exe",
        "$env:USERPROFILE\anaconda3\python.exe",
        "$env:USERPROFILE\miniconda3\python.exe",
        "$env:USERPROFILE\miniforge3\python.exe",
        "$env:USERPROFILE\mambaforge\python.exe",
        "$env:LOCALAPPDATA\anaconda3\python.exe",
        "$env:LOCALAPPDATA\miniconda3\python.exe",
        "$env:LOCALAPPDATA\miniforge3\python.exe",
        "$env:LOCALAPPDATA\Programs\miniconda3\python.exe",
        "$env:LOCALAPPDATA\Programs\miniforge3\python.exe"
    )
    foreach ($pattern in $patterns) {
        foreach ($match in @(Get-Item -Path $pattern -ErrorAction SilentlyContinue)) {
            Add-Unique $candidates $match.FullName
        }
    }
    $infos = New-Object System.Collections.Generic.List[object]
    $fromLauncher = Get-PythonInfo 'py' @('-3')
    if ($fromLauncher) { $infos.Add($fromLauncher) | Out-Null }
    foreach ($candidate in $candidates) {
        $info = Get-PythonInfo $candidate @()
        if ($info) { $infos.Add($info) | Out-Null }
    }
    return $infos
}

function Install-PrivatePython {
    $arch = 'amd64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
    elseif ($env:PROCESSOR_ARCHITECTURE -eq 'X86' -and -not [Environment]::Is64BitOperatingSystem) { $arch = 'win32' }
    $dest = Join-Path $Root 'runtime\windows'
    $exe = Join-Path $dest 'python.exe'
    if (Test-Path -LiteralPath $exe) {
        $existing = Get-PythonInfo $exe @()
        if ($existing) { return $existing }
    }
    Write-Host "No Python 3.9+ was found in the usual install locations."
    Write-Host "Downloading a private Python into runtime\windows. This happens once and does not change Windows settings."
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $zip = Join-Path $dest 'python-embed.zip'
    $url = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-$arch.zip"
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
    } catch {
        Write-Host "Could not download a private Python ($($_.Exception.Message))."
        Write-Host "Install Python 3.9 or newer from https://www.python.org/downloads/ and double-click start-product.cmd again."
        Write-Host "You do not need to add Python to PATH or turn off the Microsoft Store alias."
        exit 1
    } finally {
        if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
    }
    $pth = Get-ChildItem -LiteralPath $dest -Filter 'python*._pth' | Select-Object -First 1
    if (-not $pth) {
        Write-Host "The downloaded Python was incomplete. Install Python from https://www.python.org/downloads/ and double-click again."
        exit 1
    }
    $lines = @(Get-Content -LiteralPath $pth.FullName)
    if ($lines -notcontains '..\..') {
        $lines += '..\..'
        Set-Content -LiteralPath $pth.FullName -Value $lines -Encoding ascii
    }
    $ready = Get-PythonInfo $exe @()
    if (-not $ready) {
        Write-Host "The private Python could not be started. Install Python from https://www.python.org/downloads/ and double-click again."
        exit 1
    }
    return $ready
}

$installed = @(Find-InstalledPython)
if ($installed.Count -gt 0) {
    $selected = $installed | Sort-Object Version -Descending | Select-Object -First 1
} else {
    $selected = Install-PrivatePython
}

if ($env:NM_FIND_PYTHON_ONLY -eq '1') {
    Write-Output $selected.Path
    exit 0
}

Write-Host "Using Python $($selected.Version)"
$launch = Join-Path $Root 'start_product.py'
& $selected.Path -B $launch @args
exit $LASTEXITCODE
