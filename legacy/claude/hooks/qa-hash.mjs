#!/usr/bin/env node
// QA 입력 해시: 현재 브랜치 spec + 저장소의 모든 테스트 파일 내용 → sha256.
// pre-push가 이 값을 qa-checklist.md의 input_hash와 비교해, 변동이 없으면 QA(LLM)를 건너뛴다.
// → LLM 비결정성으로 인한 "재생성→차단→재push" 무한 루프를 끊는다.
//
// '무엇이 테스트 파일인가' 는 harness/config.json 의 testFilePatterns 에서 읽는다(단일 출처).
// 여기에 패턴이 하드코딩돼 있으면, 그 패턴에 안 걸리는 테스트를 고쳐도 해시가 바뀌지 않아
// 낡은 QA 매트릭스가 조용히 통과한다 — 막히는 게 아니라 통과되는 실패라 발견이 늦다.
//
// stdout 에는 해시 문자열만 나간다(pre-push 가 그대로 받아 쓴다). 경고는 stderr 로.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadConfig, matchesAnyGlob, DEFAULTS, CONFIG_PATH } from "../../scripts/gate.mjs";

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  } catch {
    return "";
  }
}

// 설정이 없거나 깨져 있어도 해시 산출은 계속한다 — 기본값으로 물러선다.
// (설정 오류를 push 로 알리는 것은 gate.mjs 의 몫이고, 여기서 중단하면 훅이 조용히 깨진다.)
function config() {
  try {
    if (existsSync(CONFIG_PATH)) return loadConfig(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    process.stderr.write(`[qa-hash] ⚠ ${CONFIG_PATH} 를 읽을 수 없어 기본값을 씁니다: ${err.message}\n`);
  }
  return DEFAULTS;
}

const { testFilePatterns, skipDirs } = config();
const SKIP = new Set(skipDirs);

function collectTests(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collectTests(p, acc);
    else if (matchesAnyGlob(p, testFilePatterns)) acc.push(p);
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
// 경로를 해시에 넣으므로 구분자를 정규화한다 — 안 그러면 Windows 와 POSIX 에서
// 같은 트리인데 해시가 달라진다.
for (const f of collectTests(".", []).sort()) {
  h.update(f.split("\\").join("/"));
  h.update(readFileSync(f));
}

process.stdout.write(h.digest("hex"));
