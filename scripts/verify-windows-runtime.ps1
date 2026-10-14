#requires -Version 7.4
<#
.SYNOPSIS
Checks x64 PE imports without treating a build runner's System32 as a runtime provider.
.DESCRIPTION
Without VerifyOnly, stages runtime DLLs beside the EXE and into local-ai/native and
writes the NSIS prerequisite contract. With VerifyOnly, performs no writes.
OutputDirectory verifies both packaged locations; AppExecutable also checks EXE imports.
The only external providers accepted are named Windows OS/API-set DLLs and the
hash-pinned Microsoft VC++ redistributable. Other imports must resolve recursively
to packaged DLLs. This is payload proof, not installed-app or inference proof.
The pinned WebView2 standalone installer is verified independently of PE imports.
#>
[CmdletBinding()]
param(
    [string]$RuntimeDirectory = (Join-Path $PSScriptRoot '../src-tauri/native-runtime'),
    [string]$AppExecutable,
    [string]$OutputDirectory,
    [string]$ContractPath = (Join-Path $PSScriptRoot '../.github/windows-native-runtime-contract.json'),
    [string]$DumpbinPath,
    [switch]$VerifyOnly,
    [switch]$Offline
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$contract = Get-Content -LiteralPath $ContractPath -Raw | ConvertFrom-Json
$runtime = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
if (-not $DumpbinPath) {
    if (-not $IsWindows) { throw 'dumpbin verification needs native Windows or an explicit DumpbinPath test fixture.' }
    $vswhere = Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio C++ Build Tools and vswhere.exe are required.' }
    $DumpbinPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\dumpbin.exe' | Select-Object -First 1
}
if (-not $DumpbinPath -or -not (Test-Path -LiteralPath $DumpbinPath)) { throw 'Could not locate dumpbin.exe.' }

function Read-PeOutput([string]$Mode, [string]$Path) {
    $global:LASTEXITCODE = 0
    $lines = @(& $DumpbinPath $Mode $Path 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "dumpbin $Mode failed for $Path (exit $LASTEXITCODE)." }
    return $lines
}

function Assert-FileDigest([string]$Path, [string]$ExpectedHash) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing runtime input: $Path" }
    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $ExpectedHash.ToLowerInvariant()) { throw "SHA-256 mismatch: $Path" }
    return $hash
}

