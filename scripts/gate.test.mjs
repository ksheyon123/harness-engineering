import { describe, it, expect } from "vitest";
import {
  loadConfig,
  resolveCommand,
  planGate,
  globToRegExp,
  matchesAnyGlob,
  scrubGitEnv,
  DEFAULTS,
} from "./gate.mjs";

// 게이트 대상의 단일 출처(harness/config.json)를 해석하는 순수 함수들.
// 실행(프로세스 스폰)은 main() 에만 있고 여기서는 다루지 않는다.

describe("loadConfig", () => {
  it("gate 가 없으면 typecheck/test 를 빈 배열로 정규화한다", () => {
    const cfg = loadConfig("{}");
    expect(cfg.gate.typecheck).toEqual([]);
    expect(cfg.gate.test).toEqual([]);
  });

  it("한쪽 배열만 있어도 나머지를 빈 배열로 채운다", () => {
    const cfg = loadConfig(JSON.stringify({ gate: { test: [{ dir: ".", cmd: "x" }] } }));
    expect(cfg.gate.typecheck).toEqual([]);
    expect(cfg.gate.test).toHaveLength(1);
  });

  it("baseBranch / testFilePatterns / skipDirs 기본값을 채운다", () => {
    const cfg = loadConfig("{}");
    expect(cfg.baseBranch).toBe(DEFAULTS.baseBranch);
    expect(cfg.testFilePatterns).toEqual(DEFAULTS.testFilePatterns);
    expect(cfg.skipDirs).toEqual(DEFAULTS.skipDirs);
  });

  it("명시된 baseBranch / testFilePatterns 는 보존한다", () => {
    const cfg = loadConfig(JSON.stringify({ baseBranch: "dev", testFilePatterns: ["a"] }));
    expect(cfg.baseBranch).toBe("dev");
    expect(cfg.testFilePatterns).toEqual(["a"]);
  });

  // installCommand: worktree-add.mjs 가 쓰는 설치 명령의 단일 출처.
  // 미설정 시 기본값은 현재 동작(npm install) 이어야 한다 — 기존 저장소가 깨지면 안 된다.
  it("installCommand 가 없으면 기본값 'npm install' 이다", () => {
    expect(loadConfig("{}").installCommand).toBe("npm install");
    expect(DEFAULTS.installCommand).toBe("npm install");
  });

  it("명시된 installCommand 를 그대로 돌려준다", () => {
    const cfg = loadConfig(JSON.stringify({ installCommand: "pnpm install" }));
    expect(cfg.installCommand).toBe("pnpm install");
  });

  // 설정 오타가 조용히 기본값으로 둔갑하면 안 된다 — gate 항목의 dir/cmd 검사와 같은 결.
  it("installCommand 가 문자열이 아니거나 빈 문자열이면 throw 한다", () => {
    expect(() => loadConfig(JSON.stringify({ installCommand: 42 }))).toThrow(/installCommand/);
    expect(() => loadConfig(JSON.stringify({ installCommand: "" }))).toThrow(/installCommand/);
  });

  // 설정 오타가 '게이트 없음' 으로 조용히 둔갑하면 안 된다.
  it("JSON 파싱에 실패하면 throw 한다", () => {
    expect(() => loadConfig("{ not json ")).toThrow();
  });

  it("gate 항목에 dir 이나 cmd 가 없으면 throw 한다", () => {
    expect(() => loadConfig(JSON.stringify({ gate: { test: [{ cmd: "x" }] } }))).toThrow(/dir/);
    expect(() => loadConfig(JSON.stringify({ gate: { test: [{ dir: "." }] } }))).toThrow(/cmd/);
  });

  // harnessMetaPaths: verify-branch 훅의 면제 목록(저장소 루트 기준 경로)의 단일 출처.
  // 미설정 시 기본값은 훅의 기존 동작이어야 한다 — 기존 저장소의 판정이 바뀌면 안 된다.
  it("harnessMetaPaths 가 없으면 기본값(harness/·.claude/)이다", () => {
    expect(loadConfig("{}").harnessMetaPaths).toEqual(["harness/", ".claude/"]);
    expect(DEFAULTS.harnessMetaPaths).toEqual(["harness/", ".claude/"]);
  });

  it("명시된 harnessMetaPaths 를 그대로 돌려준다", () => {
    const cfg = loadConfig(JSON.stringify({ harnessMetaPaths: ["harness/", "BACKLOG.md"] }));
    expect(cfg.harnessMetaPaths).toEqual(["harness/", "BACKLOG.md"]);
  });

  // 오타가 조용히 기본값으로 둔갑하면 worktree 강제가 엉뚱한 경로에서 켜지거나 꺼진다.
  it("harnessMetaPaths 가 배열이 아니거나 원소가 문자열이 아니면 throw 한다", () => {
    expect(() => loadConfig(JSON.stringify({ harnessMetaPaths: "harness/" }))).toThrow(
      /harnessMetaPaths/,
    );
    expect(() => loadConfig(JSON.stringify({ harnessMetaPaths: [1] }))).toThrow(
      /harnessMetaPaths\[0\]/,
    );
    expect(() => loadConfig(JSON.stringify({ harnessMetaPaths: [""] }))).toThrow(
      /harnessMetaPaths\[0\]/,
    );
  });

  // baseBranch: 분기 기준 · merge-base 기준선 · 보호 브랜치의 단일 출처.
  // 여기만 타입 검증이 없어서, 오타가 나면 mergeBase 가 null 을 돌려주고 {{BASE}} 를 쓰는
  // 게이트 항목이 통째로 건너뛰어진다 — 검사가 사라지는데 게이트는 exit 0 으로 통과한다.
  it("baseBranch 가 문자열이 아니거나 빈 문자열이면 throw 한다", () => {
    expect(() => loadConfig(JSON.stringify({ baseBranch: 42 }))).toThrow(/baseBranch/);
    expect(() => loadConfig(JSON.stringify({ baseBranch: "" }))).toThrow(/baseBranch/);
    expect(() => loadConfig(JSON.stringify({ baseBranch: ["main"] }))).toThrow(/baseBranch/);
    // 명시적 null 은 오타에 가깝다 — typeof null === "object" 라 같은 분기로 걸린다.
    expect(() => loadConfig(JSON.stringify({ baseBranch: null }))).toThrow(/baseBranch/);
  });

  // 필드 부재는 오타와 다르게 다룬다(README §6 '부재·오류를 다루는 방향이 소비자마다 다르다').
  // 이 회귀가 깨지면 도입 초기 저장소에서 게이트가 부당하게 멈춘다.
  it("baseBranch 필드가 없으면 기존대로 DEFAULTS 로 물러선다", () => {
    expect(loadConfig("{}").baseBranch).toBe(DEFAULTS.baseBranch);
    expect(DEFAULTS.baseBranch).toBe("dev");
  });

  it("정상 baseBranch 값은 그대로 보존한다", () => {
    expect(loadConfig(JSON.stringify({ baseBranch: "develop" })).baseBranch).toBe("develop");
  });

  // protectedBranches: verify-branch 훅의 보호 브랜치 목록에서 baseBranch 외에 **더** 보호할
  // 브랜치. 기본값이 [] 인 이유는 baseBranch 가 이미 자동 포함되기 때문이다.
  it("protectedBranches 가 없으면 기본값 [] 이다", () => {
    expect(loadConfig("{}").protectedBranches).toEqual([]);
    expect(DEFAULTS.protectedBranches).toEqual([]);
  });

  it("명시된 protectedBranches 를 그대로 돌려준다", () => {
    expect(loadConfig(JSON.stringify({ protectedBranches: ["a", "b"] })).protectedBranches).toEqual([
      "a",
      "b",
    ]);
  });

  it("protectedBranches 가 배열이 아니거나 원소가 문자열이 아니면 throw 한다", () => {
    expect(() => loadConfig(JSON.stringify({ protectedBranches: "main" }))).toThrow(
      /protectedBranches/,
    );
    expect(() => loadConfig(JSON.stringify({ protectedBranches: [1, 2] }))).toThrow(
      /protectedBranches\[0\]/,
    );
    expect(() => loadConfig(JSON.stringify({ protectedBranches: [""] }))).toThrow(
      /protectedBranches\[0\]/,
    );
  });
});

