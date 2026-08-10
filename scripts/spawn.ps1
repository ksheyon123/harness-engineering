<#
.SYNOPSIS
    작업 세션을 새 탭에 띄운다.

.DESCRIPTION
    실행자가 기능 요청·설계 논의를 받았을 때 부르는 스크립트다. 새 탭에 `claude` 를
    띄우면서 자식 프로세스 환경에 역할을 심는다:

        HARNESS_ROLE       = work-session
        HARNESS_SEED_FILE  = 사람의 원문을 담은 임시 파일 경로

    새 세션의 `SessionStart` 훅(.claude/hooks/session-role.mjs)이 그 둘을 읽어, 역할을
    컨텍스트로 주입하고 원문을 첫 메시지로 싣는다.

    **역할을 프로세스 환경에 두는 이유**는 그것이 세션이 만들어낸 값이 아니기 때문이다.
    맨몸 `claude` 에는 변수가 없고, 그 부재가 곧 실행자다. 대화로 심은 역할과 달리
    `/clear` 를 견딘다.

    **원문을 명령줄이 아니라 파일로 넘기는 이유**는 따옴표와 줄바꿈이다. 사람의 원문에
    무엇이 들어 있을지 모르는데, 명령줄에 끼워 넣으면 셸 인용이 깨진다. 파일 경로는
    우리가 만든 값이라 안전하다.

.PARAMETER Request
    사람의 원문. **요약하지 마라** — 요약해서 넘기면 spec 이 그 요약 수준에서 멈춘다.

.PARAMETER DryRun
    탭을 띄우지 않고 실행될 명령만 출력한다.

.EXAMPLE
    scripts/spawn.ps1 "로그인 어떻게 만들까"

.EXAMPLE
    scripts/spawn.ps1 -DryRun "이 오타 고쳐줘"
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Request,

    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

# 이 스크립트는 <repo>/scripts/ 에 있다. 어디서 부르든 저장소 루트를 기준으로 연다 —
# 작업 세션은 논의 구간을 저장소 본체에서 보내야 한다.
$repo = Split-Path -Parent $PSScriptRoot

$seed = (($Request | Where-Object { $_ }) -join ' ').Trim()

# seed 파일은 임시 디렉터리에 둔다. 저장소 안에 두면 작업 세션의 `git add -A` 에 딸려
# 들어간다.
$seedPath = Join-Path ([System.IO.Path]::GetTempPath()) "harness-seed-$([guid]::NewGuid().ToString('N')).txt"
Set-Content -LiteralPath $seedPath -Value $seed -Encoding UTF8

# 새 탭 안에서 직접 env 를 세운다. 이 프로세스에 `$env:` 를 심고 물려주는 방식은
# Windows Terminal 이 이미 떠 있을 때 기존 wt 프로세스가 탭을 만들어 새는 경우가 있다.
$inner = @(
    "`$env:HARNESS_ROLE = 'work-session'"
    "`$env:HARNESS_SEED_FILE = '$seedPath'"
    "Set-Location -LiteralPath '$repo'"
    "claude"
) -join '; '

if ($DryRun) {
    Write-Host "seed file : $seedPath"
    Write-Host "seed text : $seed"
    Write-Host "command   : $inner"
    return
}

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue

if ($wt) {
    & $wt.Source new-tab --title 'harness: work' powershell -NoExit -Command $inner
}
else {
    # Windows Terminal 이 없으면 새 창으로 떨어진다. 탭이 아니어도 목적은 같다 —
    # 실행자와 **다른 프로세스**여야 역할 변수가 갈린다.
    Start-Process powershell -ArgumentList '-NoExit', '-Command', $inner
}

if ($seed) {
    Write-Host "작업 세션을 띄웠다. 원문: $seed"
}
else {
    Write-Host '작업 세션을 띄웠다. 원문이 비었으니 새 탭에서 직접 말하라.'
}
