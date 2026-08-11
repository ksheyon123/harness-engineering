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
 */
const COMMANDS = {
  init: "../install/init.mjs",
  sync: "../install/sync.mjs",
  doctor: "doctor.mjs",
  reap: "reap-worktrees.mjs",
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

const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL(script, import.meta.url)), ...rest],
  { stdio: "inherit" },
);

// 신호로 죽었으면 종료 코드가 null 이다. 0 으로 보고하면 성공으로 오해된다.
process.exit(result.status ?? 1);

function usage() {
  process.stdout.write(
    "사용법: harness <명령>\n\n" +
      "  init     이 저장소에 하네스를 설치한다 (`--dry-run` 으로 먼저 볼 수 있다)\n" +
      "  sync     설치본의 복사본을 패키지 현재 버전으로 다시 쓴다\n" +
      "  doctor   harness.config.json 을 검사해 보고한다\n" +
      "  reap     회수가 끝난 서브에이전트 사본을 거둔다\n\n",
  );
}