$webViewReceipt = $null
$hasWebViewContract = $contract.PSObject.Properties.Name -contains 'webView2'
if (-not $hasWebViewContract -and [IO.Path]::GetFullPath($ContractPath) -eq [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.github/windows-native-runtime-contract.json'))) {
    throw 'The production Windows contract must include the reviewed offline WebView2 prerequisite.'
}
if ($hasWebViewContract) {
    $minimum = $contract.webView2.minimumVersion
    if ($minimum -notmatch '^\d{1,5}(?:\.\d{1,5}){3}$' -or @($minimum.Split('.') | Where-Object { [int]$_ -gt 65535 }).Count -gt 0 -or [version]$minimum -lt [version]'125.0.0.0') {
        throw 'WebView2 compatibility floor must be a valid four-component version at least 125.0.0.0.'
    }
    $appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $cli = Get-Content -LiteralPath (Join-Path $appRoot 'node_modules/@tauri-apps/cli/package.json') -Raw | ConvertFrom-Json
    if ($cli.version -ne $contract.webView2.tauriCli.version) { throw 'Tauri CLI changed. Review its NSIS template and offline prerequisite hook order before building.' }
    $template = Join-Path $appRoot ".cache/native-inputs/tauri-$($cli.version)-installer.nsi"
    if (-not (Test-Path -LiteralPath $template) -and -not $VerifyOnly) {
        if ($Offline) { throw 'Offline reviewed Tauri NSIS template is missing from the native input cache.' }
        New-Item -ItemType Directory -Force (Split-Path $template) | Out-Null
        $partial = "$template.download"
        try {
            Invoke-WebRequest -Uri $contract.webView2.tauriCli.templateUrl -OutFile $partial
            Assert-FileDigest $partial $contract.webView2.tauriCli.templateSha256 | Out-Null
            Move-Item -LiteralPath $partial -Destination $template
        } finally {
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
        }
    }
    Assert-FileDigest $template $contract.webView2.tauriCli.templateSha256 | Out-Null
    $templateSource = (Get-Content -LiteralPath $template -Raw).Replace("`r`n", "`n")
    $webViewSection = $templateSource.IndexOf("Section WebView2`n")
    $installSection = $templateSource.IndexOf("Section Install`n")
    $preinstallHook = $templateSource.IndexOf('!insertmacro NSIS_HOOK_PREINSTALL')
    $appCopy = $templateSource.IndexOf('File "${MAINBINARYSRCPATH}"')
    if ($webViewSection -lt 0 -or $installSection -le $webViewSection -or $preinstallHook -le $installSection -or $appCopy -le $preinstallHook) {
        throw 'Reviewed Tauri template no longer runs the owned prerequisite hook before application copying.'
    }
    $windowsConfig = Get-Content -LiteralPath (Join-Path $appRoot 'src-tauri/tauri.windows.conf.json') -Raw | ConvertFrom-Json
    $baseConfig = Get-Content -LiteralPath (Join-Path $appRoot 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
    if ($windowsConfig.bundle.windows.webviewInstallMode.type -ne 'skip' -or
        $windowsConfig.bundle.windows.nsis.installerHooks -ne '../scripts/windows-installer-hooks.nsh' -or
        $windowsConfig.bundle.windows.PSObject.Properties.Name -contains 'minimumWebview2Version' -or
        $baseConfig.bundle.windows.PSObject.Properties.Name -contains 'minimumWebview2Version') {
        throw 'WebView2 must use the owned offline PREINSTALL hook with upstream handling disabled.'
    }
    $webViewInput = $contract.inputs.webView2OfflineInstaller
    if ($webViewInput.fileName -ne 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe' -or $contract.webView2.appGuid -ne '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') {
        throw 'Unreviewed WebView2 payload or registry identity.'
    }
    $webView = Join-Path $runtime "prerequisites/$($webViewInput.fileName)"
    if (-not (Test-Path -LiteralPath $webView) -and -not $VerifyOnly) {
        if ($Offline) { throw 'Offline WebView2 standalone installer is missing from the staged prerequisites.' }
        New-Item -ItemType Directory -Force (Split-Path $webView) | Out-Null
        $partial = "$webView.download"
        try {
            Invoke-WebRequest -Uri $webViewInput.url -OutFile $partial
            Assert-FileDigest $partial $webViewInput.sha256 | Out-Null
            if ((Get-Item -LiteralPath $partial).Length -ne $webViewInput.bytes) { throw 'WebView2 standalone installer length mismatch.' }
            Move-Item -LiteralPath $partial -Destination $webView
        } finally {
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
        }
    }
    Assert-FileDigest $webView $webViewInput.sha256 | Out-Null
    if ((Get-Item -LiteralPath $webView).Length -ne $webViewInput.bytes) { throw 'WebView2 standalone installer length mismatch.' }
    if (-not $IsWindows) { throw 'WebView2 payload version and Authenticode certification require native Windows.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $webView
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '\bO=Microsoft Corporation(?:,|$)') {
        throw 'Pinned WebView2 standalone installer must have a valid Microsoft Authenticode signature.'
    }
    $installerVersion = (Get-Item -LiteralPath $webView).VersionInfo.FileVersion
    if ($installerVersion -ne $webViewInput.installerVersion) { throw "WebView2 setup FileVersion mismatch: $installerVersion" }
    $webViewReceipt = [ordered]@{
        fileName = $webViewInput.fileName
        url = $webViewInput.url
        bytes = $webViewInput.bytes
        sha256 = $webViewInput.sha256
        installerVersion = $installerVersion
        versionKind = $webViewInput.versionKind
        minimumRuntimeVersion = $minimum
        signatureStatus = "$($signature.Status)"
        signerSubject = $signature.SignerCertificate.Subject
        signerThumbprint = $signature.SignerCertificate.Thumbprint
        timestampSignerSubject = $(if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null })
        tauriCliVersion = $cli.version
        reviewedTemplateCommit = $contract.webView2.tauriCli.templateCommit
        reviewedTemplateSha256 = $contract.webView2.tauriCli.templateSha256
    }
}

foreach ($name in $contract.requiredRuntimeFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtime $name) -PathType Leaf)) { throw "Missing required runtime DLL: $name" }
}
foreach ($inputFile in $contract.litertLm.prebuiltFiles) {
    $name = Split-Path $inputFile.path -Leaf
    Assert-FileDigest (Join-Path $runtime $name) $inputFile.sha256 | Out-Null
}
foreach ($name in $contract.runtimeSha256.PSObject.Properties.Name) {
    Assert-FileDigest (Join-Path $runtime $name) $contract.runtimeSha256.$name | Out-Null
}

