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
 * PowerShell 로 띄워야 하는 명령. `spawn` 은 Windows Terminal 에 새 탭을 여는 일이라
 * `.ps1` 이고, node 로는 부를 수 없다.
 *
 * **유닉스판은 아직 없다.** 없는 것을 있는 척하지 않고 그 자리에서 멈춘다 — 조용히
 * 아무것도 안 하면 작업 세션이 안 떴다는 사실을 아무도 모른다.
 */
const POWERSHELL = { spawn: "spawn.ps1" };

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

const script = COMMANDS[command] ?? POWERSHELL[command];
if (!script) {
  process.stderr.write(`\`${command}\` 는 없는 명령이다.\n\n`);
  usage();
  process.exit(1);
}

const target = fileURLToPath(new URL(script, import.meta.url));

if (POWERSHELL[command] && process.platform !== "win32") {
  process.stderr.write(
    `\`${command}\` 은 PowerShell 스크립트라 Windows 에서만 돈다. 유닉스판은 아직 없다.\n` +
      `직접 \`claude\` 를 열어 역할을 말로 심지 마라 — 그 세션은 HARNESS_ROLE 이 없어\n` +
      `자기를 실행자로 알고 있고, 대화로 덮어쓴 역할은 \`/clear\` 한 번에 사라진다.\n`,
  );
  process.exit(1);
}

const result = POWERSHELL[command]
  ? spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", target, ...rest], {
      stdio: "inherit",
    })
  : spawnSync(process.execPath, [target, ...rest], { stdio: "inherit" });

// 신호로 죽었으면 종료 코드가 null 이다. 0 으로 보고하면 성공으로 오해된다.
process.exit(result.status ?? 1);

function usage() {
  process.stdout.write(
    "사용법: harness <명령>\n\n" +
      "  spawn <원문>   작업 세션을 새 탭에 띄운다 (Windows 전용)\n" +
      "  reap           회수가 끝난 서브에이전트 사본을 거둔다\n" +
      "  doctor         설정과 설치본을 검사해 보고한다\n" +
      "  init           이 저장소에 하네스를 설치한다 (`--dry-run` 으로 먼저 볼 수 있다)\n" +
      "  sync           설치본의 복사본을 패키지 현재 버전으로 다시 쓴다\n\n",
  );
}
