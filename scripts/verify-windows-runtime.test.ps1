#requires -Version 7.4
# Pure dependency-graph fixtures run on any PowerShell host. They do not replace
# dumpbin/native Windows installer, Authenticode, or Local AI execution evidence.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) "kwantflow-windows-runtime-test-$([guid]::NewGuid())"
$runtime = Join-Path $root 'runtime'
$output = Join-Path $root 'installed'
$contractPath = Join-Path $root 'contract.json'
$dumpbin = Join-Path $root 'dumpbin-fixture.ps1'
$script = Join-Path $PSScriptRoot 'verify-windows-runtime.ps1'
New-Item -ItemType Directory -Force $runtime, $output | Out-Null
$passed = 0

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Set-Pe([string]$Name, [string[]]$Imports, [string[]]$DelayImports = @(), [string]$Machine = '8664', [hashtable]$ImportedSymbols = @{}, [string[]]$Exports = @('litert_lm_engine_create')) {
    $path = Join-Path $runtime $Name
    if (-not (Test-Path -LiteralPath $path)) { Set-Content -LiteralPath $path -Value "fixture-$Name" -NoNewline }
    @{ imports = @($Imports); delayImports = @($DelayImports); machine = $Machine; exports = @($Exports); importedSymbols = $ImportedSymbols } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath "$path.imports.json"
}

function Expect-Failure([string]$Name, [string]$Pattern, [scriptblock]$Action) {
    try {
        & $Action | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "$Name failed for the wrong reason: $($_.Exception.Message)" }
        $script:passed += 1
        Write-Host "PASS: $Name"
        return
    }
    throw "$Name did not reject the invalid payload."
}