describe("resolveCommand", () => {
  it("{{BASE}} 가 없으면 cmd 를 그대로 돌려준다", () => {
    expect(resolveCommand({ dir: ".", cmd: "npx vitest run" }, "abc123")).toBe("npx vitest run");
  });

  it("base 가 있으면 {{BASE}} 를 치환한다", () => {
    const cmd = resolveCommand({ dir: ".", cmd: "npx vitest run --changed {{BASE}}" }, "abc123");
    expect(cmd).toBe("npx vitest run --changed abc123");
  });

  it("{{BASE}} 가 여러 번 나와도 모두 치환한다", () => {
    expect(resolveCommand({ dir: ".", cmd: "a {{BASE}} b {{BASE}}" }, "X")).toBe("a X b X");
  });

  it("base 가 없으면 fallbackCmd 를 쓴다", () => {
    const entry = { dir: ".", cmd: "npx vitest run --changed {{BASE}}", fallbackCmd: "npx vitest run" };
    expect(resolveCommand(entry, null)).toBe("npx vitest run");
  });

  it("base 도 fallbackCmd 도 없으면 null 을 돌려준다", () => {
    expect(resolveCommand({ dir: ".", cmd: "npx vitest run --changed {{BASE}}" }, null)).toBeNull();
  });
});

