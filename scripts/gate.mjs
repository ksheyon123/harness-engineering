#!/usr/bin/env node
// 1층 객관 게이트의 **유일한 실행 진입점**.
//
// 게이트 대상의 정의는 harness/config.json 한 곳에만 있고, 그것을 실행하는 코드는
// 이 파일 한 곳에만 있다. pre-commit·pre-push·개발자 세션이 모두 이 스크립트를 부른다.
// 설정만 공유하고 실행을 각자 하면(sh 의 JSON 파싱 vs 세션의 직접 스폰) 같은 설정을
// 다르게 해석할 여지가 남는다 — 진입점이 하나면 해석도 하나다.
//
// 설계는 harness/gate-pipeline/spec.md 참고.
// 관례는 worktree-add.mjs / token-usage.mjs 와 같다: 순수 함수를 export 하고,
// 직접 실행일 때만 main() 을 돈다(import 시 부수효과 없음 → 단위 테스트 가능).

import { existsSync, readFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { resolve, relative, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_PATH = "harness/config.json";

export const DEFAULTS = {
  baseBranch: "dev",
  testFilePatterns: ["**/*.test.{ts,tsx}"],
  skipDirs: ["node_modules", ".git", ".next", "dist", ".turbo"],
};

// typecheck 가 먼저다 — 타입이 깨졌으면 테스트를 돌릴 이유가 없다.
const KINDS = ["typecheck", "test"];

// ── 순수 함수 ────────────────────────────────────────────────────────────────

// JSON 문자열 → 정규화된 설정. 파싱/스키마 오류는 throw 한다.
// 설정 오타가 '게이트 없음' 으로 조용히 둔갑하면 안 되기 때문이다(파일 부재와는 다르게 다룬다).
export function loadConfig(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${CONFIG_PATH} 의 JSON 을 읽을 수 없습니다: ${err.message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${CONFIG_PATH} 는 객체여야 합니다`);
  }

  const gate = {};
  for (const kind of KINDS) {
    const list = raw.gate?.[kind] ?? [];
    if (!Array.isArray(list)) throw new Error(`gate.${kind} 는 배열이어야 합니다`);
    for (const [i, entry] of list.entries()) {
      if (!entry || typeof entry.dir !== "string" || !entry.dir) {
        throw new Error(`gate.${kind}[${i}] 에 dir 이 없습니다`);
      }
      if (typeof entry.cmd !== "string" || !entry.cmd) {
        throw new Error(`gate.${kind}[${i}] 에 cmd 가 없습니다`);
      }
    }
    gate[kind] = list;
  }

  return {
    baseBranch: raw.baseBranch ?? DEFAULTS.baseBranch,
    testFilePatterns: raw.testFilePatterns ?? DEFAULTS.testFilePatterns,
    skipDirs: raw.skipDirs ?? DEFAULTS.skipDirs,
    gate,
  };
}

// ── 최소 glob ────────────────────────────────────────────────────────────────
// qa-hash.mjs 가 '어떤 파일이 테스트인가' 를 이 설정에서 읽게 하기 위한 것.
// 외부 의존성을 늘리지 않는 것이 이 저장소의 기본이라 필요한 문법만 직접 다룬다.
//   **/  → 하위 디렉터리 0개 이상   *  → 구분자를 넘지 않는 임의 문자열
//   ?    → 구분자가 아닌 한 글자     {a,b} → 대안

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?"; // 디렉터리 0개 이상 — 루트 파일도 매칭돼야 한다
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(",")
          .map(escapeRe)
          .join("|")})`;
        i = end;
      }
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp(`^${re}$`);
}

// 경로를 정규화(역슬래시 → 슬래시, 선행 './' 제거)한 뒤 패턴 중 하나라도 맞으면 true.
export function matchesAnyGlob(path, patterns) {
  const norm = String(path).split("\\").join("/").replace(/^\.\//, "");
  return patterns.some((p) => globToRegExp(p).test(norm));
}

// entry + base → 실행할 명령 문자열. 해석 불가면 null.
// `{{BASE}}` 는 merge-base 로 치환한다. base 가 없으면 fallbackCmd 로 물러서고,
// 그것도 없으면 이 항목은 실행할 수 없다(호출자가 건너뜀으로 기록한다).
export function resolveCommand(entry, base) {
  if (!entry.cmd.includes("{{BASE}}")) return entry.cmd;
  if (base) return entry.cmd.split("{{BASE}}").join(base);
  return entry.fallbackCmd ?? null;
}

// 설정 → { run: [{kind, dir, cmd}], skipped: [{kind, dir, reason}] }
// 부수효과 없음. dirExists 를 주입받으므로 파일시스템 없이 테스트할 수 있다.
export function planGate(config, { dirExists, base }) {
  const run = [];
  const skipped = [];
  for (const kind of KINDS) {
    for (const entry of config.gate[kind]) {
      if (!dirExists(entry.dir)) {
        skipped.push({ kind, dir: entry.dir, reason: "디렉터리가 없습니다" });
        continue;
      }
      const cmd = resolveCommand(entry, base);
      if (cmd === null) {
        skipped.push({
          kind,
          dir: entry.dir,
          reason: "merge-base 산출 실패({{BASE}} 치환 불가) — fallbackCmd 가 없습니다",
        });
        continue;
      }
      run.push({ kind, dir: entry.dir, cmd });
    }
  }
  return { run, skipped };
}

// ── 실행부 ──────────────────────────────────────────────────────────────────

function repoRoot() {
  // cwd 의존을 없앤다 — qa-hash.mjs 가 cwd 에 의존해 하위 디렉터리서 돌리면
  // 해시가 어긋나던 전례가 있다. 게이트는 어디서 불러도 같은 결과여야 한다.
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

// dir 이 저장소 밖을 가리키면 거부한다(설정 오타로 엉뚱한 트리에서 명령이 도는 것 방지).
function assertInsideRepo(root, dir) {
  const rel = relative(resolve(root), resolve(root, dir));
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`gate 대상이 저장소 밖을 가리킵니다: ${dir}`);
  }
}

// merge-base(baseBranch, HEAD). 산출 실패는 정상 상황이다(신규 저장소, 원격 없음 등) → null.
export function mergeBase(baseBranch, cwd) {
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      return execFileSync("git", ["merge-base", ref, "HEAD"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

function runOne({ dir, cmd }, root) {
  try {
    // 셸 경유가 필요하다 — Windows 에서 npx 는 npx.cmd 라 셸 없이는 스폰되지 않는다.
    // 출력은 그대로 흘려보낸다(stdio: inherit): 세션이 Bash tool result 로 원인을 봐야 고칠 수 있다.
    execSync(cmd, { cwd: join(root, dir), stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function main(argv) {
  const listOnly = argv.includes("--list");

  let root;
  try {
    root = repoRoot();
  } catch {
    console.error("[gate] git 저장소가 아닙니다");
    process.exit(1);
  }

  const configFile = join(root, CONFIG_PATH);
  if (!existsSync(configFile)) {
    // 파일 부재 = 아직 게이트를 설정하지 않은 저장소. 막지 않는다.
    console.log(`[gate] ${CONFIG_PATH} 없음 — 게이트 대상이 없습니다. 통과.`);
    process.exit(0);
  }

  let config;
  try {
    config = loadConfig(readFileSync(configFile, "utf8"));
  } catch (err) {
    console.error(`[gate] ❌ ${err.message}`);
    process.exit(1);
  }

  try {
    for (const kind of KINDS) for (const e of config.gate[kind]) assertInsideRepo(root, e.dir);
  } catch (err) {
    console.error(`[gate] ❌ ${err.message}`);
    process.exit(1);
  }

  const base = mergeBase(config.baseBranch, root);
  const plan = planGate(config, {
    dirExists: (dir) => existsSync(join(root, dir)),
    base,
  });

  for (const s of plan.skipped) {
    console.log(`[gate] ⚠ ${s.kind} ${s.dir} 건너뜀 — ${s.reason}`);
  }

  if (listOnly) {
    if (plan.run.length === 0) console.log("[gate] 실행할 대상이 없습니다.");
    for (const r of plan.run) console.log(`[gate] ${r.kind}  ${r.dir}  ${r.cmd}`);
    process.exit(0);
  }

  // typecheck 가 하나라도 깨지면 테스트는 돌리지 않는다(기존 pre-push 동작 유지).
  const failed = [];
  for (const kind of KINDS) {
    const items = plan.run.filter((r) => r.kind === kind);
    for (const item of items) {
      console.log(`[gate] ${item.kind}: ${item.dir} — ${item.cmd}`);
      if (!runOne(item, root)) failed.push(item);
    }
    if (failed.length > 0) break;
  }

  if (failed.length > 0) {
    for (const f of failed) console.error(`[gate] ❌ 실패: ${f.kind} ${f.dir} (${f.cmd})`);
    process.exit(1);
  }

  console.log("[gate] ✅ 통과");
  process.exit(0);
}

// 직접 실행일 때만 main (import 시엔 부수효과 없음 → 순수 함수 단위 테스트 가능).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
