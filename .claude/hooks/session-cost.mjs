#!/usr/bin/env node
// Hook — 세션 종료 요약 (SessionEnd).
// 종료되는 세션의 트랜스크립트(+ 그 세션의 서브에이전트 파일)만 읽어 이 세션의 토큰/비용을 집계,
// systemMessage 로 요약을 띄우고 세션 트랜스크립트 디렉터리(~/.claude/projects/<cwd-slug>/)의
// session-costs.log 에 한 줄 기록한다(저장소 dir 아님 — 위치는 세션 cwd 로 정해지는 slug 기준).
// 읽기 전용. 어떤 실패도 세션 종료를 막지 않도록 항상 exit 0.
// 단가·집계 로직은 scripts/token-usage.mjs 재사용(단일 소스). 설계는 harness/token-usage/spec.md 참고.

import { readFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { parseUsageLine, aggregate, humanTokens } from "../../scripts/token-usage.mjs";

// stdin JSON → 이 세션의 파일 목록(메인 트랜스크립트 + 서브에이전트).
function currentSessionFiles(input) {
  let tp = input.transcript_path;
  let sid = input.session_id;
  // transcript_path 가 없으면 session_id + cwd 로 유도(slug = 절대경로의 '/'·'.' → '-').
  if (!tp && sid && input.cwd) {
    const slug = String(input.cwd).replace(/[/.]/g, "-");
    tp = join(homedir(), ".claude", "projects", slug, `${sid}.jsonl`);
  }
  if (!tp || !existsSync(tp)) return { tp: null, files: [] };
  if (!sid) sid = basename(tp, ".jsonl");
  const files = [tp];
  const subDir = join(dirname(tp), sid, "subagents");
  try {
    for (const e of readdirSync(subDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".jsonl")) files.push(join(subDir, e.name));
    }
  } catch {
    /* 서브에이전트 없음 — 무시 */
  }
  return { tp, files };
}

function collect(files) {
  const seen = new Set();
  const records = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      const r = parseUsageLine(line, f);
      if (!r || seen.has(r.id)) continue; // message.id dedup
      seen.add(r.id);
      records.push(r);
    }
  }
  return records;
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }

  const { tp, files } = currentSessionFiles(input);
  if (!tp) process.exit(0);

  const records = collect(files);
  if (records.length === 0) process.exit(0);

  const total = aggregate(records, () => "ALL").get("ALL");
  const byRole = aggregate(records, (r) => r.role);
  const mainRole = byRole.get("main") || { cost: 0 };
  const subRole = byRole.get("subagent") || { cost: 0 };
  const usd = (n) => "$" + n.toFixed(2);

  const summary =
    `[세션 비용] ${usd(total.cost)} · ` +
    `in ${humanTokens(total.input)} / out ${humanTokens(total.output)} / ` +
    `cache_wr ${humanTokens(total.cacheWrite)} / cache_rd ${humanTokens(total.cacheRead)} ` +
    `(main ${usd(mainRole.cost)} / sub ${usd(subRole.cost)}) · ${records.length} msgs`;

  // 로그 기록(보증) — dirname(tp) = ~/.claude/projects/<cwd-slug>/session-costs.log 에 한 줄 append.
  // (worktree 세션은 cwd 가 worktree 라 slug 가 <repo-slug>-<task> → 로그가 그쪽에 남는다. 프로젝트
  //  전체 집계는 token-usage.mjs 가 메인+worktree slug 를 합산해 읽는다 — 크로스-worktree 집계 참고.)
  try {
    const sid = input.session_id || basename(tp, ".jsonl");
    const stamp = new Date().toISOString();
    const branch = records[records.length - 1]?.task || "?";
    appendFileSync(join(dirname(tp), "session-costs.log"), `${stamp}\t${sid}\t${branch}\t${summary}\n`);
  } catch {
    /* 기록 실패 무시 */
  }

  // UI 표시(가능한 서피스에서). SessionEnd 는 종료 중이라 안 보일 수 있음 → 위 로그가 보증.
  process.stdout.write(JSON.stringify({ systemMessage: summary }));
  process.exit(0);
}

main();
