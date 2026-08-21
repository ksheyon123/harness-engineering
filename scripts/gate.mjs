#!/usr/bin/env node
/**
 * `harness gate` — **게이트를 돌리고, 통과했을 때만 그 사실을 기록한다.**
 *
 * ## 왜 이 명령이 생겼나 — `posttest` 가 옵트인 경계를 깼다
 *
 * 기록은 원래 `package.json` 의 `posttest` 가 남겼다. npm 이 `test` 가 0 일 때만
 * `posttest` 를 돌려 주므로 "성공했을 때만" 이 공짜였다. 편했지만 자리가 틀렸다.
 *
 * **하네스는 로컬 설정으로 옵트인한다.** `core.hooksPath` 는 `.git/config` 에 있어
 * 클론에 안 따라오고, 그래서 설치하지 않은 사람에게는 층 2 가 안 붙는다. 규약 문서도
 * 에이전트 정의도 커밋되지만 그것들은 *읽히는* 것뿐이라 무해하다.
 *
 * **`posttest` 만 그 경계를 깼다.** `package.json` 은 A 의 파일이라 언제나 추적되므로,
 * 그 한 줄은 **커밋을 타고 팀 전체에 전파된다.** 그리고 `npm test` 는 Claude Code 밖에서
 * 개발자와 CI 가 매일 치는 명령이다. 실측한 결과가 둘로 갈렸다:
 *
 * | A 의 `.gitignore` | 설치한 적 없는 사람의 `npm test` |
 * |---|---|
 * | `.githooks/` 커밋 | **돈다.** 마커가 써지는데 그것을 읽을 `pre-push` 는 안 붙어 있다 — 아무도 안 읽는 파일이 쌓인다 |
 * | `.githooks/` 무시 | **깨진다.** `MODULE_NOT_FOUND`, 종료 코드 1. 테스트는 다 통과했는데 |
 *
 * 뒤엣것이 특히 나쁘다 — A 가 "하네스는 개인 도구" 를 골랐는데 그 결정이 팀과 CI 로
 * 전파되어 `npm test` 를 깨뜨린다.
 *
 * **명령은 배선과 다르다.** 이 파일은 커밋으로 전파되지 않고, 치지 않으면 돌지 않는다.
 * 하네스의 나머지 조각과 같은 성질(로컬 옵트인)로 돌아온다.
 *
 * ## 급소는 하나뿐이다
 *
 * npm 이 해 주던 **"성공했을 때만 기록"** 보장이 이 파일로 넘어왔다. 실패했는데 적으면
 * `pre-push` 는 검증된 적 없는 트리를 통과시키고, 그 순간 층 2 의 그 방어선이 통째로
 * 무의미해진다. 그래서 여기서는 판정을 **한 줄로** 유지한다 — `status === 0` 이 아니면
 * 아무것도 적지 않는다.
 *
 * `status` 가 `null` 인 경우(신호로 죽었다)도 0 이 아니므로 걸린다. **그걸 성공으로 읽지
 * 않도록 `!== 0` 이 아니라 `=== 0` 으로 쓴다** — `null !== 0` 은 참이지만, 조건을 뒤집어
 * 적다 보면 그 자리가 흐려진다.
 *
 * ## 무엇을 돌리는가는 여기가 정하지 않는다
 *
 * `harness.config.json` 의 `gate` 다(기본값 `npm test`). 이 파일은 그 문자열을 셸에
 * 넘기고 종료 코드를 그대로 전달할 뿐이다 — **게이트 정의의 단일 출처는 그대로다.**
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../.claude/hooks/harness-config.mjs";
import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";
import { recordVerified } from "../.githooks/verified-marker.mjs";

/**
 * 게이트를 돌리고 결과를 낸다. **기록까지 여기서 한다.**
 *
 * @param {string} tree 게이트를 돌릴 트리
 * @param {(command: string) => number|null} [run] 명령 러너(테스트가 갈아 끼운다). 종료 코드를 낸다.
 * @param {(cwd: string) => boolean} [record] 마커 기록(테스트가 갈아 끼운다)
 * @returns {{gate: string, status: number, recorded: boolean}}
 */
export function gate(tree, run = shell, record = recordVerified) {
  const command = loadConfig(tree).gate;
  const status = run(command, tree);

  // **여기가 전부다.** 0 이 아니면 — 실패든 신호로 죽었든(`null`) — 적지 않는다.
  const passed = status === 0;

  return {
    gate: command,
    // `null` 을 그대로 흘리면 부르는 쪽이 종료 코드로 못 쓴다. 신호사는 1 로 본다.
    status: status ?? 1,
    recorded: passed ? record(tree) : false,
  };
}

/**
 * 셸로 돌린다. **문자열을 통째로 넘긴다** — `gate` 는 `npm test` 처럼 여러 토막이고,
 * Windows 의 `npm` 은 배치 래퍼라 셸 없이는 Node 20+ 가 띄우기를 거부한다(EINVAL).
 *
 * `stdio: "inherit"` 라 게이트의 출력이 그대로 사람에게 간다 — 삼키면 red 일 때 왜
 * 실패했는지 볼 수가 없다.
 */
function shell(command, cwd) {
  const result = spawnSync(command, {
    cwd,
    env: cleanEnv(),
    shell: true,
    stdio: "inherit",
  });
  return result.status;
}

/** 경로 비교는 `reap-worktrees` 와 같은 방식이다. */
function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const result = gate(process.cwd());
  process.stdout.write(report(result));
  process.exit(result.status);
}

/** @param {{gate: string, status: number, recorded: boolean}} result */
export function report({ gate: command, status, recorded }) {
  if (status !== 0) {
    return (
      `\n게이트가 실패했다 — \`${command}\` 가 ${status} 로 끝났다.\n` +
      `기록을 남기지 않았다. **이 커밋은 push 되지 않는다.**\n\n`
    );
  }
  if (!recorded) {
    return (
      `\n게이트는 통과했는데 **기록을 못 남겼다.**\n` +
      `커밋이 없거나 gitdir 에 쓸 수 없는 상태다 — 이대로면 push 가 막힌다.\n\n`
    );
  }
  return `\n게이트 통과. 이 커밋을 검증된 것으로 기록했다 — push 할 수 있다.\n\n`;
}
