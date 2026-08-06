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
  installCommand: "npm install",
  testFilePatterns: ["**/*.test.{ts,tsx}"],
  // qa-hash 가 테스트 파일을 수집할 때 건너뛸 디렉터리. 경로가 아니라 **이름** 기준이다.
  // `worktrees` 가 들어 있는 이유: isolation 서브에이전트가 `.claude/worktrees/agent-<id>/`
  // 에 저장소 사본을 만드는데, 그 사본의 테스트까지 해시에 들어가면 worktree 가 생겼다
  // 사라질 때마다 해시가 흔들리고 push 마다 QA 가 재생성된다. `.claude` 를 통째로
  // 건너뛸 수는 없다 — `.claude/hooks/*.test.mjs` 는 진짜 테스트다.
  skipDirs: ["node_modules", ".git", ".next", "dist", ".turbo", "worktrees"],
  // verify-branch 훅의 면제 목록 — 저장소 루트 기준 경로다.
  // 기본값은 훅의 기존 동작과 같다(harness/·.claude/). 도입 프로젝트가 레이아웃을 바꾸면
  // 이 값만 바꾼다 — 훅에 디렉터리 이름을 박지 않기 위해 설정으로 뺐다.
  harnessMetaPaths: ["harness/", ".claude/"],
  // verify-branch 훅이 보호하는 브랜치 중 **baseBranch 외에 더** 보호할 것들.
  // 기본값이 빈 배열인 이유: baseBranch 는 훅이 자동으로 포함하므로 여기 적을 필요가 없다.
  // 대부분의 저장소는 이 값을 쓰지 않는다(과거 하드코딩의 dev·master 는 이 저장소가 쓰지 않는
  // 이름이었고, 그것이 이중 출처였다).
  protectedBranches: [],
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

  // baseBranch 는 세 곳이 쓴다: worktree 분기 기준(worktree-add.mjs), 게이트의 merge-base
  // 기준선(mergeBase), 보호 브랜치(verify-branch.mjs). 오타에 침묵하면 안 되는 이유가
  // 다른 필드보다 더 나쁘다 — 잘못된 이름은 merge-base 산출을 실패시키고, 그러면 planGate 가
  // `{{BASE}}` 를 쓰는 항목을 통째로 건너뛴다. **검사가 사라지는데 게이트는 통과한다**
  // (⚠ 한 줄만 남는다). installCommand·harnessMetaPaths 와 같은 결로 throw 한다.
  //
  // 필드 부재(undefined)는 여전히 DEFAULTS 로 물러선다 — '파일/필드 부재' 와 '오타' 를
  // 다르게 다루는 것이 이 저장소의 축이다. 여기서만 뒤집지 않는다.
  if (raw.baseBranch !== undefined) {
    if (typeof raw.baseBranch !== "string" || !raw.baseBranch) {
      throw new Error(`baseBranch 는 비어 있지 않은 문자열이어야 합니다`);
    }
  }

  // protectedBranches 는 verify-branch 훅이 baseBranch 와 합쳐 보호 목록으로 쓴다.
  // 검증은 harnessMetaPaths 와 같은 결 — 오타가 조용히 '보호 안 함' 으로 둔갑하면 안 된다.
  if (raw.protectedBranches !== undefined) {
    if (!Array.isArray(raw.protectedBranches)) {
      throw new Error(`protectedBranches 는 배열이어야 합니다`);
    }
    for (const [i, b] of raw.protectedBranches.entries()) {
      if (typeof b !== "string" || !b) {
        throw new Error(`protectedBranches[${i}] 는 비어 있지 않은 문자열이어야 합니다`);
      }
    }
  }

  // installCommand 는 worktree-add.mjs 가 쓴다. 값이 있는데 문자열이 아니거나 비어 있으면
  // throw 한다 — gate 항목의 dir/cmd 와 같은 결이다. 오타가 조용히 기본값(npm)으로 둔갑하면
  // pnpm 저장소에서 설치가 헛돌고, 그 사실은 그 worktree 의 게이트가 깨질 때까지 드러나지 않는다.
  if (raw.installCommand !== undefined) {
    if (typeof raw.installCommand !== "string" || !raw.installCommand) {
      throw new Error(`installCommand 는 비어 있지 않은 문자열이어야 합니다`);
    }
  }

  // harnessMetaPaths 는 verify-branch 훅이 쓴다. 오타가 조용히 기본값으로 둔갑하면
  // worktree 강제가 엉뚱한 경로에서 켜지거나 꺼진다 — installCommand 와 같은 결로 throw 한다.
  if (raw.harnessMetaPaths !== undefined) {
    if (!Array.isArray(raw.harnessMetaPaths)) {
      throw new Error(`harnessMetaPaths 는 배열이어야 합니다`);
    }
    for (const [i, p] of raw.harnessMetaPaths.entries()) {
      if (typeof p !== "string" || !p) {
        throw new Error(`harnessMetaPaths[${i}] 는 비어 있지 않은 문자열이어야 합니다`);
      }
    }
  }

  return {
    baseBranch: raw.baseBranch ?? DEFAULTS.baseBranch,
    installCommand: raw.installCommand ?? DEFAULTS.installCommand,
    testFilePatterns: raw.testFilePatterns ?? DEFAULTS.testFilePatterns,
    skipDirs: raw.skipDirs ?? DEFAULTS.skipDirs,
    harnessMetaPaths: raw.harnessMetaPaths ?? DEFAULTS.harnessMetaPaths,
    protectedBranches: raw.protectedBranches ?? DEFAULTS.protectedBranches,
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

// ── git 환경 격리 ────────────────────────────────────────────────────────────
// 게이트는 git 훅 안에서 돈다 → git 이 GIT_DIR·GIT_INDEX_FILE 등을 export 한 상태다.
// 그 env 를 물려받은 자식(테스트)이 git 을 부르면, `git -C <임시경로>` 로도 cwd 옵션으로도
// 막을 수 없다: **GIT_DIR 이 있으면 저장소 탐색 자체를 건너뛴다.** 실제로 이 저장소가
// bare 로 재초기화되고 브랜치가 픽스처 커밋으로 덮였다(BACKLOG #9).
//
// 스폰 지점이 여기 하나뿐이므로(gate-pipeline spec) 방어도 여기 한 곳이면 된다 —
// 테스트 작성자의 규율에 맡기지 않는다. 그 규율은 이미 한 번 실패했고 대가가 저장소 손상이었다.
export function scrubGitEnv(env) {
  // 개별 지정(denylist)이 아니라 접두어 전체를 지운다. 위험한 변수는 GIT_DIR 하나가 아니고
  // (GIT_WORK_TREE·GIT_INDEX_FILE·GIT_COMMON_DIR·GIT_OBJECT_DIRECTORY·
  //  GIT_ALTERNATE_OBJECT_DIRECTORIES·GIT_NAMESPACE·GIT_CEILING_DIRECTORIES …),
  // 목록 방식은 fail-open 이다 — 하나를 빠뜨리거나 git 이 새 변수를 더하면 조용히 구멍이 남는다.
  //
  // 함께 사라지는 것들에 대한 판단:
  //   GIT_EXEC_PATH        — 없으면 git 이 컴파일 시 기본 경로를 쓴다. 제거해도 정상 동작한다.
  //   GIT_AUTHOR_*/COMMITTER_* — 테스트가 커밋을 만든다면 자기 저장소에 user.name/email 을
  //                          설정해야 한다. 훅 실행자의 신원이 픽스처에 새는 것이 오히려 문제다.
  // GIT_ 가 아닌 것은 건드리지 않는다 — PATH·NODE_*·APPDATA 가 사라지면 Windows 에서 npx 가 안 뜬다.
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("GIT_")) out[k] = v;
  }
  return out;
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

