#!/usr/bin/env node
/**
 * `harness spawn` — 작업 세션을 **실행자와 다른 프로세스**로 띄운다.
 *
 * 실행자가 기능 요청·설계 논의를 받았을 때 부르는 명령이다. 새 터미널에 `claude` 를
 * 띄우면서 그 자식 프로세스 환경에 역할을 심는다:
 *
 *     HARNESS_ROLE = work-session
 *
 * 새 세션의 `SessionStart` 훅(`.claude/hooks/session-role.mjs`)이 그 값을 읽어 역할
 * 선언을 컨텍스트로 주입한다. 사람의 원문은 `claude` 의 첫 프롬프트 인자로 건넨다 —
 * 탭이 열리는 순간 논의가 시작된다.
 *
 * **역할을 프로세스 환경에 두는 이유**는 그것이 세션이 만들어낸 값이 아니기 때문이다.
 * 맨몸 `claude` 에는 변수가 없고, 그 부재가 곧 실행자다. 대화로 심은 역할과 달리
 * `/clear` 를 견딘다.
 *
 * 원문을 임시 파일로 건네고 훅의 `initialUserMessage` 로 심는 방식도 만들어 봤으나,
 * 설치된 버전에서 아무 일도 일어나지 않았다(파일은 소비되는데 메시지가 안 생긴다).
 * 문서에만 있는 필드에 파이프라인 진입을 걸지 않는다.
 *
 * ## 왜 정책이 Node 에 있나 — 한때 전부 `.ps1` 이었다
 *
 * 저장소를 찾고 · `claude` 를 찾고 · 원문을 조립하는 것은 **플랫폼과 무관한 정책**이다.
 * 그것이 `spawn.ps1` 안에 있었을 때 대가가 둘이었다:
 *
 * - **Windows 밖에서는 파이프라인 전체를 못 썼다.** 유닉스판을 만들려면 그 정책을
 *   통째로 한 벌 더 써야 했고, **사본은 반드시 원본과 어긋난다**
 * - **그 정책의 테스트가 거의 안 돌았다.** PowerShell 과 PATH 의 `claude` 를 둘 다
 *   요구해서, 그 밖의 기계에서는 다섯 개가 통째로 skip 됐다
 *
 * 그래서 이 파일이 정책을 갖고, **플랫폼별로 갈리는 것은 "터미널을 어떻게 여는가"
 * 하나뿐**이다. 정책 테스트는 이제 어느 기계에서도 돈다.
 *
 * ## 어디까지 도나
 *
 * | 플랫폼 | 무엇으로 여나 | 상태 |
 * |---|---|---|
 * | Windows | `spawn.ps1` → `wt.exe new-tab`, 없으면 `Start-Process` 로 새 창 | 검증됨 |
 * | macOS | 일회용 `.command` 스크립트 → `open -a Terminal` 로 새 창 | **테스트 미완** |
 * | 그 밖 | 없다 — 없다고 말하고 종료 코드 1 | |
 *
 * **없는 것을 있는 척하지 않고 그 자리에서 멈춘다.** 조용히 아무것도 안 하면 작업
 * 세션이 안 떴다는 사실을 아무도 모른다.
 *
 * ## macOS 를 `osascript` 가 아니라 일회용 스크립트로 여는 이유
 *
 * `osascript -e 'tell application "Terminal" to do script "…"'` 는 두 가지가 걸린다.
 * 첫째, 처음 부를 때 **자동화 권한(TCC) 승인 대화가 뜬다** — 승인하기 전까지는
 * 실패하는데, 그 실패가 "작업 세션이 안 떴다" 와 구분되지 않는다. 둘째, 명령을
 * AppleScript 문자열 안에 넣어야 해서 **따옴표가 셸·AppleScript 두 겹으로 꼬인다** —
 * `.ps1` 이 `wt` 의 `;` 때문에 base64 로 도망친 것과 같은 종류의 함정이다.
 *
 * 파일로 건네면 명령줄에 닿는 것이 **경로 하나뿐**이라 그 함정이 통째로 사라진다.
 * 원문(사람이 친 요청)이 공용 임시 디렉터리에 잠깐 남으므로 `0700` 디렉터리에 쓰고,
 * 스크립트가 **첫 줄에서 스스로를 지운다**(POSIX 는 열린 fd 를 unlink 해도 읽기가
 * 이어진다).
 *
 * ## 새 창이어도 된다
 *
 * Windows 에서 `wt` 가 없으면 새 창으로 떨어지고, macOS 는 애초에 새 창이다. 탭이든
 * 창이든 **실행자와 다른 프로세스**인 것이 요점이다 — 역할 변수는 거기서 갈린다.
 * (macOS 에서 탭을 여는 것은 System Events 키 입력이라 접근성 권한이 또 필요하다.
 * 권한 대화 하나를 더 세우면서 얻는 것이 탭 하나라면 값이 안 맞는다.)
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";

/** 터미널을 여는 법을 아는 플랫폼. 나머지는 멈춘다. */
export const SUPPORTED = new Set(["win32", "darwin"]);

