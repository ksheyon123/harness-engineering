#!/usr/bin/env node
/**
 * 게이트가 green 으로 끝난 커밋을 기록한다. `package.json` 의 `posttest` 가 부른다 —
 * npm 은 `test` 가 **성공했을 때만** `posttest` 를 돌리므로, 이 파일에 이름이 오르는 것은
 * 곧 "이 sha 에서 게이트가 통과했다" 는 뜻이다.
 *
 * `pre-push` 가 이 목록을 읽는다. 둘을 나눈 이유는 **게이트 정의의 단일 출처를 지키기**
 * 위해서다 — 무엇을 돌릴지는 `scripts.test` 가 정하고, 여기는 그 결과를 적기만 한다.
 * 훅이 `npm test` 를 직접 부르면 push 마다 몇 분이 붙고, 그때 돌린 것이 정말 게이트인지도
 * 사본이 정한다.
 *
 * 기록은 **gitdir 안**에 둔다. 추적되지 않고, worktree 마다 자연히 갈리고, worktree 가
 * 사라질 때 함께 사라진다.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { markerPath } from "./verified-marker.mjs";

/** 최근 것만 남긴다. amend·rebase 로 sha 가 갈리므로 하나만 두면 금세 어긋난다. */
const KEEP = 50;

const path = markerPath();
if (!path) process.exit(0); // git 저장소가 아니다 — 기록할 곳이 없다.

let head;
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  process.exit(0); // 커밋이 하나도 없다. 기록할 sha 자체가 없다.
}

let existing = [];
try {
  existing = readFileSync(path, "utf8").split("\n").filter(Boolean);
} catch {
  /* 아직 없다. */
}

if (existing[existing.length - 1] === head) process.exit(0);

try {
  mkdirSync(dirname(path), { recursive: true });
  if (existing.length + 1 > KEEP) {
    writeFileSync(path, `${[...existing.slice(-(KEEP - 1)), head].join("\n")}\n`);
  } else {
    appendFileSync(path, `${head}\n`);
  }
} catch {
  // 기록 실패가 게이트 결과를 뒤집어서는 안 된다. push 때 막히고, 그때 다시 돌리면 된다.
}
