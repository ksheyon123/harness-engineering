#!/usr/bin/env node
// 하네스 토큰 소모량 사후 집계기.
// Claude Code 로컬 트랜스크립트(~/.claude/projects/<repo-slug>/**/*.jsonl)를 읽어
// task(=gitBranch) / 역할(main vs subagent) / 모델별 토큰·비용을 집계한다.
// 앱에는 LLM 호출이 없으므로 측정 대상은 하네스 세션 자체의 소모다.
// 규약·설계는 harness/token-usage/spec.md 참고. worktree-add.mjs / qa-hash.mjs 와 같은 결:
// 읽기 전용, 순수 함수 export(테스트 가능), 직접 실행일 때만 main.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// --- 단가 (claude-api 스킬 기준, per-MTok) ---
// 캐시 배수는 입력 단가에 곱한다: read=×0.1, 5분 write=×1.25, 1시간 write=×2.0.
// 인트로 프로모션가·1h TTL 반영 여부는 spec '사람 확인 필요' 참고(기본=표준가).
export const CACHE_MULT = { read: 0.1, write5m: 1.25, write1h: 2.0 };
export const PRICING = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// model 문자열 → 단가. 날짜 접미사가 붙어도(claude-haiku-4-5-20251001) 접두 매칭으로 찾는다.
// 단가표에 없으면(<synthetic> 등) null.
export function priceFor(model) {
  if (!model) return null;
  if (PRICING[model]) return PRICING[model];
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  return null;
}

// 토큰 레코드 → 달러 비용. 단가 없으면 0(토큰은 별도로 집계·라벨링됨).
export function costOf(tok, price) {
  if (!price) return 0;
  return (
    (tok.input / 1e6) * price.input +
    (tok.output / 1e6) * price.output +
    (tok.cacheRead / 1e6) * price.input * CACHE_MULT.read +
    (tok.cacheWrite5m / 1e6) * price.input * CACHE_MULT.write5m +
    (tok.cacheWrite1h / 1e6) * price.input * CACHE_MULT.write1h
  );
}

// JSONL 한 줄 → 과금 레코드 또는 null.
//  · type==="assistant" + message.usage 가 있어야 대상.
//  · message.id 가 없으면 dedup 불가 → 제외(과금 대상 아님).
//  · role: 경로에 /subagents/ 가 있거나 isSidechain===true 면 subagent, 아니면 main.
//  · cache_creation 분해(ephemeral_5m/1h)가 있으면 그대로, 없으면 cache_creation_input_tokens 전부 5m 취급.
export function parseUsageLine(line, filePath = "") {
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (d?.type !== "assistant") return null;
  const m = d.message;
  if (!m || typeof m !== "object") return null;
  const u = m.usage;
  if (!u || typeof u !== "object" || !m.id) return null;

  const cc = u.cache_creation && typeof u.cache_creation === "object" ? u.cache_creation : null;
  const cacheWrite5m = cc ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0;
  const cacheWrite1h = cc ? cc.ephemeral_1h_input_tokens || 0 : 0;

  const isSub = filePath.includes("/subagents/") || d.isSidechain === true;
  return {
    id: m.id,
    model: m.model || "unknown",
    task: d.gitBranch || "(no-branch)",
    role: isSub ? "subagent" : "main",
    session: d.sessionId || "(no-session)",
    timestamp: d.timestamp || null,
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite5m,
    cacheWrite1h,
  };
}

// 레코드 배열 → key(문자열) → 누적 {input,output,cacheWrite,cacheRead,cost,count}.
// keyFn 이 그룹 축을 정한다.
export function aggregate(records, keyFn) {
  const out = new Map();
  for (const r of records) {
    const key = keyFn(r);
    let a = out.get(key);
    if (!a) {
      a = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, count: 0 };
      out.set(key, a);
    }
    a.input += r.input;
    a.output += r.output;
    a.cacheWrite += r.cacheWrite5m + r.cacheWrite1h;
    a.cacheRead += r.cacheRead;
    a.cost += costOf(
      { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite5m: r.cacheWrite5m, cacheWrite1h: r.cacheWrite1h },
      priceFor(r.model),
    );
    a.count += 1;
  }
  return out;
}

