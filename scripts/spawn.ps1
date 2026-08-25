<#
.SYNOPSIS
    Windows 에서 작업 세션 창을 연다. **이것 말고는 아무것도 하지 않는다.**

.DESCRIPTION
    `scripts/spawn.mjs` 가 부른다. 저장소를 찾고 `claude` 를 찾고 명령 본문을 짓는 것은
    전부 거기서 끝나 있고, 이 파일에 오는 것은 **런처 스크립트의 경로** 하나다.

    **왜 이 조각만 PowerShell 로 남았나.** `wt.exe` 는 앱 실행 별칭이라 PATH 해석이
    평범하지 않다. PowerShell 의 `Get-Command` 는 그것을 확실히 찾는데, Node 에서
    같은 이름을 띄우는 것은 그만큼 확실하지 않다. **검증된 자리를 옮기지 않는다.**

    **왜 base64 가 아니라 경로인가.** Windows Terminal 은 명령줄의 `;` 를 자기 하위 명령
    구분자로 먹는다. 그래서 한때 명령 본문을 통째로 base64(utf16le)로 인코딩해 넘겼다.
    구분자와 따옴표는 확실히 막았지만 **본문 전체가 명령줄에 실렸고**, 인코딩이 원문을
    2.67배로 부풀려 한글 약 12,100자에서 명령줄 상한(32767)을 쳤다(실측).

    이제 본문은 임시 파일로 가고 여기 오는 것은 그 경로뿐이다. 임시 경로에는 `;` 도
    따옴표도 없으므로 wt 의 함정은 그대로 피하면서 **상한이 사라진다.** macOS 판이
    원래 이 모양이었다 — 두 플랫폼이 이제 같은 방식으로 넘긴다.

    `-ExecutionPolicy Bypass` 가 필요하다. 런처는 `%TEMP%` 에 방금 만들어진 서명 없는
    `.ps1` 이라, 기본 정책(RemoteSigned/AllSigned)에서는 실행이 거부된다.

.PARAMETER ScriptPath
    새 창에서 실행할 런처 `.ps1` 의 경로. `spawn.mjs` 가 만들고, 그 런처가 원문을
    옆의 `seed.txt` 에서 읽은 뒤 자기와 원문을 지운다.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ScriptPath
)

$ErrorActionPreference = 'Stop'

$arguments = @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath)

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue

if ($wt) {
    & $wt.Source new-tab --title 'harness: work' powershell @arguments
}
else {
    # Windows Terminal 이 없으면 새 창으로 떨어진다. 탭이 아니어도 목적은 같다 —
    # 실행자와 **다른 프로세스**여야 역할 변수가 갈린다.
    Start-Process powershell -ArgumentList $arguments
}
