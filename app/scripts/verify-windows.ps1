# ============================================================================
# MFP Windows 跨平台发布验证脚本（Issue #6 Windows 清单一键执行）
#
# 用法（Windows 机器，PowerShell）：
#   cd <MFP 仓库>\app
#   npm install ; npm run build:bridge
#   powershell -ExecutionPolicy Bypass -File scripts\verify-windows.ps1 -Root ..
#
# 可选参数：
#   -BridgeServer <path>   显式指定 bridge-server.cjs（默认按候选路径查找）
#   -OpenTerminal          额外打开一个 wt/PowerShell 窗口验证终端可用（不调用模型）
#
# 覆盖 Issue #6 Windows 待验收清单第 1/2/5/6/9 项；
# 第 3/4 项（真实启动 Claude Code 会话）建议用桌面 App 走一遍完整流程。
# ============================================================================

param(
    [string]$Root = (Get-Location).Path,
    [string]$BridgeServer = "",
    [switch]$OpenTerminal
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$script:Results = @()
function Add-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail = "")
    $script:Results += [PSCustomObject]@{ Name = $Name; Ok = $Ok; Detail = $Detail }
    $mark = if ($Ok) { "PASS" } else { "FAIL" }
    Write-Host ("[{0}] {1} {2}" -f $mark, $Name, $Detail) -ForegroundColor $(if ($Ok) { "Green" } else { "Red" })
}

Write-Host "=== MFP Windows 跨平台验证（Root=$Root）==="

# ---- 1. Node 定位（PATH ; 分隔 + node.exe/node.cmd 候选，与 Rust/TS 解析一致）----
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    $candidates = @("node.exe", "node.cmd", "node") | ForEach-Object {
        $env:PATH.Split(";") | Where-Object { $_ } | ForEach-Object { Join-Path $_ $PSItem }
    }
    $node = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($node) {
    $nodeVer = & node --version 2>$null
    Add-Check "node 定位" $true "$($node.Source) $nodeVer"
    $script:NodeBin = "node"
} else {
    Add-Check "node 定位" $false "PATH 未找到 node（Windows 解析：; 分隔 + .exe/.cmd 候选）"
}

# ---- 2. Claude Code CLI ----
$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
    $claudeVer = & claude --version 2>$null
    Add-Check "claude CLI" $true "$($claude.Source) $claudeVer"
} else {
    Add-Check "claude CLI" $false "PATH 未找到 claude（请先安装并登录 Claude Code）"
}

# ---- 3. bridge-server.cjs 定位（与 Rust server_script_candidates 一致的候选）----
if (-not $BridgeServer) {
    $candidates = @(
        (Join-Path $Root "app\dist-bridge\bridge-server.cjs"),
        (Join-Path $Root "dist-bridge\bridge-server.cjs"),
        (Join-Path $Root "app\src-tauri\..\dist-bridge\bridge-server.cjs")
    ) | Where-Object { Test-Path $_ }
    $BridgeServer = $candidates | Select-Object -First 1
}
if ($BridgeServer -and (Test-Path $BridgeServer)) {
    Add-Check "bridge-server.cjs 定位" $true $BridgeServer
} else {
    Add-Check "bridge-server.cjs 定位" $false "候选路径均未命中：先在 app\ 下运行 npm run build:bridge"
}