// --- CLI 파트 (부수효과는 main 안에서만) ---

// 저장소 루트 → Claude 트랜스크립트 디렉터리. slug 는 절대경로의 '/'·'.' 를 '-' 로 치환.
export function projectDirFor(root, home = homedir()) {
  const slug = resolve(root).replace(/[/.]/g, "-");
  return join(home, ".claude", "projects", slug);
}

// 링크드 worktree 에서 실행해도 "메인(주 워크트리) 루트" 를 얻는다.
// git-common-dir 은 공용 .git 을 가리키므로 그 부모가 메인 루트다(worktree 의 --show-toplevel 은
// worktree 자신을 줘서 sibling slug 를 못 찾는다). 구버전 git 등으로 실패하면 --show-toplevel 폴백.
export function mainRepoRoot() {
  try {
    const commonGitDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { stdio: ["ignore", "pipe", "ignore"] },
    )
      .toString()
      .trim();
    if (commonGitDir) return dirname(commonGitDir); // <root>/.git → <root>
  } catch {
    /* 구버전 git(--path-format 미지원) 등 — 아래 폴백 */
  }
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

// 디렉터리 이름 목록에서 이 저장소의 것(메인 slug + 그 worktree sibling slug)만 고른다(순수).
// 규칙: name === mainSlug 이거나 name 이 `${mainSlug}-` 로 시작(worktree 규약 <repo>-<task> → <mainSlug>-<task>).
export function candidateSlugDirs(entryNames, mainSlug) {
  const prefix = `${mainSlug}-`;
  return entryNames.filter((n) => n === mainSlug || n.startsWith(prefix));
}

// dir 이하의 모든 *.jsonl 경로를 재귀 수집(서브에이전트 파일 포함).
function walkJsonl(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsonl(p));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

export function humanTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
const usd = (n) => "$" + n.toFixed(2);

function parseArgs(args) {
  const opt = { by: "task", dir: null, json: false, since: null, until: null, mainOnly: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--by") opt.by = args[++i];
    else if (a.startsWith("--by=")) opt.by = a.slice(5);
    else if (a === "--dir") opt.dir = args[++i];
    else if (a.startsWith("--dir=")) opt.dir = a.slice(6);
    else if (a === "--json") opt.json = true;
    else if (a === "--main-only") opt.mainOnly = true;
    else if (a === "--since") opt.since = args[++i];
    else if (a.startsWith("--since=")) opt.since = a.slice(8);
    else if (a === "--until") opt.until = args[++i];
    else if (a.startsWith("--until=")) opt.until = a.slice(8);
  }
  return opt;
}

const keyOf = {
  task: (r) => r.task,
  role: (r) => r.role,
  model: (r) => r.model,
  session: (r) => r.session,
};

function row(label, a) {
  return (
    label.padEnd(30) +
    humanTokens(a.input).padStart(9) +
    humanTokens(a.output).padStart(9) +
    humanTokens(a.cacheWrite).padStart(11) +
    humanTokens(a.cacheRead).padStart(11) +
    usd(a.cost).padStart(11)
  );
}

function printReport(records, by) {
  const header =
    "group".padEnd(30) +
    "input".padStart(9) +
    "output".padStart(9) +
    "cache_wr".padStart(11) +
    "cache_rd".padStart(11) +
    "cost".padStart(11);
  console.log(header);
  console.log("-".repeat(header.length));

  const groups = aggregate(records, keyOf[by]);
  const sorted = [...groups.entries()].sort((a, b) => b[1].cost - a[1].cost);
  for (const [key, a] of sorted) {
    console.log(row(key, a));
    if (by === "task") {
      // task 행 아래에 역할(main/subagent) 서브행을 들여쓴다.
      const roles = aggregate(
        records.filter((r) => r.task === key),
        keyOf.role,
      );
      for (const [rk, ra] of [...roles.entries()].sort((x, y) => y[1].cost - x[1].cost)) {
        console.log(row("  └ " + rk, ra));
      }
    }
  }

  const total = aggregate(records, () => "TOTAL").get("TOTAL");
  console.log("-".repeat(header.length));
  if (total) console.log(row("TOTAL", total));
  console.log(
    `\n집계 대상 어시스턴트 메시지: ${records.length}건 · 캐시 write는 5분(×1.25)/1시간(×2.0) TTL 분해로 계산 · read=×0.1.`,
  );
}