/**
 * 작업 세션이 열릴 곳은 **부른 사람이 서 있던 저장소**다. 논의 구간을 저장소 본체에서
 * 보내야 하기 때문이다.
 *
 * **스크립트의 위치로 잡지 않는다.** 한때 "내 파일의 부모" 였는데, 그건 이 파일이 곧 그
 * 저장소 안에 있을 때만 맞다. npm 의존성으로 설치되면 이 파일은
 * `<남의 저장소>/node_modules/@scope/harness-engineering/scripts/` 에 있어서, 부모는
 * 패키지 폴더지 저장소 루트가 아니다. 그러면 새 탭이 `node_modules` 안에서 열리고
 * **세 가지가 조용히 어긋난다** — claude 가 패키지의 `.claude/CLAUDE.md` 를 프로젝트
 * 지침으로 읽고, `harness/<task>/spec.md` 가 gitignore 된 곳에 쓰이고(재설치에 소멸),
 * `EnterWorktree` 와 게이트가 엉뚱한 트리를 본다.
 *
 * 그래서 git 에 묻는다. `harness.mjs` 가 cwd 를 그대로 물려주므로 여기 `cwd` 는 사람이
 * 명령을 친 자리다. 다른 하위 명령(`doctor`·`reap`·`init`·`sync`·`smoke`)도 전부 대상
 * 트리를 `process.cwd()` 로 잡는다 — 자기 위치는 패키지를 찾는 데만 쓴다.
 *
 * @param {string} cwd 사람이 명령을 친 자리
 * @returns {string} 저장소 루트(네이티브 표기)
 */
export function repoRoot(cwd) {
  const found = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
  });

  if (found.error) {
    throw new Error("git 을 PATH 에서 찾지 못했다. 작업 세션을 어디에 열지 정할 수 없다.");
  }
  const top = (found.stdout ?? "").split(/\r?\n/)[0]?.trim();
  if (found.status !== 0 || !top) {
    throw new Error(`여기는 git 저장소가 아니다(${cwd}). 하네스가 설치된 저장소에서 불러라.`);
  }

  // git 은 슬래시로 답한다. 네이티브 표기와 실제 대소문자로 되돌린다 — 새 터미널이
  // `cd` 할 문자열이라 그대로 쓸 수 있어야 한다.
  return realpathSync.native(resolve(top));
}

/**
 * `claude` 를 **탭을 띄우기 전에** 해석한다. 못 찾으면 여기서 실패하는 편이 낫다 —
 * 새 창에서 실패하면 그 창은 에러만 띄운 채 남고, 사람은 왜 죽었는지 보려고 그 창을
 * 뒤져야 한다.
 *
 * 절대경로로 박아 넣는 이유는 **새 터미널의 PATH 가 여기와 같다는 보장이 없기**
 * 때문이다(로그인 셸이 rc 를 다시 읽는다). 지금 이 자리에서 해석된 경로는 거기서도
 * 유효하다.
 *
 * 플랫폼마다 묻는 방식이 다른 것은 **셸이 다르기 때문**이다. Windows 의 `claude` 는
 * npm 이 만든 shim 셋(`claude` · `claude.cmd` · `claude.ps1`)이라, 새 탭이 PowerShell 인
 * 이상 **PowerShell 이 고르는 것**을 그대로 받아야 한다. `where.exe` 로 물으면 PATH
 * 순서대로 나열되어 확장자 없는 sh 판이 먼저 잡힐 수 있다 — PowerShell 은 그것을 못
 * 돌린다.
 *
 * @param {NodeJS.Platform} platform
 * @returns {string|null} 실행 파일 경로. 못 찾으면 `null`
 */
