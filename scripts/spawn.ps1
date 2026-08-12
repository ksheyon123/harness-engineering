<#
.SYNOPSIS
    작업 세션을 새 탭에 띄운다.

.DESCRIPTION
    실행자가 기능 요청·설계 논의를 받았을 때 부르는 스크립트다. 새 탭에 `claude` 를
    띄우면서 자식 프로세스 환경에 역할을 심는다:

        HARNESS_ROLE = work-session

    새 세션의 `SessionStart` 훅(.claude/hooks/session-role.mjs)이 그 값을 읽어 역할
    선언을 컨텍스트로 주입한다. 사람의 원문은 `claude` 의 첫 프롬프트로 건넨다.

    **역할을 프로세스 환경에 두는 이유**는 그것이 세션이 만들어낸 값이 아니기 때문이다.
    맨몸 `claude` 에는 변수가 없고, 그 부재가 곧 실행자다. 대화로 심은 역할과 달리
    `/clear` 를 견딘다.

    원문을 임시 파일로 건네고 훅의 `initialUserMessage` 로 심는 방식도 만들어 봤으나,
    설치된 버전에서 아무 일도 일어나지 않았다(파일은 소비되는데 메시지가 안 생긴다).
    문서에만 있는 필드에 파이프라인 진입을 걸지 않는다.

.PARAMETER Request
    사람의 원문. **요약하지 마라** — 요약해서 넘기면 spec 이 그 요약 수준에서 멈춘다.

.PARAMETER DryRun
    탭을 띄우지 않고 실행될 명령만 출력한다.

.EXAMPLE
    harness spawn "로그인 어떻게 만들까"

.EXAMPLE
    harness spawn -DryRun "이 오타 고쳐줘"
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

# claude 를 미리 해석한다. 못 찾으면 탭을 띄우기 전에 여기서 실패하는 편이 낫다 —
# 새 탭에서 실패하면 그 창은 에러만 띄운 채 남고, 사람은 왜 죽었는지 보려고 그 창을
# 뒤져야 한다.
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) {
    throw "claude 를 PATH 에서 찾지 못했다. 작업 세션을 띄울 수 없다."
}

# 원문은 **claude 의 명령줄 인자로** 넘긴다. 그래야 진짜 첫 메시지가 되어 세션이 곧바로
# 논의를 시작한다. (`SessionStart` 훅의 `initialUserMessage` 로도 심어봤으나 설치된
# 버전에서 아무 일도 일어나지 않았다 — 문서에만 있는 필드에 파이프라인 진입을 걸지 않는다.)
#
# 따옴표는 여기서 통제된다. 아래 명령 전체가 base64 로 인코딩되어 wt 명령줄에 닿지
# 않으므로, PowerShell 작은따옴표 규칙(`'` 을 `''` 로) 하나만 지키면 된다.
$launch = if ($seed) { "& '$claude' '$($seed -replace "'", "''")'" } else { "& '$claude'" }

# 새 탭 안에서 직접 env 를 세운다. 이 프로세스에 `$env:` 를 심고 물려주는 방식은
# Windows Terminal 이 이미 떠 있을 때 기존 wt 프로세스가 탭을 만들어 새는 경우가 있다.
$inner = @(
    "`$env:HARNESS_ROLE = 'work-session'"
    "Set-Location -LiteralPath '$repo'"
    $launch
) -join "`n"

# **base64 로 넘긴다.** Windows Terminal 은 명령줄의 `;` 를 자기 하위 명령 구분자로
# 먹는다. 그대로 넘기면 wt 가 `$env:... ; ... ; claude` 를 여러 개의 wt 명령으로 쪼개고
# 마지막 조각을 실행 파일로 알고 찾다가 죽는다(0x80070002). 인코딩하면 구분자도
# 따옴표도 명령줄에 닿지 않는다.
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))

if ($DryRun) {
    Write-Host "claude  : $claude"
    Write-Host "command :"
    Write-Host $inner
    return
}

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue

if ($wt) {
    & $wt.Source new-tab --title 'harness: work' powershell -NoExit -EncodedCommand $encoded
}
else {
    # Windows Terminal 이 없으면 새 창으로 떨어진다. 탭이 아니어도 목적은 같다 —
    # 실행자와 **다른 프로세스**여야 역할 변수가 갈린다.
    Start-Process powershell -ArgumentList '-NoExit', '-EncodedCommand', $encoded
}

if ($seed) {
    Write-Host "작업 세션을 띄웠다. 원문: $seed"
}
else {
    Write-Host '작업 세션을 띄웠다. 원문이 비었으니 새 탭에서 직접 말하라.'
}
