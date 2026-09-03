$ErrorActionPreference = "Continue"
Set-Location -LiteralPath 'C:\Users\Duk\.gemini\antigravity-ide\scratch\novels\dau-pha-thuong-khung-luc-tran'
Write-Host "== Novel Studio :: 《dau-pha-thuong-khung-luc-tran》 / Antigravity CLI (agy) ==" -ForegroundColor Cyan
Write-Host "[agent] 启动 C:\Users\Duk\AppData\Local\agy\bin\agy.exe ，初始指令已注入…" -ForegroundColor DarkGray
$seed = @('--effort','high','-p','请阅读本项目的 AGENTS.md/CLAUDE.md 写作规范与 novel_bible.md，然后续写下一批 3 章并在结束后自检。','--dangerously-skip-permissions','--output-format','text')
& C:\Users\Duk\AppData\Local\agy\bin\agy.exe @seed
