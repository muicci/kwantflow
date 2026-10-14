#requires -Version 7.4
<#
.SYNOPSIS
Builds and stages the pinned Windows x64 native runtime from a clean source checkout.
.DESCRIPTION
Requires Windows x64, Visual Studio C++ Build Tools, Git for Windows (with Bash),
Python 3.13, and Java 21. Downloads are public, SHA-256 checked, and need no tokens.
No installer, signing, publishing, or system package installation is performed.
Offline requires cached inputs and already fetched Bazel repositories at the same
cache path. It disables acquisition and Bazel fetching; it is not an OS network sandbox.
Use a short writable CacheDirectory to avoid upstream Windows path-length limits.
#>
[CmdletBinding()]
param(
    [string]$CacheDirectory = (Join-Path ([IO.Path]::GetTempPath()) 'kwantflow-native'),
    [string]$RuntimeDirectory = (Join-Path $PSScriptRoot '../src-tauri/native-runtime'),
    [switch]$Offline
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) {
    throw 'The native Windows runtime must be built on Windows x64.'
}
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$contractPath = Join-Path $appRoot '.github/windows-native-runtime-contract.json'
$contract = Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json
$cache = [IO.Path]::GetFullPath($CacheDirectory)
$destination = [IO.Path]::GetFullPath($RuntimeDirectory)
$runtimeParent = Split-Path $destination
New-Item -ItemType Directory -Force $cache, $runtimeParent | Out-Null

function Assert-Input([string]$Path, $InputContract) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing native input: $Path" }
    if ((Get-Item -LiteralPath $Path).Length -ne $InputContract.bytes) { throw "Native input length mismatch: $Path" }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $InputContract.sha256) {
        throw "Native input SHA-256 mismatch: $Path"
    }
}

function Get-Input($InputContract) {
    $path = Join-Path $cache $InputContract.fileName
    if (-not (Test-Path -LiteralPath $path)) {
        if ($Offline) { throw "Offline native input is not cached: $path" }
        $partial = "$path.download"
        try {
            Invoke-WebRequest -Uri $InputContract.url -OutFile $partial
            Assert-Input $partial $InputContract
            Move-Item -LiteralPath $partial -Destination $path
        } finally {
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
        }
    }
    Assert-Input $path $InputContract
    return $path
}

function Invoke-Checked([string]$Tool, [string[]]$Arguments) {
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Tool failed with exit code $LASTEXITCODE." }
}

$git = (Get-Command git -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$pythonVersion = (& $python --version 2>&1) -join ' '
if ($LASTEXITCODE -ne 0 -or $pythonVersion -notmatch '^Python 3\.13\.') { throw "Pinned LiteRT build requires Python 3.13, found $pythonVersion." }
$javaVersion = (& java -version 2>&1) -join ' '
if ($LASTEXITCODE -ne 0 -or $javaVersion -notmatch 'version "21[."]') { throw "Pinned LiteRT build requires Java 21, found $javaVersion." }
Get-Command tar -ErrorAction Stop | Out-Null
$vswhere = Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio 2022 C++ Build Tools and the Windows SDK.' }
$visualStudio = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $visualStudio) { throw 'Visual Studio C++ x64 toolchain is missing.' }
$vc = Join-Path $visualStudio 'VC'
$msvcVersion = (Get-Content -LiteralPath (Join-Path $vc 'Auxiliary/Build/Microsoft.VCToolsVersion.default.txt') -Raw).Trim()
if ([version]$msvcVersion -gt [version]$contract.inputs.visualCppRedist.version) {
    throw "MSVC $msvcVersion is newer than the pinned redistributable. Update and review the native input contract before using this compiler."
}
$libExe = Join-Path $vc "Tools/MSVC/$msvcVersion/bin/Hostx64/x64/lib.exe"
$dumpbin = Join-Path $vc "Tools/MSVC/$msvcVersion/bin/Hostx64/x64/dumpbin.exe"
foreach ($tool in @($libExe, $dumpbin)) { if (-not (Test-Path -LiteralPath $tool)) { throw "Missing MSVC tool: $tool" } }
$gitBash = Join-Path (Split-Path (Split-Path $git)) 'bin/bash.exe'
if (-not (Test-Path -LiteralPath $gitBash)) { throw 'Git for Windows Bash is required by upstream Bazel source-generation rules.' }

