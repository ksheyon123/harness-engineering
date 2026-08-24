<#
.SYNOPSIS
    Windows 에서 작업 세션 창을 연다. **이것 말고는 아무것도 하지 않는다.**

.DESCRIPTION
    `scripts/spawn.mjs` 가 부른다. 저장소를 찾고 `claude` 를 찾고 원문을 조립하는 것은
    전부 거기서 끝나 있고, 이 파일에 오는 것은 **이미 완성된 명령의 base64** 하나다.

    **왜 이 조각만 PowerShell 로 남았나.** `wt.exe` 는 앱 실행 별칭이라 PATH 해석이
    평범하지 않다. PowerShell 의 `Get-Command` 는 그것을 확실히 찾는데, Node 에서
    같은 이름을 띄우는 것은 그만큼 확실하지 않다. **검증된 자리를 옮기지 않는다.**

    **왜 base64 인가.** Windows Terminal 은 명령줄의 `;` 를 자기 하위 명령 구분자로
    먹는다. 그대로 넘기면 wt 가 명령을 여러 조각으로 쪼개고 마지막 조각을 실행 파일로
    알고 찾다가 죽는다(0x80070002). 인코딩하면 구분자도 따옴표도 명령줄에 닿지 않는다 —
    남는 것은 `A-Za-z0-9+/=` 뿐이라, Node → PowerShell → wt 세 겹을 지나도 안 깨진다.

.PARAMETER EncodedCommand
    UTF-16LE 로 인코딩한 base64 PowerShell 명령. `spawn.mjs` 가 만든다.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $EncodedCommand
)

$ErrorActionPreference = 'Stop'

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue

if ($wt) {
    & $wt.Source new-tab --title 'harness: work' powershell -NoExit -EncodedCommand $EncodedCommand
}
else {
    # Windows Terminal 이 없으면 새 창으로 떨어진다. 탭이 아니어도 목적은 같다 —
    # 실행자와 **다른 프로세스**여야 역할 변수가 갈린다.
    Start-Process powershell -ArgumentList '-NoExit', '-EncodedCommand', $EncodedCommand
}
