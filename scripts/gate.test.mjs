import { describe, it, expect } from "vitest";
import {
  loadConfig,
  resolveCommand,
  planGate,
  globToRegExp,
  matchesAnyGlob,
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

  // 설정 오타가 '게이트 없음' 으로 조용히 둔갑하면 안 된다.
  it("JSON 파싱에 실패하면 throw 한다", () => {
    expect(() => loadConfig("{ not json ")).toThrow();
  });

  it("gate 항목에 dir 이나 cmd 가 없으면 throw 한다", () => {
    expect(() => loadConfig(JSON.stringify({ gate: { test: [{ cmd: "x" }] } }))).toThrow(/dir/);
    expect(() => loadConfig(JSON.stringify({ gate: { test: [{ dir: "." }] } }))).toThrow(/cmd/);
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
