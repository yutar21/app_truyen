$ErrorActionPreference = "Continue"
$novelDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $novelDir
Write-Host "== Novel Studio :: 《Đấu Phá Thương Khung — Lục Trần》 / Antigravity CLI (agy) ==" -ForegroundColor Cyan
$agyExe = if (Test-Path "$env:LOCALAPPDATA\agy\bin\agy.exe") { "$env:LOCALAPPDATA\agy\bin\agy.exe" } else { "agy" }
Write-Host "[agent] 启动 $agyExe ，初始指令已注入…" -ForegroundColor DarkGray
$seed = @('--effort','high','--model','gemini-3.8-flash-high','--print-timeout','30m','-p','主编已对【卷02】大纲完成审稿，意见写在 reviews\大纲审稿-卷02.md。请先通读这份审稿，按其中【硬伤】逐条修订对应的 novel_bible.md 与 outlines/ 大纲（重点：节奏/格局升级、压缩事务流水、补爽点、伏笔回收、规模匹配），【隐患/建议】酌情采纳；改完在大纲或 continuity_ledger.md 里留一句修订说明。若某条意见你不认同，可在大纲里简注理由后保留。修订完成后【先不要写正文】，在窗口单独输出一行「【大纲已修订：卷02】」然后停下——系统会核对你是否确实改了大纲文件，核对通过后再开始写正文。','--dangerously-skip-permissions','--output-format','text')
& $agyExe @seed