describe("planGate", () => {
  const always = () => true;
  const never = () => false;

  it("존재하는 디렉터리의 항목을 실행 목록에 넣는다", () => {
    const cfg = loadConfig(
      JSON.stringify({ gate: { typecheck: [{ dir: "a", cmd: "tsc" }], test: [{ dir: "b", cmd: "vitest" }] } }),
    );
    const plan = planGate(cfg, { dirExists: always, base: null });
    expect(plan.run).toEqual([
      { kind: "typecheck", dir: "a", cmd: "tsc" },
      { kind: "test", dir: "b", cmd: "vitest" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  // 하네스를 새로 도입한 저장소에서 push 가 부당하게 막히면 안 된다.
  it("디렉터리가 없으면 실행하지 않고 이유와 함께 건너뛴다", () => {
    const cfg = loadConfig(JSON.stringify({ gate: { typecheck: [{ dir: "nope", cmd: "tsc" }] } }));
    const plan = planGate(cfg, { dirExists: never, base: null });
    expect(plan.run).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({ kind: "typecheck", dir: "nope" });
    expect(plan.skipped[0].reason).toMatch(/없/);
  });

  it("{{BASE}} 를 해석할 수 없으면 건너뛰고 이유를 남긴다", () => {
    const cfg = loadConfig(JSON.stringify({ gate: { test: [{ dir: "b", cmd: "vitest --changed {{BASE}}" }] } }));
    const plan = planGate(cfg, { dirExists: always, base: null });
    expect(plan.run).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/BASE|merge-base/);
  });

  it("base 가 있으면 치환된 명령으로 실행 목록에 넣는다", () => {
    const cfg = loadConfig(JSON.stringify({ gate: { test: [{ dir: "b", cmd: "vitest --changed {{BASE}}" }] } }));
    const plan = planGate(cfg, { dirExists: always, base: "deadbeef" });
    expect(plan.run).toEqual([{ kind: "test", dir: "b", cmd: "vitest --changed deadbeef" }]);
  });

  it("빈 설정이면 실행할 것도 건너뛸 것도 없다", () => {
    const plan = planGate(loadConfig("{}"), { dirExists: always, base: null });
    expect(plan.run).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  // typecheck 가 test 보다 먼저 와야 한다 — 타입이 깨졌으면 테스트를 돌릴 이유가 없다.
  it("typecheck 항목이 test 항목보다 앞선다", () => {
    const cfg = loadConfig(
      JSON.stringify({ gate: { test: [{ dir: "b", cmd: "vitest" }], typecheck: [{ dir: "a", cmd: "tsc" }] } }),
    );
    const plan = planGate(cfg, { dirExists: always, base: null });
    expect(plan.run.map((r) => r.kind)).toEqual(["typecheck", "test"]);
  });
});

// qa-hash.mjs 가 '어떤 파일이 테스트인가' 를 같은 설정에서 읽게 하기 위한 최소 glob.
// 외부 의존성을 늘리지 않는 것이 이 저장소의 기본이라 직접 구현한다.
describe("globToRegExp", () => {
  it("* 는 경로 구분자를 넘지 않는다", () => {
    const re = globToRegExp("*.test.ts");
    expect(re.test("a.test.ts")).toBe(true);
    expect(re.test("dir/a.test.ts")).toBe(false);
  });

  it("**/ 는 하위 디렉터리 0개 이상에 매칭된다", () => {
    const re = globToRegExp("**/*.test.ts");
    expect(re.test("a.test.ts")).toBe(true);
    expect(re.test("dir/a.test.ts")).toBe(true);
    expect(re.test("a/b/c.test.ts")).toBe(true);
  });

  it("{a,b} 를 대안으로 전개한다", () => {
    const re = globToRegExp("**/*.test.{ts,tsx,mjs}");
    expect(re.test("scripts/gate.test.mjs")).toBe(true);
    expect(re.test("a/b.test.tsx")).toBe(true);
    expect(re.test("a/b.test.js")).toBe(false);
  });

  it(". 을 리터럴로 다룬다", () => {
    const re = globToRegExp("*.test.ts");
    expect(re.test("axtestxts")).toBe(false);
  });

  it("접두어 경로를 고정한다", () => {
    const re = globToRegExp("packages/**/*.test.ts");
    expect(re.test("packages/ui/a.test.ts")).toBe(true);
    expect(re.test("apps/web/a.test.ts")).toBe(false);
  });
});

describe("matchesAnyGlob", () => {
  const patterns = DEFAULTS.testFilePatterns;

  it("기본 패턴은 .test.ts(x) 를 잡는다", () => {
    expect(matchesAnyGlob("src/a.test.ts", patterns)).toBe(true);
    expect(matchesAnyGlob("src/a.test.tsx", patterns)).toBe(true);
  });

  it("기본 패턴은 .test.mjs 를 잡지 않는다", () => {
    expect(matchesAnyGlob("scripts/a.test.mjs", patterns)).toBe(false);
  });

  it("설정으로 .mjs 를 포함시킬 수 있다", () => {
    expect(matchesAnyGlob("scripts/a.test.mjs", ["**/*.test.{ts,tsx,js,mjs}"])).toBe(true);
  });

  // Windows 경로가 그대로 들어와도 같은 결과여야 한다.
  it("역슬래시 경로를 정규화해 매칭한다", () => {
    expect(matchesAnyGlob("scripts\\a.test.mjs", ["**/*.test.mjs"])).toBe(true);
  });

  it("./ 접두어를 무시한다", () => {
    expect(matchesAnyGlob("./scripts/a.test.mjs", ["**/*.test.mjs"])).toBe(true);
  });

  it("패턴이 하나도 안 맞으면 false", () => {
    expect(matchesAnyGlob("src/a.ts", patterns)).toBe(false);
  });
});

// 게이트는 git 훅 안에서 돈다 → git 이 export 한 GIT_* 가 자식 프로세스로 흘러든다.
// GIT_DIR 이 있으면 `git -C <tmp>` 도 cwd 옵션도 무시되고 진짜 저장소가 대상이 된다.
// 실제로 이 저장소를 bare 로 재초기화하고 브랜치를 덮어썼다(BACKLOG #9).
describe("scrubGitEnv", () => {
  it("GIT_ 접두어 키를 전부 제거하고 나머지는 보존한다", () => {
    const out = scrubGitEnv({ GIT_DIR: "x", GIT_INDEX_FILE: "y", PATH: "p" });
    expect(out.GIT_DIR).toBeUndefined();
    expect(out.GIT_INDEX_FILE).toBeUndefined();
    expect(out.PATH).toBe("p");
  });

  // denylist 는 fail-open 이다 — 하나만 빠뜨려도 조용히 구멍이 남고, 그 대가가 저장소 손상이다.
  it("대상 저장소를 바꾸는 GIT_* 를 빠짐없이 제거한다", () => {
    const dangerous = {
      GIT_DIR: "a",
      GIT_WORK_TREE: "b",
      GIT_INDEX_FILE: "c",
      GIT_COMMON_DIR: "d",
      GIT_OBJECT_DIRECTORY: "e",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "f",
      GIT_NAMESPACE: "g",
      GIT_CEILING_DIRECTORIES: "h",
      GIT_EXEC_PATH: "i",
      GIT_AUTHOR_NAME: "j",
      GIT_COMMITTER_EMAIL: "k",
    };
    expect(Object.keys(scrubGitEnv(dangerous))).toEqual([]);
  });

  // process.env 를 직접 씻으면 gate.mjs 자신의 이후 git 호출까지 바뀐다.
  it("입력 객체를 변형하지 않는다", () => {
    const input = { GIT_DIR: "x", PATH: "p" };
    const out = scrubGitEnv(input);
    expect(input.GIT_DIR).toBe("x");
    expect(out).not.toBe(input);
  });

  // 접두어는 'GIT_' 다. GITHUB_TOKEN·GITSTATUS_* 는 git 의 저장소 탐색과 무관하다.
  it("GIT 으로 시작하지만 GIT_ 가 아닌 키는 보존한다", () => {
    const out = scrubGitEnv({ GITHUB_TOKEN: "t", GITHUB_ACTIONS: "true" });
    expect(out.GITHUB_TOKEN).toBe("t");
    expect(out.GITHUB_ACTIONS).toBe("true");
  });

  // PATH·NODE_*·APPDATA 가 사라지면 Windows 에서 npx 가 뜨지 않는다.
  it("GIT_* 가 없으면 내용이 같은 새 객체를 돌려준다", () => {
    const input = { PATH: "p", NODE_OPTIONS: "--x", APPDATA: "a" };
    expect(scrubGitEnv(input)).toEqual(input);
  });
});