$dlls = @(Get-ChildItem -LiteralPath $runtime -Filter '*.dll' -File -Recurse -Force)
foreach ($file in $dlls) {
    if ($file.DirectoryName -ine $runtime -or $contract.requiredRuntimeFiles -notcontains $file.Name) {
        throw "Unreviewed native DLL: $([IO.Path]::GetRelativePath($runtime, $file.FullName)). Runtime DLLs must match requiredRuntimeFiles and be beside the application EXE."
    }
}
$index = @{}
foreach ($file in $dlls) { $index[$file.Name.ToLowerInvariant()] = $file.FullName }
$exports = (Read-PeOutput '/exports' (Join-Path $runtime 'litert_lm_c.dll')) -join [Environment]::NewLine
foreach ($symbol in $contract.requiredExports) {
    if ($exports -notmatch "(?m)\b$([regex]::Escape($symbol))\b") { throw "LiteRT C API export is missing: $symbol" }
}

# Symbol-level check: every name a PE imports from a packaged DLL must be exported by that
# DLL. A name-level dependency walk cannot see this, and the Windows loader reports the gap
# only at process start as STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139).
function Read-PeExports([string]$Path) {
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($line in (Read-PeOutput '/exports' $Path)) {
        if ("$line" -match '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]{8}\s+(\S+)' -or "$line" -match '^\s+\d+\s+[0-9A-Fa-f]+\s+(\S+)\s+\(forwarded to ') {
            $names.Add($Matches[1]) | Out-Null
        }
    }
    # The unary comma stops PowerShell from unrolling the set into its elements.
    return ,$names
}
function Read-PeImports([string]$Path) {
    $byDll = @{}
    $current = $null
    foreach ($line in (Read-PeOutput '/imports' $Path)) {
        $text = "$line"
        if ($text -match '^\s+([A-Za-z0-9._+-]+\.(?:dll|drv))\s*$') {
            $current = $Matches[1].ToLowerInvariant()
            if (-not $byDll.ContainsKey($current)) { $byDll[$current] = [Collections.Generic.List[string]]::new() }
            continue
        }
        if ($null -eq $current) { continue }
        if ($text -match '^\s+(?:[0-9A-Fa-f]+\s+){1,2}([A-Za-z_?@$][\w?@$.]*)\s*$') { $byDll[$current].Add($Matches[1]) }
    }
    return $byDll
}
$exportCache = @{}
function Assert-ImportedSymbols([string]$Path) {
    $imports = Read-PeImports $Path
    $missing = [Collections.Generic.List[string]]::new()
    foreach ($dependency in $imports.Keys) {
        if (-not $index.ContainsKey($dependency)) { continue }
        if (-not $exportCache.ContainsKey($dependency)) { $exportCache[$dependency] = Read-PeExports $index[$dependency] }
        $exports = $exportCache[$dependency]
        $absent = @($imports[$dependency] | Where-Object { -not $exports.Contains($_) })
        Write-Host "  $([IO.Path]::GetFileName($Path)) imports $($imports[$dependency].Count) symbols from $dependency ($($absent.Count) missing)"
        foreach ($symbol in $absent) { $missing.Add("$([IO.Path]::GetFileName($Path)) -> $dependency!$symbol") }
    }
    if ($missing.Count -gt 0) {
        throw "Packaged DLLs do not export symbols their importers need (the loader would fail with STATUS_ENTRYPOINT_NOT_FOUND): $($missing -join '; ')"
    }
}

