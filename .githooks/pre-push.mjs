#!/usr/bin/env node
/**
 * 층 2 — `pre-push`. **green 아닌 것이 origin 에 올라가지 않게** 막는다.
 *
 * 게이트를 여기서 돌리지 않는다. 대신 `posttest` 가 남긴 verified marker 를 읽어, **지금
 * 올리려는 커밋이 게이트를 통과한 적 있는가**만 본다. 밀리초로 끝나고, 무엇이 게이트인지는
 * 여전히 `package.json` 의 `scripts.test` 혼자 정한다.
 *
 * 그래서 순서가 하나 강제된다: **커밋한 뒤에 게이트를 돌리고 push 한다.** 커밋 전에
 * 돌린 green 은 그 커밋의 것이 아니다 — 회수·QA 로 트리가 더 움직인 뒤라면 더욱 그렇다.
 * 로컬 커밋은 싸고 되돌릴 수 있으니, 검증의 경계를 push 에 두는 편이 맞다.
 *
 * git 이 stdin 으로 `<local ref> <local sha> <remote ref> <remote sha>` 를 준다.
 * 브랜치 삭제(local sha 가 전부 0)는 올릴 커밋이 없으므로 판정하지 않는다.
 *
 * 막혔는데 정말 지나가야 한다면 `git push --no-verify` 다.
 */

import { readFileSync } from "node:fs";

import { markerPath } from "./verified-marker.mjs";

const ZERO = /^0+$/;

const lines = readStdin().split("\n").filter(Boolean);
if (lines.length === 0) process.exit(0); // 올릴 것이 없다.

const verified = readVerified();
const unverified = [];

for (const line of lines) {
  const [localRef, localSha] = line.split(" ");
  if (!localSha || ZERO.test(localSha)) continue; // 삭제다.
  if (!verified.has(localSha)) unverified.push({ ref: localRef, sha: localSha });
}

if (unverified.length > 0) {
  process.stderr.write(
    `\npush 를 막았다 — 게이트를 통과한 기록이 없는 커밋이다.\n\n` +
      unverified.map((u) => `  · ${u.sha.slice(0, 12)}  ${u.ref}`).join("\n") +
      `\n\n올리려는 커밋 위에서 \`npm test\` 를 돌려라. green 이면 기록이 남고 push 가 통과한다.\n` +
      `커밋 전에 돌린 green 은 그 커밋의 것이 아니다 — 커밋한 뒤에 돌려야 한다.\n\n` +
      `정말 이대로 가야 한다면 \`git push --no-verify\`.\n\n`,
  );
  process.exit(1);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function readVerified() {
  const path = markerPath();
  if (!path) return new Set();
  try {
    return new Set(readFileSync(path, "utf8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}
