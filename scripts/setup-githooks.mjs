#!/usr/bin/env node
// 새 클론에서도 git pre-push 훅(.githooks/)이 자동 활성화되도록,
// `npm install` 시(prepare 라이프사이클) core.hooksPath 를 .githooks 로 설정한다.
//
// git 훅은 .git/ 안에 살아 버전관리/브랜치에 따라오지 않으므로, 트래킹되는
// .githooks/ 디렉터리 + 이 1회성 설정 조합으로 "클론당 수동 설정"을 없앤다.
//
// .git 이 없는 환경(tarball 의존성 설치 등)에선 조용히 건너뛴다 — 설치를 절대 막지 않는다.
import { execSync } from "node:child_process";

const TARGET = ".githooks";

// 1) git 워크트리가 아니면 스킵
try {
  execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
} catch {
  process.exit(0);
}

// 2) 이미 올바르게 설정돼 있으면 무동작(멱등)
let current = "";
try {
  current = execSync("git config --get core.hooksPath", {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  // unset 이면 `--get` 이 exit 1 → current 는 "" 유지
}

if (current === TARGET) process.exit(0);

// 3) 설정. 실패해도 설치를 막지 않는다(경고만).
try {
  execSync(`git config core.hooksPath ${TARGET}`, { stdio: "ignore" });
  console.log(`[setup-githooks] core.hooksPath → ${TARGET} 활성화 (pre-push QA 훅)`);
} catch (err) {
  console.warn(`[setup-githooks] 설정 실패(무시): ${err.message}`);
}