// 읽기 전용이라 그 자체로 위험하진 않지만, 게이트 안의 git 해석은 한 가지여야 한다 —
// GIT_DIR 이 있을 때와 없을 때 --show-toplevel 이 다른 값을 내면 게이트가 엉뚱한 트리를 돈다.
// 스크럽된 env 에서는 저장소 탐색이 cwd 기준이 된다(훅에서 gate.mjs 는 항상 저장소 안에서 돈다).
export function repoRoot(env = scrubGitEnv(process.env)) {
  // cwd 의존을 없앤다 — qa-hash.mjs 가 cwd 에 의존해 하위 디렉터리서 돌리면
  // 해시가 어긋나던 전례가 있다. 게이트는 어디서 불러도 같은 결과여야 한다.
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    env,
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
export function mergeBase(baseBranch, cwd, env = scrubGitEnv(process.env)) {
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      return execFileSync("git", ["merge-base", ref, "HEAD"], {
        cwd,
        env,
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

export function runOne({ dir, cmd }, root, env = scrubGitEnv(process.env)) {
  try {
    // 셸 경유가 필요하다 — Windows 에서 npx 는 npx.cmd 라 셸 없이는 스폰되지 않는다.
    // 출력은 그대로 흘려보낸다(stdio: inherit): 세션이 Bash tool result 로 원인을 봐야 고칠 수 있다.
    // env: 훅의 GIT_* 를 씻어 넘긴다 — 이것이 없으면 자식 테스트가 진짜 저장소를 조작한다.
    execSync(cmd, { cwd: join(root, dir), env, stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function main(argv) {
  const listOnly = argv.includes("--list");

  // 한 번만 계산해 모든 git 호출·스폰에 재사용한다(호출마다 process.env 를 복사하지 않는다).
  const env = scrubGitEnv(process.env);

  let root;
  try {
    root = repoRoot(env);
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

  const base = mergeBase(config.baseBranch, root, env);
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
      if (!runOne(item, root, env)) failed.push(item);
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
