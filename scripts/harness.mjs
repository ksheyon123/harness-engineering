#!/usr/bin/env node
/**
 * `harness` 명령의 진입점. **자체 로직은 없다** — 하위 명령 스크립트로 넘기기만 한다.
 *
 * ## 왜 임포트가 아니라 자식 프로세스인가
 *
 * 하위 명령들은 저마다 종료 코드와 출력 규약을 갖는다(`doctor` 는 오류가 있으면 1,
 * `reap` 은 무엇을 했든 0). 임포트해서 부르면 그 규약을 여기서 다시 구현해야 하고,
 * 스크립트를 직접 실행했을 때와 `harness` 로 불렀을 때의 동작이 갈릴 수 있다.
 * 자식으로 띄우면 **직접 실행하는 것과 정확히 같다.**
 *
 * ## 없는 명령은 여기 적지 않는다
 *
 * 목록에 미리 올려두면 "있는데 안 되는" 상태가 되고, 그것은 없는 것보다 나쁘다.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * 하위 명령 → 이 파일 기준 상대 경로.
 *
 * **설치는 `install/` 에 따로 산다.** 한 번 돌고 마는 일이고 남의 저장소를 고치는
 * 유일한 코드라, 매일 도는 운영 도구(`scripts/`)와 같은 자리에 두지 않는다.
 *
 * **여기에 플랫폼 분기가 없다.** 한때 `spawn` 만 `.ps1` 이라 이 파일이 PowerShell 을
 * 부르고 비Windows 를 막았는데, 그 분기는 `spawn.mjs` 안으로 들어갔다 — 플랫폼이
 * 갈리는 것은 *터미널을 어떻게 여는가* 뿐이지 *어느 명령을 부르는가* 가 아니다.
 */
const COMMANDS = {
  spawn: "spawn.mjs",
  init: "../install/init.mjs",
  sync: "../install/sync.mjs",
  smoke: "../install/smoke.mjs",
  doctor: "doctor.mjs",
  reap: "reap-worktrees.mjs",
  gate: "gate.mjs",
  push: "push.mjs",
};

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "help" || command === "--help" || command === "-h") {
  usage();
  process.exit(command ? 0 : 1);
}

const script = COMMANDS[command];
if (!script) {
  process.stderr.write(`\`${command}\` 는 없는 명령이다.\n\n`);
  usage();
  process.exit(1);
}

const target = fileURLToPath(new URL(script, import.meta.url));

const result = spawnSync(process.execPath, [target, ...rest], { stdio: "inherit" });

// 신호로 죽었으면 종료 코드가 null 이다. 0 으로 보고하면 성공으로 오해된다.
process.exit(result.status ?? 1);

function usage() {
  process.stdout.write(
    "사용법: harness <명령>\n\n" +
      "  spawn <원문>   작업 세션을 새 탭·창에 띄운다 (Windows · macOS)\n" +
      "  gate           게이트를 돌리고, 통과했을 때만 검증 기록을 남긴다\n" +
      "  push [인자…]   push 를 돌리고, 성공했을 때만 알린다 (기본: -u origin <현재-브랜치>)\n" +
      "  reap           회수가 끝난 서브에이전트 사본을 거둔다\n" +
      "  doctor         설정과 설치본을 검사해 보고한다\n" +
      "  init           이 저장소에 하네스를 설치한다 (`--dry-run` 으로 먼저 볼 수 있다)\n" +
      "  sync           설치본의 복사본을 패키지 현재 버전으로 다시 쓴다\n" +
      "  smoke          배선이 살아 있는지 검사하고, 사람이 볼 것을 찍는다\n\n",
  );
}
