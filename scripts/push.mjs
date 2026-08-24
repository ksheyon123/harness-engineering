#!/usr/bin/env node
/**
 * `harness push` — **push 를 돌리고, 성공했을 때만 알린다.**
 *
 * ## 왜 이 명령이 필요한가 — git 에는 `post-push` 가 없다
 *
 * push 와 얽힌 클라이언트 훅은 `pre-push` 하나뿐이고, 이름 그대로 **올리기 전**에 돈다.
 * 거기서 알림을 쏘면 인증 실패·non-fast-forward 거부로 죽은 push 도 "올라갔다" 고
 * 말하게 된다 — 사람이 자리를 비운 사이 오는 알림인데 그게 거짓이면 없는 것만 못하다.
 *
 * 선례가 답을 준다. 게이트도 같은 모양이었다: npm 이 해 주던 "성공했을 때만" 보장을
 * `harness gate` 가 받아 안았다(`gate.mjs` 의 머리주석). 여기도 같다 — **명령이
 * 종료 코드를 보고, 0 일 때만 쏜다.**
 *
 * ## 이 명령은 push 규약을 강제하지 않는다
 *
 * 보호 브랜치 거부·force-push 금지는 규약의 문장이고 여기서 다시 판정하지 않는다.
 * 이 파일이 하는 일은 **`git push` 를 그대로 넘기고 결과에 따라 알리는 것**뿐이다.
 * 검증의 경계는 이미 `pre-push` 가 쥐고 있고, 그 자리를 둘로 늘리지 않는다.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";
import { notify, where } from "../.claude/hooks/notify.mjs";

/**
 * push 를 돌리고 결과를 낸다.
 *
 * @param {string} tree push 할 트리
 * @param {string[]} args `git push` 에 그대로 넘길 인자. 비어 있으면 현재 브랜치를 겨냥한다.
 * @param {{run?: Function, send?: Function}} [seams] 테스트가 갈아 끼우는 자리
 * @returns {Promise<{args: string[], status: number, sent: boolean, reason: string|null}>}
 */
export async function push(tree, args, seams = {}) {
  const { run = git, send = notify } = seams;

  const target = args.length > 0 ? args : defaultArgs(tree);
  const status = run(["push", ...target], tree);

  // **여기가 전부다.** 0 이 아니면 — 실패든 신호로 죽었든(`null`) — 알리지 않는다.
  if (status !== 0) return { args: target, status: status ?? 1, sent: false, reason: null };

  const place = where(tree);
  const { sent, reason } = await send("push", {
    baseDir: tree,
    text: `⬆ push 했다${place ? ` — ${place}` : ""}\n\`git push ${target.join(" ")}\``,
    detail: { args: target },
  });

  return { args: target, status: 0, sent, reason };
}

/**
 * 인자를 안 줬을 때의 기본. 규약이 정한 것과 같다 — `git push -u origin <현재-브랜치>`.
 *
 * 브랜치를 못 읽으면 **아무 인자도 넣지 않는다.** 추측한 이름으로 올리는 것보다 git 이
 * 자기 기본값(`push.default`)으로 판단하게 두는 편이 낫다.
 */
function defaultArgs(tree) {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: tree,
      env: cleanEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch && branch !== "HEAD" ? ["-u", "origin", branch] : [];
  } catch {
    return [];
  }
}

/** `stdio: "inherit"` 라 git 의 출력이 그대로 사람에게 간다 — 삼키면 왜 거부됐는지 못 본다. */
function git(args, cwd) {
  return spawnSync("git", args, { cwd, env: cleanEnv(), stdio: "inherit" }).status;
}

/** 경로 비교는 `gate.mjs`·`reap-worktrees.mjs` 와 같은 방식이다. */
function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const result = await push(process.cwd(), process.argv.slice(2));
  process.stdout.write(report(result));
  process.exit(result.status);
}

/**
 * 사람이 읽을 한 줄. **알림 실패는 push 의 성패와 분리해서 적는다** — push 는 됐는데
 * 알림만 못 간 상태를 "실패" 로 읽으면 다시 올리려 든다.
 *
 * @param {{args: string[], status: number, sent: boolean, reason: string|null}} result
 */
export function report({ args, status, sent, reason }) {
  if (status !== 0) {
    return `\npush 가 실패했다 — \`git push ${args.join(" ")}\` 가 ${status} 로 끝났다.\n\n`;
  }
  if (sent) return `\npush 했다. 알림을 보냈다.\n\n`;
  return `\npush 했다. **알림은 보내지 않았다** — ${reason ?? "이유를 모른다."}\n\n`;
}
