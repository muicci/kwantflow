#requires -Version 7.4
# Executes the production staging/promotion block with synthetic build tools.
# This proves file preservation and rollback, not Windows compilation or inference.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) "kwantflow-native-stage-test-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $root | Out-Null
$passed = 0
$scriptText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'native-windows.ps1') -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($scriptText, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'The native Windows script must parse without errors.' }
$stagingAssignment = $ast.EndBlock.Statements | Where-Object {
    $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$staging'
}
if (@($stagingAssignment).Count -ne 1) { throw 'Could not identify the native staging block.' }
$stagingText = $scriptText.Substring($stagingAssignment.Extent.StartOffset)

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Read-TreeHash([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory)) { return '<missing>' }
    return @(Get-ChildItem -LiteralPath $Directory -File -Recurse |
        Sort-Object FullName |
        ForEach-Object { "$([IO.Path]::GetRelativePath($Directory, $_.FullName)):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }) -join '|'
}

# The real staging block calls these tools. Every fixture tool writes only inside
# this test's unique temporary directory; no native toolchain is invoked.
function Invoke-Checked([string]$Tool, [string[]]$Arguments) {
    if ($Tool -eq $bazel -and $Arguments -contains 'build') {
        if ($scenario -in @('build-failure', 'first-build-failure')) { throw 'fixture build failed' }
    } elseif ($Tool -eq $libExe) {
        $output = ($Arguments | Where-Object { $_.StartsWith('/out:') }).Substring(5)
        Set-Content -LiteralPath $output -Value 'candidate import library' -NoNewline
    } elseif ($Tool -eq 'tar') {
        $directory = $Arguments[[Array]::IndexOf($Arguments, '-C') + 1]
        New-Item -ItemType Directory -Path (Join-Path $directory 'bin') | Out-Null
        Set-Content -LiteralPath (Join-Path $directory 'bin/pdfium.dll') -Value 'candidate PDFium' -NoNewline
    }
}

function Move-Item([string]$LiteralPath, [string]$Destination) {
    $name = Split-Path $LiteralPath -Leaf
    if (($scenario -in @('promotion-failure', 'rollback-failure')) -and $name -eq 'candidate') {
        throw 'fixture promotion failed'
    }
    if ($scenario -eq 'rollback-failure' -and $name -eq 'previous') { throw 'fixture rollback failed' }
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
}

try {
    foreach ($scenario in @('build-failure', 'validation-failure', 'promotion-failure', 'rollback-failure', 'success', 'first-build-failure', 'first-success')) {
        $case = Join-Path $root $scenario
        $appRoot = Join-Path $case 'app'
        $cache = Join-Path $case 'cache'
        $runtimeParent = Join-Path $case 'target'
        $destination = Join-Path $runtimeParent 'native-runtime'
        $source = Join-Path $cache 'source'
        $fixtureScripts = Join-Path $case 'scripts'
        New-Item -ItemType Directory -Force $appRoot, $cache, $runtimeParent, $fixtureScripts, (Join-Path $source 'c') | Out-Null
        if ($scenario -notlike 'first-*') {
            New-Item -ItemType Directory -Path (Join-Path $destination 'licenses/existing') -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $destination 'litert_lm_c.dll') -Value 'previous runtime' -NoNewline
            Set-Content -LiteralPath (Join-Path $destination 'windows-build-receipt.json') -Value 'previous receipt' -NoNewline
            Set-Content -LiteralPath (Join-Path $destination 'licenses/existing/LICENSE') -Value 'previous notice' -NoNewline
        }
        $before = Read-TreeHash $destination
        foreach ($name in @('pdfium', 'litert')) {
            $notices = Join-Path $appRoot "third-party/licenses/native/$name"
            New-Item -ItemType Directory -Path $notices -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $notices 'LICENSE') -Value "fixture $name notice" -NoNewline
        }
        Set-Content -LiteralPath (Join-Path $source 'c/engine.h') -Value 'void litert_lm_engine_create(void);'
        Set-Content -LiteralPath (Join-Path $source 'c/conversation.h') -Value 'void litert_lm_conversation_create(void);'
        $bazelOutput = Join-Path $cache 'bzl'
        New-Item -ItemType Directory -Force (Join-Path $bazelOutput 'external/fixture'), (Join-Path $cache 'bin/c') | Out-Null
        Set-Content -LiteralPath (Join-Path $bazelOutput 'external/fixture/LICENSE') -Value 'fixture build notice' -NoNewline
        Set-Content -LiteralPath (Join-Path $cache 'bin/c/litert_lm_c.dll') -Value 'candidate runtime' -NoNewline
        $bazel = Join-Path $fixtureScripts 'bazel-fixture.ps1'
        @'
param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
$global:LASTEXITCODE = 0
Join-Path $PSScriptRoot '../cache/bin'
'@ | Set-Content -LiteralPath $bazel
        @'
param([string]$RuntimeDirectory, [string]$DumpbinPath, [switch]$Offline)
if ((Split-Path $PSScriptRoot -Parent | Split-Path -Leaf) -eq 'validation-failure') { throw 'fixture validation failed' }
foreach ($name in @('litert_lm_c.dll', 'litert_lm_c.lib', 'pdfium.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDirectory $name))) { throw "Missing synthetic candidate: $name" }
}
@{ installedAppTested = $false; fixture = $true }
'@ | Set-Content -LiteralPath (Join-Path $fixtureScripts 'verify-windows-runtime.ps1')
        $underTest = Join-Path $fixtureScripts 'staging-under-test.ps1'
        Set-Content -LiteralPath $underTest -Value $stagingText
        $contract = @{ platform = 'windows-x86_64'; litertLm = @{ commit = 'fixture'; prebuiltFiles = @(); patch = @{ sha256 = 'fixture' } }; inputs = @{ litertSource = @{ sha256 = 'fixture' } }; bazelVersion = 'fixture' }
        $git = 'fixture-git'
        $patch = 'fixture.patch'
        $libExe = 'fixture-lib'
        $dumpbin = 'fixture-dumpbin'
        $vc = 'fixture-vc'
        $msvcVersion = '14.40.0'
        $python = 'fixture-python'
        $pythonVersion = 'Python 3.13.fixture'
        $javaVersion = 'Java 21 fixture'
        $gitBash = 'fixture-bash'
        $pdfiumArchive = 'fixture-pdfium.tgz'
        $Offline = $true
        $oldVc = [Environment]::GetEnvironmentVariable('BAZEL_VC', 'Process')
        [Environment]::SetEnvironmentVariable('BAZEL_VC', 'original-fixture-value', 'Process')
        # The production block chooses a short drive-root output base; keep the fixture inside its cache.
        $oldOutputBase = [Environment]::GetEnvironmentVariable('KWANTFLOW_BAZEL_OUTPUT_BASE', 'Process')
        [Environment]::SetEnvironmentVariable('KWANTFLOW_BAZEL_OUTPUT_BASE', $bazelOutput, 'Process')
        $location = Get-Location
        $errorMessage = $null
        try { & $underTest | Out-Null } catch { $errorMessage = $_.Exception.Message } finally {
            Assert ([Environment]::GetEnvironmentVariable('BAZEL_VC', 'Process') -eq 'original-fixture-value') 'Build environment must be restored.'
            [Environment]::SetEnvironmentVariable('BAZEL_VC', $oldVc, 'Process')
            [Environment]::SetEnvironmentVariable('KWANTFLOW_BAZEL_OUTPUT_BASE', $oldOutputBase, 'Process')
        }
        Assert ((Get-Location).Path -eq $location.Path) 'Source build location must be restored.'
        $recovery = @(Get-ChildItem -LiteralPath $runtimeParent -Directory -Force -Filter '.native-runtime-stage-*')
        if ($scenario -like '*success') {
            Assert ($null -eq $errorMessage) "Unexpected staging error: $errorMessage"
            Assert ((Get-Content -LiteralPath (Join-Path $destination 'litert_lm_c.dll') -Raw) -eq 'candidate runtime') 'Complete candidate must be promoted.'
            $receipt = Get-Content -LiteralPath (Join-Path $destination 'windows-build-receipt.json') -Raw | ConvertFrom-Json
            Assert (-not $receipt.runtime.installedAppTested) 'Synthetic staging must not claim installed execution.'
            if ($scenario -eq 'success') { Assert (Test-Path -LiteralPath (Join-Path $destination 'licenses/existing/LICENSE')) 'Existing notices must be preserved.' }
            Assert ($recovery.Count -eq 0) 'Successful staging must clean its temporary directory.'
        } elseif ($scenario -eq 'rollback-failure') {
            Assert ($errorMessage -match 'Recovery files remain') 'Failed rollback must identify retained recovery files.'
            Assert ($recovery.Count -eq 1) 'Failed rollback must preserve its staging directory.'
            Assert ((Read-TreeHash (Join-Path $recovery[0].FullName 'previous')) -eq $before) 'Complete previous runtime must remain recoverable.'
            Assert (Test-Path -LiteralPath (Join-Path $recovery[0].FullName 'candidate/litert_lm_c.dll')) 'Validated candidate must remain for inspection.'
        } else {
            $pattern = if ($scenario -eq 'validation-failure') { 'fixture validation failed' } elseif ($scenario -eq 'promotion-failure') { 'fixture promotion failed' } else { 'fixture build failed' }
            # First-install build failure exercises the same build command with no previous bundle.
            if ($scenario -eq 'first-build-failure' -and $null -eq $errorMessage) { throw 'First-install fixture build failure did not execute.' }
            Assert ($errorMessage -match $pattern) "Wrong staging failure: $errorMessage"
            Assert ((Read-TreeHash $destination) -eq $before) 'Failed preparation must preserve the previous bundle exactly.'
            Assert ($recovery.Count -eq 0) 'Ordinary failure must clean only its staging directory.'
        }
        $passed += 1
        Write-Host "PASS: $scenario"
    }
    Write-Host "$passed native Windows staging fixture checks passed."
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
