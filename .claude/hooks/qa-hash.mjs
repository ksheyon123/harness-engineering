#!/usr/bin/env node
// QA 입력 해시: 현재 브랜치 spec + 저장소의 모든 테스트 파일 내용 → sha256.
// pre-push가 이 값을 qa-checklist.md의 input_hash와 비교해, 변동이 없으면 QA(LLM)를 건너뛴다.
// → LLM 비결정성으로 인한 "재생성→차단→재push" 무한 루프를 끊는다.

import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SKIP = new Set(["node_modules", ".git", ".next", "dist", ".turbo"]);

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  } catch {
    return "";
  }
}

function collectTests(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collectTests(p, acc);
    else if (/\.test\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const branch = process.argv[2] || currentBranch();
const h = createHash("sha256");

// spec 내용
try {
  const index = JSON.parse(readFileSync("harness/index.json", "utf8"));
  const specPath = index.tasks?.[branch];
  if (specPath) h.update(readFileSync(specPath));
} catch {
  /* index/spec 없음 — 무시 */
}

// 테스트 파일 내용 (경로+내용)
for (const f of collectTests(".", []).sort()) {
  h.update(f);
  h.update(readFileSync(f));
}

process.stdout.write(h.digest("hex"));