$queue = [Collections.Generic.Queue[string]]::new()
foreach ($file in $dlls) { $queue.Enqueue($file.FullName) }
if ($AppExecutable) {
    $AppExecutable = (Resolve-Path -LiteralPath $AppExecutable).Path
    if ([IO.Path]::GetExtension($AppExecutable) -ine '.exe') { throw 'AppExecutable must be the built application EXE.' }
    $queue.Enqueue($AppExecutable)
}
$visited = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$vcImports = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$edges = [Collections.Generic.List[object]]::new()
$files = [Collections.Generic.List[object]]::new()
while ($queue.Count -gt 0) {
    $path = $queue.Dequeue()
    if (-not $visited.Add($path)) { continue }
    $headers = (Read-PeOutput '/headers' $path) -join [Environment]::NewLine
    if ($headers -notmatch '(?im)\b8664 machine \(x64\)') { throw "Runtime PE is not x64: $path" }
    $files.Add([ordered]@{ name = [IO.Path]::GetFileName($path); sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() })
    Assert-ImportedSymbols $path
    foreach ($line in (Read-PeOutput '/dependents' $path)) {
        if ("$line" -notmatch '^\s+([A-Za-z0-9._+-]+\.(?:dll|drv))\s*$') { continue }
        $dependency = $Matches[1].ToLowerInvariant()
        $provider = ''
        if ($contract.windowsSystemDlls -contains $dependency -or $dependency -match $contract.windowsApiSetPattern) {
            $provider = 'Windows OS'
        } elseif ($contract.visualCppRuntimeDlls -contains $dependency) {
            $vcImports.Add($dependency) | Out-Null
            $provider = 'bundled VC++ redistributable'
        } elseif ($index.ContainsKey($dependency)) {
            $provider = 'packaged DLL'
            $queue.Enqueue($index[$dependency])
        } else {
            throw "$([IO.Path]::GetFileName($path)) depends on unstaged non-OS DLL: $dependency"
        }
        Write-Host "  $([IO.Path]::GetFileName($path)) depends on $dependency ($provider)"
        $edges.Add([ordered]@{ file = [IO.Path]::GetFileName($path); dependency = $dependency; provider = $provider })
    }
}

$vcRequired = $vcImports.Count -gt 0
$redistRelative = 'prerequisites/vc_redist.x64.exe'
$redist = Join-Path $runtime $redistRelative
if ($vcRequired) {
    if (-not (Test-Path -LiteralPath $redist) -and -not $VerifyOnly) {
        if ($Offline) { throw 'Offline VC++ redistributable is missing from the staged runtime.' }
        New-Item -ItemType Directory -Force (Split-Path $redist) | Out-Null
        $partial = "$redist.download"
        try {
            Invoke-WebRequest -Uri $contract.inputs.visualCppRedist.url -OutFile $partial
            Assert-FileDigest $partial $contract.inputs.visualCppRedist.sha256 | Out-Null
            if ((Get-Item -LiteralPath $partial).Length -ne $contract.inputs.visualCppRedist.bytes) { throw 'VC++ redistributable length mismatch.' }
            Move-Item -LiteralPath $partial -Destination $redist
        } finally {
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
        }
    }
    Assert-FileDigest $redist $contract.inputs.visualCppRedist.sha256 | Out-Null
    if ((Get-Item -LiteralPath $redist).Length -ne $contract.inputs.visualCppRedist.bytes) { throw 'VC++ redistributable length mismatch.' }
    if ($IsWindows) {
        $signature = Get-AuthenticodeSignature -LiteralPath $redist
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '\bO=Microsoft Corporation(?:,|$)') {
            throw 'Pinned VC++ redistributable must have a valid Microsoft Authenticode signature.'
        }
        $version = (Get-Item -LiteralPath $redist).VersionInfo.FileVersion
        if ($version -ne $contract.inputs.visualCppRedist.version) { throw "VC++ redistributable version mismatch: $version" }
    }
}