# ---- 4. RPC 冒烟（--adapter fake，不调用真实模型）----
if ($node -and $BridgeServer) {
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "node"
        $psi.Arguments = "`"$BridgeServer`" --root `"$Root`" --adapter fake"
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $proc = [System.Diagnostics.Process]::Start($psi)

        function Invoke-Rpc([int]$Id, [string]$Method, [string]$ParamsJson) {
            $line = '{"id":' + $Id + ',"method":"' + $Method + '","params":' + $ParamsJson + '}'
            $proc.StandardInput.WriteLine($line)
            $proc.StandardInput.Flush()
            return $proc.StandardOutput.ReadLine() | ConvertFrom-Json
        }

        $pong = Invoke-Rpc 1 "ping" "{}"
        Add-Check "RPC ping" ($pong.ok -eq $true) ""

        $wpJson = Invoke-Rpc 2 "saveRawInput" '{"req":{"text":"Windows 验证：码表闪退","sourceDescription":"verify-windows.ps1"}}'
        Add-Check "RPC saveRawInput" ($wpJson.ok -eq $true) "requestId=$($wpJson.result.requestId)"

        if ($wpJson.ok) {
            $rid = $wpJson.result.requestId
            $rec = Invoke-Rpc 3 "recognize" ('{"requestId":"' + $rid + '"}')
            Add-Check "RPC recognize(fake)" ($rec.ok -eq $true -and $rec.result.category -eq "bug") "category=$($rec.result.category)"

            $wpFile = Join-Path $Root (".mfp\work\{0}.json" -f $rid)
            Add-Check "工作包落盘" (Test-Path $wpFile) $wpFile
        }

        $proc.Kill()
    }
    catch {
        Add-Check "RPC 冒烟" $false $_.Exception.Message
    }
}

# ---- 5. 会话目录 sanitization 真机核对（清单第 6 项）----
# 规则（由 macOS 观察外推）：cwd 非字母数字字符替换为 '-'。此处验证 Windows
# 真实布局是否一致：~/.claude/projects 下应存在对应目录（本机跑过 claude 才有）。
$sanitized = ($Root -replace '[^a-zA-Z0-9]', '-')
$projectsDir = Join-Path $env:USERPROFILE ".claude\projects"
$expectedDir = Join-Path $projectsDir $sanitized
if (Test-Path $expectedDir) {
    Add-Check "会话目录 sanitization" $true "存在 $expectedDir（与 sanitizeProjectDir 规则一致）"
} else {
    $anyMatch = Get-ChildItem $projectsDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq $sanitized }
    Add-Check "会话目录 sanitization" ($null -ne $anyMatch) `
        "未找到 $expectedDir（若本目录从未运行过 claude 属正常；否则核对实际目录名与规则 '$sanitized' 是否一致）"
}

# ---- 6. 终端可用性与启动计划（清单第 1/9 项，不调用模型）----
$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($wt) {
    Add-Check "Windows Terminal (wt.exe)" $true $wt.Source
} else {
    Add-Check "Windows Terminal (wt.exe)" $false "未安装 Windows Terminal，将回退 powershell.exe"
}
$ps = Get-Command powershell.exe -ErrorAction SilentlyContinue
Add-Check "PowerShell 回退" ($null -ne $ps) $(if ($ps) { $ps.Source } else { "未找到 powershell.exe" })

# 打印将使用的启动计划（与 app/src/bridge/terminal-launcher.ts 构造一致，供肉眼核对转义）
$startupDemo = Join-Path $Root ".mfp\work\DEMO.startup.txt"
$terminalCmd = if ($wt) { "wt.exe" } else { "powershell.exe" }
$inner = "& 'claude' --resume <sessionId> --name 'MFP · <requestId>' (Get-Content -Raw '$startupDemo')"
Write-Host ""
Write-Host ("启动计划示例（{0}）：" -f $terminalCmd) -ForegroundColor Cyan
if ($wt) { Write-Host "  wt.exe -d `"$Root`" powershell -NoExit -Command `"$inner`"" }
else     { Write-Host "  powershell.exe -NoExit -Command `"Set-Location -LiteralPath '$Root'; $inner`"" }

if ($OpenTerminal) {
    if ($wt) { Start-Process wt.exe -ArgumentList "-d", "`"$Root`"" }
    else     { Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '$Root'" }
    Add-Check "终端窗口打开" $true "已打开 $terminalCmd 窗口（请手动关闭）"
}

# ---- 汇总 ----
Write-Host ""
$fail = @($script:Results | Where-Object { -not $_.Ok }).Count
$total = @($script:Results).Count
if ($fail -eq 0) {
    Write-Host "=== 结果：$total/$total 全部通过 ===" -ForegroundColor Green
    exit 0
} else {
    Write-Host "=== 结果：$($total - $fail)/$total 通过，$fail 项失败 ===" -ForegroundColor Red
    exit 1
}