export function findClaude(platform) {
  const probe =
    platform === "win32"
      ? spawnSync(
          "powershell",
          ["-NoProfile", "-Command", "(Get-Command claude -ErrorAction SilentlyContinue).Source"],
          { env: cleanEnv(), encoding: "utf8" },
        )
      : spawnSync("sh", ["-c", "command -v claude"], { env: cleanEnv(), encoding: "utf8" });

  if (probe.error || probe.status !== 0) return null;
  return (probe.stdout ?? "").split(/\r?\n/)[0]?.trim() || null;
}

/** PowerShell 작은따옴표 규칙 — `'` 하나를 `''` 로. */
const ps = (value) => String(value).replace(/'/g, "''");

/** POSIX 셸 작은따옴표 규칙 — 따옴표를 닫고 이스케이프한 뒤 다시 연다. */
const sh = (value) => String(value).replace(/'/g, `'\\''`);

/**
 * 새 터미널이 실행할 명령 본문. **여기서 따옴표가 전부 통제된다** — 아래 launch 가
 * 명령줄에 싣는 것은 base64 이거나 임시 파일 경로뿐이라, 이 문자열 밖으로 새는 것이
 * 없다.
 *
 * @param {{platform: NodeJS.Platform, repo: string, claude: string, seed: string}} target
 * @returns {string}
 */
export function command({ platform, repo, claude, seed }) {
  if (platform === "win32") {
    // 새 탭 안에서 직접 env 를 세운다. 이 프로세스에 심고 물려주는 방식은 Windows
    // Terminal 이 이미 떠 있을 때 기존 wt 프로세스가 탭을 만들어 새는 경우가 있다.
    return [
      `$env:HARNESS_ROLE = 'work-session'`,
      `Set-Location -LiteralPath '${ps(repo)}'`,
      seed ? `& '${ps(claude)}' '${ps(seed)}'` : `& '${ps(claude)}'`,
    ].join("\n");
  }

  return [
    "#!/bin/sh",
    "# harness spawn 이 만든 일회용 런처다. 아래 두 줄에서 스스로를 지운다 —",
    "# POSIX 는 열린 파일을 unlink 해도 읽던 것을 끝까지 읽는다.",
    `rm -f "$0"`,
    `rmdir "$(dirname "$0")" 2>/dev/null`,
    "",
    "export HARNESS_ROLE=work-session",
    // `cd` 가 실패해도 창을 닫지 않는다. 닫으면 사람은 아무것도 못 본다.
    `cd '${sh(repo)}' || echo "harness spawn: 저장소로 이동하지 못했다 — ${sh(repo)}" >&2`,
    seed ? `'${sh(claude)}' '${sh(seed)}'` : `'${sh(claude)}'`,
    // claude 가 끝나도 창을 남긴다. Windows 의 `-NoExit` 과 같은 자리다.
    `exec "\${SHELL:-/bin/sh}" -l`,
    "",
  ].join("\n");
}

/**
 * 무엇을 어디에 띄울지 **정하기만** 한다. 띄우지는 않는다 — `--dry-run` 이 이 결과를
 * 그대로 찍고, 테스트도 이것을 본다.
 *
 * @param {{cwd: string, seed: string, platform?: NodeJS.Platform,
 *          resolveRepo?: (cwd: string) => string,
 *          resolveClaude?: (platform: NodeJS.Platform) => string|null}} options
 * @returns {{repo: string, claude: string, seed: string, command: string}}
 */
export function plan({
  cwd,
  seed,
  platform = process.platform,
  resolveRepo = repoRoot,
  resolveClaude = findClaude,
}) {
  if (!SUPPORTED.has(platform)) {
    throw new Error(
      `\`spawn\` 은 ${platform} 에서 터미널을 여는 법을 모른다 — Windows 와 macOS 판만 있다.\n` +
        `직접 \`claude\` 를 열어 역할을 말로 심지 마라 — 그 세션은 HARNESS_ROLE 이 없어\n` +
        `자기를 실행자로 알고 있고, 대화로 덮어쓴 역할은 \`/clear\` 한 번에 사라진다.`,
    );
  }

  const repo = resolveRepo(cwd);
  const claude = resolveClaude(platform);
  if (!claude) {
    throw new Error("claude 를 PATH 에서 찾지 못했다. 작업 세션을 띄울 수 없다.");
  }

  return { repo, claude, seed, command: command({ platform, repo, claude, seed }) };
}