function Read-TreeHash([string]$Directory) {
    return @(Get-ChildItem -LiteralPath $Directory -File -Recurse |
        Sort-Object FullName |
        ForEach-Object { "$($_.FullName):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }) -join '|'
}

try {
    @'
param([string]$Mode, [string]$Path)
$spec = Get-Content -LiteralPath "$Path.imports.json" -Raw | ConvertFrom-Json
$global:LASTEXITCODE = 0
switch ($Mode) {
    '/headers' { "  $($spec.machine) machine (x64)" }
    '/exports' { foreach ($symbol in $spec.exports) { "  1 0 00000000 $symbol" } }
    '/dependents' {
        '  Image has the following dependencies:'
        foreach ($name in $spec.imports) { "    $name" }
        '  Image has the following delay load dependencies:'
        foreach ($name in $spec.delayImports) { "    $name" }
    }
    '/imports' {
        '  Section contains the following imports:'
        foreach ($name in @($spec.imports) + @($spec.delayImports)) {
            ''
            "    $name"
            '              140000000 Import Address Table'
            '                      0 time date stamp'
            $symbols = @()
            if ($spec.importedSymbols.PSObject.Properties[$name]) { $symbols = @($spec.importedSymbols.$name) }
            foreach ($symbol in $symbols) { "                          1 $symbol" }
        }
    }
    default { throw "Unexpected dumpbin mode: $Mode" }
}
'@ | Set-Content -LiteralPath $dumpbin
    Set-Pe 'litert_lm_c.dll' @('bridge.dll', 'KERNEL32.dll')
    Set-Pe 'bridge.dll' @('helper.dll', 'api-ms-win-crt-runtime-l1-1-0.dll')
    Set-Pe 'helper.dll' @('bridge.dll', 'ADVAPI32.dll')
    Set-Pe 'Kwantflow.exe' @('litert_lm_c.dll', 'USER32.dll')
    Move-Item -LiteralPath (Join-Path $runtime 'Kwantflow.exe'), (Join-Path $runtime 'Kwantflow.exe.imports.json') -Destination $output
    $contract = [ordered]@{
        requiredRuntimeFiles = @('litert_lm_c.dll', 'bridge.dll', 'helper.dll')
        requiredExports = @('litert_lm_engine_create')
        litertLm = @{ prebuiltFiles = @(@{ path = 'prebuilt/bridge.dll'; sha256 = (Get-FileHash (Join-Path $runtime 'bridge.dll')).Hash.ToLowerInvariant() }) }
        runtimeSha256 = @{ 'helper.dll' = (Get-FileHash (Join-Path $runtime 'helper.dll')).Hash.ToLowerInvariant() }
        windowsSystemDlls = @('kernel32.dll', 'user32.dll', 'advapi32.dll')
        windowsApiSetPattern = '^api-ms-win-crt-[a-z-]+-l[0-9]+-[0-9]+-[0-9]+\.dll$'
        visualCppRuntimeDlls = @('vcruntime140.dll', 'msvcp140.dll')
        inputs = @{ visualCppRedist = @{ version = '14.51.36247.0'; bytes = 1; sha256 = ('0' * 64) } }
    }
    $contract | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $contractPath
    $params = @{ RuntimeDirectory = $runtime; ContractPath = $contractPath; DumpbinPath = $dumpbin; AppExecutable = (Join-Path $output 'Kwantflow.exe') }
    $before = Read-TreeHash $root
    $result = & $script @params -VerifyOnly
    Assert ($result.files.Count -eq 4) 'EXE plus the complete recursive DLL closure must be inspected.'
    Assert (-not $result.installedAppTested) 'Payload analysis must not claim runtime execution.'
    Assert ((Read-TreeHash $root) -eq $before) 'VerifyOnly must not write even a receipt or NSIS flag.'
    $passed += 1
    Write-Host 'PASS: recursive closure, cycle, API sets, EXE imports, and read-only verification'

    Set-Pe 'obsolete-runtime.dll' @('KERNEL32.dll')
    Expect-Failure 'stale unreviewed DLL is not redistributed' 'Unreviewed native DLL: obsolete-runtime\.dll' { & $script @params -VerifyOnly }
    Remove-Item -LiteralPath (Join-Path $runtime 'obsolete-runtime.dll'), (Join-Path $runtime 'obsolete-runtime.dll.imports.json')
    New-Item -ItemType Directory -Path (Join-Path $runtime 'obsolete') | Out-Null
    Set-Content -LiteralPath (Join-Path $runtime 'obsolete/bridge.dll') -Value 'stale nested DLL' -NoNewline
    Expect-Failure 'nested stale DLL is not redistributed in resources' 'Unreviewed native DLL: obsolete' { & $script @params -VerifyOnly }
    Remove-Item -LiteralPath (Join-Path $runtime 'obsolete') -Recurse -Force

    $result = & $script @params -OutputDirectory $output
    foreach ($name in $contract.requiredRuntimeFiles) {
        Assert (Test-Path (Join-Path $output $name)) 'Every staged DLL must be beside the EXE.'
        Assert (Test-Path (Join-Path $output "local-ai/native/$name")) 'Every staged DLL must be in LiteRT resources.'
    }
    Assert ((Get-Content (Join-Path $runtime 'windows-prerequisites.nsh') -Raw) -match 'REQUIRED 0') 'Unneeded VC++ must not be installed.'
    $before = Read-TreeHash $root
    & $script @params -OutputDirectory $output -VerifyOnly | Out-Null
    Assert ((Read-TreeHash $root) -eq $before) 'Packaged VerifyOnly must not write.'
    $passed += 1
    Write-Host 'PASS: both Windows DLL locations and conditional prerequisite generation'

    Remove-Item -LiteralPath (Join-Path $output 'helper.dll')
    Expect-Failure 'missing EXE-adjacent DLL' 'Missing runtime input' { & $script @params -OutputDirectory $output -VerifyOnly }
    Copy-Item -LiteralPath (Join-Path $runtime 'helper.dll') -Destination $output
    Add-Content -LiteralPath (Join-Path $output 'local-ai/native/helper.dll') -Value 'tampered'
    Expect-Failure 'mismatched resource DLL' 'SHA-256 mismatch' { & $script @params -OutputDirectory $output -VerifyOnly }
    Copy-Item -LiteralPath (Join-Path $runtime 'helper.dll') -Destination (Join-Path $output 'local-ai/native/helper.dll') -Force

    $oldWindir = $env:WINDIR
    $env:WINDIR = Join-Path $root 'Windows'
    New-Item -ItemType Directory -Force (Join-Path $env:WINDIR 'System32') | Out-Null
    Set-Content -LiteralPath (Join-Path $env:WINDIR 'System32/python313.dll') -Value 'development-only runtime'
    Set-Pe 'helper.dll' @('python313.dll')
    Expect-Failure 'CI System32 does not establish OS ownership' 'unstaged non-OS DLL: python313.dll' { & $script @params -VerifyOnly }
    $env:WINDIR = $oldWindir

    Set-Pe 'helper.dll' @('api-ms-custom-app-l1-1-0.dll')
    Expect-Failure 'arbitrary API-like names are rejected' 'unstaged non-OS DLL' { & $script @params -VerifyOnly }
    Set-Pe 'helper.dll' @('KERNEL32.dll') @('missing-gpu-backend.dll')
    Expect-Failure 'missing delay-load dependency' 'unstaged non-OS DLL: missing-gpu-backend.dll' { & $script @params -VerifyOnly }
    Set-Pe 'helper.dll' @('vcruntime140.dll')
    Expect-Failure 'VC++ import requires the bundled pinned redistributable' 'Missing runtime input' { & $script @params -VerifyOnly }
    Expect-Failure 'offline staging cannot download missing VC++ prerequisite' 'Offline VC\+\+ redistributable is missing' { & $script @params -Offline }
    Set-Pe 'helper.dll' @('msvcp140d.dll')
    Expect-Failure 'debug VC++ runtime cannot be redistributed' 'unstaged non-OS DLL' { & $script @params -VerifyOnly }
    Set-Pe 'helper.dll' @('KERNEL32.dll', 'bridge.dll') -ImportedSymbols @{ 'bridge.dll' = @('litert_lm_engine_create', 'litert_lm_removed_symbol') }
    Expect-Failure 'imported symbol missing from a packaged DLL' 'STATUS_ENTRYPOINT_NOT_FOUND.*helper\.dll -> bridge\.dll!litert_lm_removed_symbol' { & $script @params -VerifyOnly }
    Set-Pe 'helper.dll' @('KERNEL32.dll') @() '14C'
    Expect-Failure 'x86 PE rejected in x64 runtime' 'Runtime PE is not x64' { & $script @params -VerifyOnly }
    Set-Pe 'helper.dll' @('KERNEL32.dll')
    $contract.webView2 = @{ minimumVersion = '124.0.0.0' }
    $contract | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $contractPath
    Expect-Failure 'browser floor cannot be silently lowered' 'compatibility floor' { & $script @params -VerifyOnly }
    foreach ($invalid in @('125', '125.0.0.invalid', '65536.0.0.0', '125.0.0.0.1')) {
        $contract.webView2.minimumVersion = $invalid
        $contract | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $contractPath
        Expect-Failure "invalid browser floor $invalid" 'compatibility floor' { & $script @params -VerifyOnly }
    }
    $contract.webView2 = @{ minimumVersion = '125.0.0.0'; tauriCli = @{ version = '0.0.0-unreviewed' } }
    $contract | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $contractPath
    Expect-Failure 'unreviewed Tauri CLI version fails closed' 'Tauri CLI changed' { & $script @params -VerifyOnly }
    $contract.Remove('webView2')
    $contract | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $contractPath
    Add-Content -LiteralPath (Join-Path $runtime 'bridge.dll') -Value 'corruption'
    Expect-Failure 'pinned native DLL corruption' 'SHA-256 mismatch' { & $script @params -VerifyOnly }
    Write-Host "$passed Windows runtime fixture checks passed."
} finally {
    if (Get-Variable oldWindir -ErrorAction SilentlyContinue) { $env:WINDIR = $oldWindir }
    Remove-Item -LiteralPath $root -Recurse -Force
}