if ($OutputDirectory) {
    $output = [IO.Path]::GetFullPath($OutputDirectory)
    $resource = Join-Path $output 'local-ai/native'
    if (-not $VerifyOnly) {
        New-Item -ItemType Directory -Force $output, $resource | Out-Null
        foreach ($file in $dlls) {
            foreach ($target in @((Join-Path $output $file.Name), (Join-Path $resource $file.Name))) {
                if ([IO.Path]::GetFullPath($file.FullName) -ine [IO.Path]::GetFullPath($target)) { Copy-Item -LiteralPath $file.FullName -Destination $target -Force }
            }
        }
        if ($vcRequired) {
            New-Item -ItemType Directory -Force (Join-Path $resource 'prerequisites') | Out-Null
            $target = Join-Path $resource $redistRelative
            if ([IO.Path]::GetFullPath($redist) -ine [IO.Path]::GetFullPath($target)) { Copy-Item -LiteralPath $redist -Destination $target -Force }
        }
    }
    foreach ($file in $dlls) {
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Assert-FileDigest (Join-Path $output $file.Name) $hash | Out-Null
        Assert-FileDigest (Join-Path $resource $file.Name) $hash | Out-Null
    }
    if ($vcRequired) { Assert-FileDigest (Join-Path $resource $redistRelative) $contract.inputs.visualCppRedist.sha256 | Out-Null }
}

if (-not $VerifyOnly) {
    $requiredValue = if ($vcRequired) { 1 } else { 0 }
    $prerequisiteDefinitions = @(
        '; Generated from the checked PE import closure. Do not edit.'
        ('!define KWANTFLOW_VC_REDIST_REQUIRED {0}' -f $requiredValue)
        ('!define KWANTFLOW_VC_REDIST_VERSION "{0}"' -f $contract.inputs.visualCppRedist.version)
    )
    if ($hasWebViewContract) {
        $prerequisiteDefinitions += ('!define KWANTFLOW_WEBVIEW2_MINIMUM_VERSION "{0}"' -f $contract.webView2.minimumVersion)
        $prerequisiteDefinitions += ('!define KWANTFLOW_WEBVIEW2_APP_GUID "{0}"' -f $contract.webView2.appGuid)
    }
    $prerequisiteDefinitions | Set-Content -LiteralPath (Join-Path $runtime 'windows-prerequisites.nsh') -Encoding utf8
}
Write-Host "Windows x64 runtime verified: $($visited.Count) PEs, $($edges.Count) imports, VC++ required=$vcRequired."
$receipt = [pscustomobject][ordered]@{
    platform = 'windows-x86_64'
    files = @($files.ToArray())
    imports = @($edges.ToArray())
    visualCpp = [ordered]@{ required = $vcRequired; version = $contract.inputs.visualCppRedist.version; imports = @($vcImports | Sort-Object) }
    webView2 = $webViewReceipt
    installedAppTested = $false
}
if (-not $VerifyOnly -and $hasWebViewContract) {
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runtime 'windows-runtime-receipt.json') -Encoding utf8
} elseif ($VerifyOnly -and $hasWebViewContract) {
    $stored = Get-Content -LiteralPath (Join-Path $runtime 'windows-runtime-receipt.json') -Raw | ConvertFrom-Json
    if (($stored | ConvertTo-Json -Depth 8 -Compress) -ne ($receipt | ConvertTo-Json -Depth 8 -Compress)) {
        throw 'Windows runtime receipt no longer matches the verified DLLs, imports or prerequisite payload.'
    }
}
$receipt