$bazel = Get-Input $contract.inputs.bazel
$sourceArchive = Get-Input $contract.inputs.litertSource
$pdfiumArchive = Get-Input $contract.inputs.pdfium
$patch = Join-Path $appRoot $contract.litertLm.patch.path
if ((Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash.ToLowerInvariant() -ne $contract.litertLm.patch.sha256) {
    throw 'Checked-in LiteRT Windows source patch does not match the reviewed input contract.'
}

# Source/work directories are script-owned cache entries. A fresh extraction
# avoids silently reusing local source edits while preserving the expensive Bazel disk cache.
$source = Join-Path $cache "source-$($contract.litertLm.commit)"
if (Test-Path -LiteralPath $source) { Remove-Item -LiteralPath $source -Recurse -Force }
New-Item -ItemType Directory -Force $source | Out-Null
Invoke-Checked 'tar' @('-xzf', $sourceArchive, '-C', $source, '--strip-components=1')
if ((Get-Content -LiteralPath (Join-Path $source '.bazelversion') -Raw).Trim() -ne $contract.bazelVersion) {
    throw 'Upstream Bazel version does not match the pinned contract.'
}
foreach ($file in $contract.litertLm.prebuiltFiles) {
    Assert-Input (Join-Path $source $file.path) $file
}
$staging = Join-Path $runtimeParent ('.native-runtime-stage-' + [guid]::NewGuid().ToString('N'))
$runtime = Join-Path $staging 'candidate'
$previousRuntime = Join-Path $staging 'previous'
$preserveRecovery = $false
New-Item -ItemType Directory -Path $staging | Out-Null
try {
if (Test-Path -LiteralPath $destination) {
    Copy-Item -LiteralPath $destination -Destination $runtime -Recurse
} else {
    New-Item -ItemType Directory -Path $runtime | Out-Null
}
Push-Location $source
$envNames = @('BAZEL_VC', 'BAZEL_VC_FULL_VERSION', 'BAZEL_SH', 'BAZEL_PYTHON', 'PYTHON_BIN_PATH', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_NDK_HOME', 'ANDROID_NDK_ROOT')
$previousEnv = @{}
foreach ($name in $envNames) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:BAZEL_VC = $vc
    $env:BAZEL_VC_FULL_VERSION = $msvcVersion
    $env:BAZEL_SH = $gitBash
    $env:BAZEL_PYTHON = $python
    $env:PYTHON_BIN_PATH = $python
    foreach ($name in @('ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_NDK_HOME', 'ANDROID_NDK_ROOT')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    # The upstream WORKSPACE declares android_sdk_repository(name = "androidsdk") with no path.
    # Nothing in the Windows C API build needs Android, but Bazel still tries to fetch the rule and
    # fails without an SDK, so substitute an empty local repository for it.
    $emptyAndroidSdk = Join-Path $cache 'empty-androidsdk'
    New-Item -ItemType Directory -Force $emptyAndroidSdk | Out-Null
    Set-Content -LiteralPath (Join-Path $emptyAndroidSdk 'WORKSPACE') -Value 'workspace(name = "androidsdk")' -Encoding ascii
    # The upstream WORKSPACE registers @androidsdk//:sdk-toolchain, so the stub must define that
    # target; it is never selected because no target in the C API build requests the Android
    # SDK toolchain type.
    $stubBuild = @(
        '# Stub: the Windows build does not use the Android SDK.',
        'filegroup(name = "empty")',
        '',
        'toolchain(',
        '    name = "sdk-toolchain",',
        '    toolchain_type = "@bazel_tools//tools/android:sdk_toolchain_type",',
        '    toolchain = ":empty",',
        ')'
    )
    Set-Content -LiteralPath (Join-Path $emptyAndroidSdk 'BUILD.bazel') -Value ($stubBuild -join [Environment]::NewLine) -Encoding ascii
    $overrideAndroidSdk = "--override_repository=androidsdk=$($emptyAndroidSdk -replace '\\', '/')"
    Invoke-Checked $git @('-c', 'core.longpaths=true', 'apply', '--check', $patch)
    Invoke-Checked $git @('-c', 'core.longpaths=true', 'apply', $patch)
    $headers = (Get-Content 'c/engine.h', 'c/conversation.h' -Raw) -join [Environment]::NewLine
    $symbols = @([regex]::Matches($headers, '\b(litert_lm_[A-Za-z0-9_]+)\s*\(') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    if ($symbols.Count -eq 0) { throw 'Could not derive C ABI exports from the pinned headers.' }
    @('LIBRARY litert_lm_c', 'EXPORTS') + @($symbols | ForEach-Object { "  $_" }) | Set-Content 'c/litert_lm_c.def' -Encoding ascii
    # Bazel's output base must be short: MSVC link.exe fails with LNK1181 on the long object
    # paths that result from placing it under the user temp directory (Windows MAX_PATH).
    $bazelOutput = if ($env:KWANTFLOW_BAZEL_OUTPUT_BASE) { $env:KWANTFLOW_BAZEL_OUTPUT_BASE } else { Join-Path ([IO.Path]::GetPathRoot($cache)) 'bzl' }
    New-Item -ItemType Directory -Force $bazelOutput | Out-Null
    $diskCache = Join-Path $cache 'bazel-disk-cache'
    New-Item -ItemType Directory -Force $diskCache | Out-Null
    $fetchOptions = @("--repository_cache=$(Join-Path $cache 'bazel-repository-cache')")
    if ($Offline) { $fetchOptions += @('--nofetch', '--repository_disable_download') }
    Invoke-Checked $bazel (@("--output_base=$bazelOutput", 'build', '//c:litert_lm_c', "--disk_cache=$diskCache", '--noenable_platform_specific_config', '--config=windows', '--define=litert_link_capi_so=true', '--define=resolve_symbols_in_exec=false', $overrideAndroidSdk) + $fetchOptions)
    $bazelBinOutput = @(& $bazel "--output_base=$bazelOutput" info bazel-bin $overrideAndroidSdk @fetchOptions)
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve Bazel output directory.' }
    $bazelBin = "$($bazelBinOutput[-1])".Trim()
    # Bazel reports the target output as bazel-bin/c/litert_lm_c.dll. A recursive search is
    # ambiguous because the link step also leaves copies in intermediate subdirectories.
    $builtDll = Join-Path $bazelBin 'c/litert_lm_c.dll'
    if (-not (Test-Path -LiteralPath $builtDll -PathType Leaf)) {
        $builtDlls = @(Get-ChildItem -LiteralPath (Join-Path $bazelBin 'c') -Recurse -File -Filter 'litert_lm_c.dll')
        if ($builtDlls.Count -ne 1) { throw "Expected exactly one built C API DLL, found $($builtDlls.Count)." }
        $builtDll = $builtDlls[0].FullName
    }
    Copy-Item -LiteralPath $builtDll -Destination (Join-Path $runtime 'litert_lm_c.dll') -Force
    Invoke-Checked $libExe @('/def:c/litert_lm_c.def', '/machine:x64', "/out:$runtime/litert_lm_c.lib", '/name:litert_lm_c.dll')
    New-Item -ItemType Directory -Force (Join-Path $runtime 'include') | Out-Null
    Copy-Item -LiteralPath 'c/engine.h', 'c/conversation.h' -Destination (Join-Path $runtime 'include') -Force
    foreach ($file in $contract.litertLm.prebuiltFiles) {
        Copy-Item -LiteralPath (Join-Path $source $file.path) -Destination (Join-Path $runtime (Split-Path $file.path -Leaf)) -Force
    }

    # Preserve licenses from the actual fetched dependency sources, including
    # nested third-party notices. Do not substitute only LiteRT's Apache license.
    $dependencyNotices = Join-Path $runtime 'licenses/litert-dependencies'
    New-Item -ItemType Directory -Force $dependencyNotices | Out-Null
    $external = Join-Path $bazelOutput 'external'
    $notices = @(Get-ChildItem -LiteralPath $external -Recurse -File |
        Where-Object { $_.Name -match '^(?:LICENSE|LICENCE|NOTICE|COPYING|COPYRIGHT)(?:[._-].*)?$' })
    if ($notices.Count -eq 0) { throw 'Bazel native dependency notice collection is empty.' }
    foreach ($file in $notices) {
        $dest = Join-Path $dependencyNotices ([IO.Path]::GetRelativePath($external, $file.FullName))
        New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $dest -Force
    }
} finally {
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $previousEnv[$name], 'Process') }
    Pop-Location
}

$pdfium = Join-Path $cache 'pdfium-extracted'
foreach ($dir in @($pdfium)) {
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
    New-Item -ItemType Directory -Force $dir | Out-Null
}
Invoke-Checked 'tar' @('-xzf', $pdfiumArchive, '-C', $pdfium)
# DXC/DXIL GPU shader helpers are intentionally not shipped: dxil.dll is under a restrictive
# Microsoft licence. Dawn falls back to the system FXC compiler, and Local AI retries on CPU.
Copy-Item -LiteralPath (Join-Path $pdfium 'bin/pdfium.dll') -Destination $runtime -Force
$licenses = Join-Path $runtime 'licenses'
New-Item -ItemType Directory -Force $licenses | Out-Null
Copy-Item -LiteralPath (Join-Path $appRoot 'third-party/licenses/native/pdfium'), (Join-Path $appRoot 'third-party/licenses/native/litert') -Destination $licenses -Recurse -Force
$result = & (Join-Path $PSScriptRoot 'verify-windows-runtime.ps1') -RuntimeDirectory $runtime -DumpbinPath $dumpbin -Offline:$Offline
[ordered]@{
    platform = $contract.platform
    litertLmCommit = $contract.litertLm.commit
    sourceArchiveSha256 = $contract.inputs.litertSource.sha256
    patchSha256 = $contract.litertLm.patch.sha256
    bazelVersion = $contract.bazelVersion
    msvcVersion = $msvcVersion
    pythonVersion = $pythonVersion
    javaVersion = $javaVersion
    dependencyNoticeCount = $notices.Count
    runtime = $result
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runtime 'windows-build-receipt.json') -Encoding utf8
# Validation and both receipts complete before replacing the previous bundle.
if (Test-Path -LiteralPath $destination) {
    Move-Item -LiteralPath $destination -Destination $previousRuntime
}
try {
    Move-Item -LiteralPath $runtime -Destination $destination
} catch {
    $promotionError = $_
    if (Test-Path -LiteralPath $previousRuntime) {
        try {
            Move-Item -LiteralPath $previousRuntime -Destination $destination
        } catch {
            $preserveRecovery = $true
            throw "Native preparation could not restore the previous bundle. Recovery files remain at $previousRuntime. Promotion: $promotionError. Recovery: $_"
        }
    }
    throw $promotionError
}
Write-Host "Windows native runtime staged at $destination. No installer or release was created."
} finally {
    if (-not $preserveRecovery -and (Test-Path -LiteralPath $staging)) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
