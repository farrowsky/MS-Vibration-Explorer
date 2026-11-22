# MS Vibration Explorer launcher (Windows). Started by "MS Vibration Explorer.bat".
#
# 1. finds Python 3.12+ (MSVE_PYTHON, py launcher, python, Anaconda/Miniconda, python.org installs)
# 2. installs the requirements only if they are missing
# 3. starts the server in the background and waits until it answers
# 4. opens the tool in its own app window (Edge or Chrome, no address bar or tabs)
# 5. stops the server when that window is closed
param([int]$Port = 8000, [switch]$NoWindow)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$Url = "http://localhost:$Port/"
$Health = "http://127.0.0.1:$Port/api/health"

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

function Test-Up {
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri $Health -TimeoutSec 2; return $r.StatusCode -eq 200 }
    catch { return $false }
}

function Find-Python {
    $cands = New-Object System.Collections.ArrayList
    if ($env:MSVE_PYTHON) { [void]$cands.Add(@($env:MSVE_PYTHON)) }
    [void]$cands.Add(@('py', '-3'))
    [void]$cands.Add(@('python'))
    foreach ($p in @("$env:USERPROFILE\anaconda3\python.exe", "$env:USERPROFILE\miniconda3\python.exe",
                     "$env:ProgramData\anaconda3\python.exe", "$env:ProgramData\miniconda3\python.exe")) {
        [void]$cands.Add(@($p))
    }
    Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | ForEach-Object { [void]$cands.Add(@($_.FullName)) }
    foreach ($c in $cands) {
        $exe = $c[0]; $pre = @($c | Select-Object -Skip 1)
        try {
            $ok = & $exe @pre -c "import sys; print(sys.version_info >= (3, 12))" 2>$null
            if ($LASTEXITCODE -eq 0 -and "$ok".Trim() -eq 'True') { return , @($c) }
        } catch { }
    }
    return $null
}

function Find-Browser {
    $paths = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
               "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
               "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
               "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
               "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
    foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
    return $null
}

Say ''
Say '  MS Vibration Explorer' 'Cyan'
Say '  Research showcase for the paper - not a design tool.' 'DarkYellow'
Say ''

$server = $null
try {
    if (Test-Up) {
        Say '  The app is already running.'
    } else {
        $py = Find-Python
        if (-not $py) {
            Say '  Python 3.12 or newer was not found.' 'Red'
            Say '  Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this again.'
            Say '  Or set MSVE_PYTHON to the full path of python.exe.'
            exit 1
        }
        $exe = $py[0]; $pre = @($py | Select-Object -Skip 1)
        Say "  Python: $exe $($pre -join ' ')"
        & $exe @pre -c "import fastapi, uvicorn, numpy, pandas" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Say '  Installing the requirements (first run only)...'
            & $exe @pre -m pip install --disable-pip-version-check -q -r requirements.txt
            if ($LASTEXITCODE -ne 0) { Say '  Installing the requirements failed.' 'Red'; exit 1 }
        }
        $log = Join-Path $env:TEMP 'ms-vibration-explorer-server.log'
        Say '  Starting the solver service...'
        $args = $pre + @('-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', "$Port", '--log-level', 'warning')
        $server = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $Root -WindowStyle Hidden `
                                -RedirectStandardError $log -PassThru
        $t0 = Get-Date
        while (-not (Test-Up)) {
            if ($server.HasExited) { Say "  The server stopped. See $log" 'Red'; Get-Content $log -Tail 15; exit 1 }
            if (((Get-Date) - $t0).TotalSeconds -gt 120) { Say "  The server did not start within 2 minutes. See $log" 'Red'; exit 1 }
            Start-Sleep -Milliseconds 400
        }
        Say "  Ready at $Url" 'Green'
    }

    if ($NoWindow) { Say '  (-NoWindow) not opening a window.'; return }

    $browser = Find-Browser
    if ($browser) {
        $profileDir = Join-Path $env:LOCALAPPDATA 'MSVibrationExplorer\window'
        $bargs = @("--app=$Url", "--user-data-dir=$profileDir", '--window-size=1600,960', '--no-first-run',
                   '--no-default-browser-check', '--disable-features=Translate')
        Say '  Opening the app window. Close the window to stop the app.'
        $win = Start-Process -FilePath $browser -ArgumentList $bargs -PassThru
        $win.WaitForExit()
    } else {
        Start-Process $Url
        Say '  Opened in your browser. Press Enter here to stop the app.'
        [void](Read-Host)
    }
}
finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        Say '  Stopped.'
    }
}