/**
 * 실제로 띄운다. **플랫폼이 갈리는 곳은 여기 하나뿐이다.**
 *
 * @param {{platform: NodeJS.Platform, command: string}} target
 */
export function launch({ platform, command: text }) {
  if (platform === "win32") {
    // **base64 로 넘긴다.** Windows Terminal 은 명령줄의 `;` 를 자기 하위 명령
    // 구분자로 먹는다. 그대로 넘기면 wt 가 명령을 여러 조각으로 쪼개고 마지막 조각을
    // 실행 파일로 알고 찾다가 죽는다(0x80070002). 인코딩하면 구분자도 따옴표도
    // 명령줄에 닿지 않는다 — 남는 것은 `A-Za-z0-9+/=` 뿐이다.
    //
    // 띄우는 것 자체를 `.ps1` 에 남겨두는 이유는 `wt.exe` 다. 그것은 앱 실행 별칭이라
    // PATH 해석이 평범하지 않고, PowerShell 의 `Get-Command` 는 그것을 확실히 찾는다.
    const encoded = Buffer.from(text, "utf16le").toString("base64");
    const script = fileURLToPath(new URL("./spawn.ps1", import.meta.url));
    return spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-EncodedCommand", encoded],
      { stdio: "inherit" },
    );
  }

  // `mkdtemp` 는 `0700` 디렉터리를 만든다. 원문(사람이 친 요청)이 잠깐 디스크에 남으므로
  // 공용 임시 디렉터리에 그냥 던지지 않는다.
  const dir = mkdtempSync(join(tmpdir(), "harness-spawn-"));
  const script = join(dir, "work-session.command");
  // `.command` 는 macOS 가 Terminal 에 연결해 둔 확장자다. 실행 비트가 있어야 돈다.
  writeFileSync(script, text, { mode: 0o700 });

  return spawnSync("open", ["-a", "Terminal", script], { stdio: "inherit" });
}

/** 경로 비교는 `gate`·`reap-worktrees` 와 같은 방식이다. */
function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  // 원문은 **요약하지 않고 그대로** 잇는다. 요약해서 넘기면 spec 이 그 요약 수준에서
  // 멈춘다 — 재료가 그것뿐이기 때문이다.
  const seed = argv
    .filter((arg) => arg !== "--dry-run")
    .join(" ")
    .trim();

  let target;
  try {
    target = plan({ cwd: process.cwd(), seed });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  if (dryRun) {
    process.stdout.write(
      `repo    : ${target.repo}\n` +
        `claude  : ${target.claude}\n` +
        `command :\n${target.command}\n`,
    );
    process.exit(0);
  }

  const result = launch({ platform: process.platform, command: target.command });
  if (result.error || result.status !== 0) {
    process.stderr.write(
      `작업 세션을 띄우지 못했다 — ${result.error?.message ?? `종료 코드 ${result.status}`}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    seed
      ? `작업 세션을 띄웠다. 원문: ${seed}\n`
      : "작업 세션을 띄웠다. 원문이 비었으니 새 창에서 직접 말하라.\n",
  );
}
