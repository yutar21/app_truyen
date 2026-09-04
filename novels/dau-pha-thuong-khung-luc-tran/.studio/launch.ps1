$ErrorActionPreference = "Continue"
Set-Location -LiteralPath 'c:\New folder\nice\app_truyen\novels\dau-pha-thuong-khung-luc-tran'
Write-Host "== Novel Studio :: 《Đấu Phá Thương Khung — Lục Trần》 / Antigravity CLI (agy) ==" -ForegroundColor Cyan
Write-Host "[agent] 启动 C:\Users\Admin\AppData\Local\agy\bin\agy.exe ，初始指令已注入…" -ForegroundColor DarkGray
$seed = @('--effort','high','--model','gemini-3.8-flash-high','--print-timeout','30m','-p','作者要把本书里的【Huyền Trọng Dĩnh】改名叫【Huyền Trọng Xích】。这是一次【上下文感知的全书改名】，务必干净、一致、不误伤：第一步：通读 novel_bible.md 弄清【Huyền Trọng Dĩnh】到底是谁——TA 的全名、单名/小名、以及别人对 TA 的各种称呼（如"某老师/老某/小某/姓某"这类），列个清单。第二步：把【所有指向这个角色的叫法】在 novel_bible.md、outlines/、continuity_ledger.md、chapter_index.md 和 chapters/ 下【所有已写章节正文】里，一致改成对应的新叫法（全名→新全名、单名→新单名、"姓X老师"→"姓Y老师"…）。第三步【绝不误伤】：与这个角色无关的同字一律不动——别的同姓角色、地名（如某某村）、以及系统/物件/专有名词里碰巧含这个字的。逐一甄别，宁可少改也不错改。第四步：若这个名字本身牵动设定里的姓氏渊源或伏笔，在 bible 里把相关说明同步理顺，别留自相矛盾。【硬性】只改上述文件，绝不新增或续写任何正文章节(.txt 不许多出一章)。改完在窗口用中文列出：TA 有哪几种叫法、各改了多少处、以及你【故意没动】的同字及原因。然后停下。全程遵守本目录 AGENTS.md 规范。','--dangerously-skip-permissions','--output-format','text')
& 'C:\Users\Admin\AppData\Local\agy\bin\agy.exe' @seed