function main(argv) {
  const opt = parseArgs(argv.slice(2));
  if (!keyOf[opt.by]) {
    console.error(`[token-usage] ❌ --by 는 task|role|model|session 중 하나여야 합니다: ${opt.by}`);
    process.exit(1);
  }

  // 대상 디렉터리 목록 결정:
  //  · --dir: 그 경로 하나만(명시 오버라이드, 크로스-worktree 병합 안 함).
  //  · --main-only: 메인 slug 한 곳(리비전 이전 동작).
  //  · 기본: 메인 slug + 모든 worktree sibling slug 를 합산(크로스-worktree).
  let dirs;
  if (opt.dir) {
    dirs = [resolve(opt.dir)];
  } else {
    let mainRoot;
    try {
      mainRoot = mainRepoRoot();
    } catch {
      console.error("[token-usage] .git 을 찾지 못했습니다. --dir 로 트랜스크립트 경로를 지정하세요.");
      process.exit(0);
    }
    const mainDir = projectDirFor(mainRoot); // ~/.claude/projects/<mainSlug>
    if (opt.mainOnly) {
      dirs = [mainDir];
    } else {
      const projectsBase = dirname(mainDir); // ~/.claude/projects
      const mainSlug = basename(mainDir); // <mainSlug>
      let names = [];
      try {
        names = readdirSync(projectsBase, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        /* projects 디렉터리 없음 — 아래 존재 필터가 빈 결과로 처리 */
      }
      dirs = candidateSlugDirs(names, mainSlug).map((n) => join(projectsBase, n));
    }
  }

  const existingDirs = dirs.filter((d) => existsSync(d));
  if (existingDirs.length === 0) {
    console.error(`[token-usage] 트랜스크립트 디렉터리가 없습니다: ${dirs.join(", ")}`);
    process.exit(0);
  }

  const sinceMs = opt.since ? Date.parse(opt.since) : null;
  const untilMs = opt.until ? Date.parse(opt.until) : null;
  const seen = new Set();
  const records = [];
  for (const dir of existingDirs) {
    for (const file of walkJsonl(dir)) {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line) continue;
        const rec = parseUsageLine(line, file);
        if (!rec || seen.has(rec.id)) continue; // message.id dedup (전 디렉터리 공유)
        if (sinceMs && rec.timestamp && Date.parse(rec.timestamp) < sinceMs) continue;
        if (untilMs && rec.timestamp && Date.parse(rec.timestamp) > untilMs) continue;
        seen.add(rec.id);
        records.push(rec);
      }
    }
  }

  // 표시용 스코프 라벨: 단일 dir 이면 경로, 크로스-worktree 면 "N slug dirs".
  const scope =
    existingDirs.length === 1
      ? existingDirs[0]
      : `${existingDirs.length} slug dirs (메인+worktree)`;

  if (opt.json) {
    const groups = aggregate(records, keyOf[opt.by]);
    const obj = Object.fromEntries(
      [...groups.entries()].map(([k, a]) => [k, { ...a, cost: Number(a.cost.toFixed(4)) }]),
    );
    console.log(
      JSON.stringify(
        { by: opt.by, dirs: existingDirs, messages: records.length, groups: obj },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`[token-usage] ${scope}  (--by ${opt.by})\n`);
  printReport(records, opt.by);
}

// 직접 실행일 때만 main (import 시엔 부수효과 없음 → 순수 함수 단위 테스트 가능).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
