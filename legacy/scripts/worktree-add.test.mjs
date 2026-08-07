import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import {
  taskFromBranch,
  worktreePathFor,
  assertOutsideRepo,
  parseWorktreeList,
  parseArgs,
  seedPromptFor,
  shellSingleQuote,
  powershellSingleQuote,
  launchCommandFor,
  launchCommandForWindows,
  terminalLaunchScript,
  resolveBaseRef,
  worktreeAddArgs,
  installCommandFor,
  baseForNewBranch,
  baseMismatchWarning,
  isTaskRegistered,
} from "./worktree-add.mjs";

// worktree-add.mjs 의 순수 함수들. main()·git·설치 명령처럼 부수효과가 있는 부분은
// 여기서 다루지 않는다 — 부수효과는 주입(resolveBaseRef 의 refExists)으로 갈라 둔다.

// ── spec-in-worktree 에서 추가되는 함수 (test-first) ────────────────────────

describe("baseForNewBranch", () => {
  // 리비전 흐름: worktree-add.mjs feat/a-1 --from feat/a --launch
  it("--from 이 있으면 그 브랜치에서 분기한다", () => {
    expect(baseForNewBranch({ from: "feat/a", configBaseBranch: "main" })).toBe("feat/a");
  });

  it("--from 이 없으면 설정의 baseBranch 를 쓴다 (기존 동작)", () => {
    expect(baseForNewBranch({ from: undefined, configBaseBranch: "main" })).toBe("main");
  });
});

// ── base-branch-single-source 에서 추가되는 함수 (test-first) ───────────────

describe("baseMismatchWarning", () => {
  const BASE = { from: undefined, baseRef: "origin/main", configBaseBranch: "main" };

  // 이것이 열린 구멍 #7 그 자체: 다른 브랜치를 체크아웃해 둔 채 실행하면 조용히 baseBranch 에서 잘린다.
  it("--from 없이 현재 브랜치가 baseBranch 와 다르면 경고 문자열을 낸다", () => {
    const msg = baseMismatchWarning({ ...BASE, currentBranch: "feat/other" });
    expect(typeof msg).toBe("string");
    expect(msg).toContain("feat/other");
    expect(msg).toContain("main");
  });

  it("현재 브랜치가 baseBranch 와 같으면 경고하지 않는다", () => {
    expect(baseMismatchWarning({ ...BASE, currentBranch: "main" })).toBeNull();
  });

  // 사용자가 기준을 명시했으면 불일치가 아니라 의도다.
  it("--from 을 지정했으면 경고하지 않는다", () => {
    expect(baseMismatchWarning({ ...BASE, from: "feat/a", currentBranch: "feat/other" })).toBeNull();
  });

  // attach 경로(ensureWorktree 가 baseRef=null 을 반환)는 분기 기준을 아예 쓰지 않는다 → 거짓 경고 방지.
  it("브랜치가 이미 있어 attach 하는 경로(baseRef=null)에서는 경고하지 않는다", () => {
    expect(baseMismatchWarning({ ...BASE, baseRef: null, currentBranch: "feat/other" })).toBeNull();
  });

  // 판별 실패·detached HEAD 는 '간섭 안 함' 쪽으로 기운다 — 스크립트가 자기 오류로 흐름을 깨지 않는다.
  it("현재 브랜치를 판별하지 못했으면 경고하지 않는다", () => {
    for (const currentBranch of [null, undefined, ""]) {
      expect(baseMismatchWarning({ ...BASE, currentBranch })).toBeNull();
    }
  });

  it("어떤 입력 조합에서도 throw 하지 않고 문자열 또는 null 을 낸다", () => {
    const values = [undefined, null, "", "x"];
    for (const from of values)
      for (const baseRef of values)
        for (const currentBranch of values)
          for (const configBaseBranch of values) {
            const out = baseMismatchWarning({ from, baseRef, currentBranch, configBaseBranch });
            expect(out === null || typeof out === "string").toBe(true);
          }
  });
});

describe("isTaskRegistered", () => {
  it("tasks 에 브랜치 키가 있으면 등록됨이다", () => {
    expect(isTaskRegistered('{"tasks":{"feat/a":"harness/a/spec.md"}}', "feat/a")).toBe(true);
  });

  it("tasks 가 비어 있으면 미등록이다", () => {
    expect(isTaskRegistered('{"tasks":{}}', "feat/a")).toBe(false);
  });

  it("다른 브랜치만 등록돼 있으면 미등록이다", () => {
    expect(isTaskRegistered('{"tasks":{"feat/a":"harness/a/spec.md"}}', "feat/a-1")).toBe(false);
  });

  // 두 오판은 비대칭이다. '미등록' 오판의 최악은 재작업(그리고 pre-commit 이 막는다)이지만,
  // '등록됨' 오판은 spec 없이 코드부터 짜게 만들고 그걸 잡는 장치가 없다 → 미등록으로 기운다.
  it("JSON 이 깨졌으면 미등록으로 기운다", () => {
    expect(isTaskRegistered("not json", "feat/a")).toBe(false);
  });

  it("입력이 없으면(파일 부재) 미등록으로 기운다", () => {
    expect(isTaskRegistered(undefined, "feat/a")).toBe(false);
  });

  it("tasks 키 자체가 없어도 미등록이다", () => {
    expect(isTaskRegistered("{}", "feat/a")).toBe(false);
  });
});

// ── worktree-config 에서 추가된 함수 ───────────────────────────────────────

describe("resolveBaseRef", () => {
  const only = (...names) => (ref) => names.includes(ref);

  it("로컬 ref 가 있으면 그 이름을 쓴다", () => {
    expect(resolveBaseRef("main", { refExists: only("main", "origin/main") })).toBe("main");
  });

  // 갓 클론한 저장소엔 로컬 추적 브랜치가 없을 수 있다.
  it("로컬이 없고 origin 만 있으면 origin/<base> 를 쓴다", () => {
    expect(resolveBaseRef("dev", { refExists: only("origin/dev") })).toBe("origin/dev");
  });

  // HEAD 로 조용히 물러서면 의도치 않은 커밋에서 분기되고, 그 사실은 한참 뒤에 드러난다.
  it("둘 다 없으면 throw 하고, 메시지가 기준 브랜치와 설정 파일을 가리킨다", () => {
    const call = () => resolveBaseRef("dev", { refExists: () => false });
    expect(call).toThrow(/dev/);
    expect(call).toThrow(/harness\/config\.json/);
    expect(call).toThrow(/baseBranch/);
  });
});

describe("worktreeAddArgs", () => {
  it("브랜치가 없으면 -b 와 기준 ref 로 새로 분기한다", () => {
    expect(
      worktreeAddArgs({ branch: "feat/x", path: "/wt/x", baseRef: "main", branchExists: false }),
    ).toEqual(["worktree", "add", "-b", "feat/x", "/wt/x", "main"]);
  });

  // 기존 브랜치 attach 는 기준 ref 가 필요 없다 — 기준 브랜치가 없는 저장소에서도 동작해야 한다.
  it("브랜치가 이미 있으면 -b 도 기준 ref 도 넣지 않는다", () => {
    const args = worktreeAddArgs({
      branch: "feat/x",
      path: "/wt/x",
      baseRef: undefined,
      branchExists: true,
    });
    expect(args).toEqual(["worktree", "add", "/wt/x", "feat/x"]);
    expect(args).not.toContain("-b");
  });
});

describe("installCommandFor", () => {
  const expected = (path, cmd) =>
    process.platform === "win32"
      ? `Set-Location ${powershellSingleQuote(path)}; ${cmd}`
      : `cd ${shellSingleQuote(path)} && ${cmd}`;

  it("설정 명령을 안내 문구에 넣는다", () => {
    expect(installCommandFor("/x", "pnpm install")).toBe(expected("/x", "pnpm install"));
    expect(installCommandFor("/x", "pnpm install")).toContain("pnpm install");
  });

  // 인수기준의 "npm install 이 포함되지 않는다" 는 'pnpm install' 로는 검증할 수 없다
  // ("pnpm install" 자체가 "npm install" 을 부분문자열로 포함한다). 겹치지 않는 명령으로 확인한다.
  it("npm 하드코딩이 남아 있지 않다", () => {
    expect(installCommandFor("/x", "bun install")).not.toContain("npm install");
  });

  it("기본값을 넘기면 기존 동작(npm install)과 같다", () => {
    expect(installCommandFor("/x", "npm install")).toBe(expected("/x", "npm install"));
  });

  it("경로의 따옴표를 플랫폼 규칙대로 이스케이프한다", () => {
    const out = installCommandFor("/a'b", "npm install");
    expect(out).toBe(expected("/a'b", "npm install"));
    expect(out).toContain(process.platform === "win32" ? "''" : `'\\''`);
  });
});

// ── 기존 함수의 특성 테스트 (현재 동작 고정) ────────────────────────────────

describe("taskFromBranch", () => {
  it("마지막 세그먼트를 task 로 쓴다", () => {
    expect(taskFromBranch("feat/monthly-view")).toBe("monthly-view");
    expect(taskFromBranch("refactor/a/b/c")).toBe("c");
    expect(taskFromBranch("plain")).toBe("plain");
  });

  it("빈 브랜치명은 거부한다", () => {
    expect(() => taskFromBranch("")).toThrow();
    expect(() => taskFromBranch("   ")).toThrow();
    expect(() => taskFromBranch(undefined)).toThrow();
  });

  // 경로 탈출·주입 방지: 형식 검사는 경로 조립보다 먼저다.
  it("형식 위반(선행 -, .., 공백, 특수문자)을 거부한다", () => {
    for (const bad of ["-x", "a..b", "a b", "a;rm -rf /", "/leading"]) {
      expect(() => taskFromBranch(bad)).toThrow(/형식/);
    }
  });
});

describe("worktreePathFor", () => {
  // 구분자 차이에 걸리지 않도록 기대값도 join 으로 만든다.
  it("저장소의 형제 디렉터리 <repo>-<task> 를 만든다", () => {
    const root = resolve("/repos/harness-engineering");
    expect(worktreePathFor(root, "feat/monthly-view")).toBe(
      join(dirname(root), `${basename(root)}-monthly-view`),
    );
  });

  it("상대경로 root 도 절대경로로 해석한다", () => {
    const out = worktreePathFor(".", "feat/x");
    expect(out).toBe(join(dirname(resolve(".")), `${basename(resolve("."))}-x`));
  });
});

describe("assertOutsideRepo", () => {
  const root = resolve("/repos/app");

  it("저장소 밖 형제 경로는 통과한다", () => {
    expect(() => assertOutsideRepo(root, join(dirname(root), "app-x"))).not.toThrow();
  });

  // 저장소 안에 두면 타입 검사·테스트 러너의 글로빙과 .gitignore 가 그 트리를 오인한다.
  it("저장소 내부 경로와 저장소 자신은 거부한다", () => {
    expect(() => assertOutsideRepo(root, join(root, ".claude", "worktrees", "x"))).toThrow(/내부/);
    expect(() => assertOutsideRepo(root, root)).toThrow(/내부/);
  });
});

describe("parseWorktreeList", () => {
  it("porcelain 출력을 { path, branch } 로 파싱한다", () => {
    const out = parseWorktreeList(
      [
        "worktree /repos/app",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /repos/app-x",
        "HEAD def456",
        "branch refs/heads/feat/x",
        "",
      ].join("\n"),
    );
    expect(out).toEqual([
      { path: "/repos/app", branch: "main" },
      { path: "/repos/app-x", branch: "feat/x" },
    ]);
  });

  it("detached HEAD 는 branch=null 이다", () => {
    const out = parseWorktreeList("worktree /repos/app-d\nHEAD abc123\ndetached\n");
    expect(out).toEqual([{ path: "/repos/app-d", branch: null }]);
  });

  it("CRLF 출력에서도 ref 이름이 깨지지 않는다", () => {
    const out = parseWorktreeList("worktree /repos/app\r\nbranch refs/heads/main\r\n");
    expect(out).toEqual([{ path: "/repos/app", branch: "main" }]);
  });

  it("빈 입력은 빈 배열이다", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("첫 비플래그 토큰을 브랜치로 본다", () => {
    expect(parseArgs(["feat/x", "--launch"])).toEqual({
      branch: "feat/x",
      seed: undefined,
      from: undefined,
    });
  });

  it("--seed <값> 과 --seed=<값> 을 모두 받는다", () => {
    expect(parseArgs(["feat/x", "--seed", "go"])).toMatchObject({ branch: "feat/x", seed: "go" });
    expect(parseArgs(["feat/x", "--seed=go"])).toMatchObject({ branch: "feat/x", seed: "go" });
  });

  // --seed 의 값 토큰이 브랜치로 오인되면 엉뚱한 worktree 가 만들어진다.
  it("--seed 의 값 토큰을 브랜치로 오인하지 않는다", () => {
    expect(parseArgs(["--seed", "feat/y", "feat/x"])).toMatchObject({
      branch: "feat/x",
      seed: "feat/y",
    });
  });

  it("--from <값> 과 --from=<값> 을 모두 받는다", () => {
    expect(parseArgs(["feat/a-1", "--from", "feat/a"])).toEqual({
      branch: "feat/a-1",
      seed: undefined,
      from: "feat/a",
    });
    expect(parseArgs(["--from=feat/a", "feat/a-1"])).toEqual({
      branch: "feat/a-1",
      seed: undefined,
      from: "feat/a",
    });
  });

  // --seed 와 같은 함정: 값 토큰이 브랜치로 새면 엉뚱한 worktree 가 만들어진다.
  it("--from 의 값 토큰을 브랜치로 오인하지 않는다", () => {
    expect(parseArgs(["--from", "feat/a", "feat/a-1"])).toMatchObject({
      branch: "feat/a-1",
      from: "feat/a",
    });
  });

  it("--from 과 --seed 를 함께 줘도 서로 값을 침범하지 않는다", () => {
    expect(parseArgs(["feat/a-1", "--from", "feat/a", "--seed", "go"])).toEqual({
      branch: "feat/a-1",
      from: "feat/a",
      seed: "go",
    });
  });

  it("브랜치가 없으면 undefined 다", () => {
    expect(parseArgs(["--launch"]).branch).toBeUndefined();
  });
});

describe("seedPromptFor", () => {
  // spec 경로를 박지 않는다 — 새 세션의 load-spec 로더가 브랜치로 주입한다.
  it("두 분기 모두 task 로 시작하고 spec 경로를 박지 않는다", () => {
    for (const registered of [true, false]) {
      const seed = seedPromptFor("feat/monthly-view", { registered });
      expect(seed.startsWith("monthly-view ")).toBe(true);
      expect(seed).not.toMatch(/spec\.md/);
    }
  });

  // 2분기가 존재하는 유일한 이유는 '중단 재개'(등록됨)를 갈라내는 것이다 —
  // 그 경우에 '기획부터' 를 주면 규칙 2 로 재작성이 막힌 spec 을 다시 쓰라고 지시하게 된다.
  it("등록 여부에 따라 다른 문구를 만든다", () => {
    const planning = seedPromptFor("feat/a", { registered: false });
    const resuming = seedPromptFor("feat/a", { registered: true });
    expect(planning).not.toBe(resuming);
  });

  it("미등록이면 기획(planner)부터 시작하라고 지시한다", () => {
    expect(seedPromptFor("feat/a", { registered: false })).toMatch(/기획|planner/);
  });

  it("등록됐으면 기획이 아니라 구현을 이어가라고 지시한다", () => {
    const seed = seedPromptFor("feat/a", { registered: true });
    expect(seed).toMatch(/구현/);
    expect(seed).not.toMatch(/planner/);
  });
});

// warnLaunchContext 는 메인 체크아웃의 index.json 을 읽었다. 새 흐름에서 등록은 언제나
// 작업 브랜치 위에서 일어나므로 그 정보는 머지 전까지 main 에 없다 — 살아 있는 모든 task 에
// 대해 항상 '미등록' 을 반환하는, 정보량 0 의 경고였다.
describe("warnLaunchContext 제거", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "worktree-add.mjs"),
    "utf8",
  );

  it("식별자가 정의도 호출도 남아 있지 않다", () => {
    expect(source).not.toMatch(/warnLaunchContext/);
  });
});

describe("셸 인용", () => {
  it("shellSingleQuote 는 내부 ' 를 POSIX 규칙으로 이스케이프한다", () => {
    expect(shellSingleQuote("/a b")).toBe("'/a b'");
    expect(shellSingleQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it("powershellSingleQuote 는 내부 ' 를 '' 로 이스케이프한다", () => {
    expect(powershellSingleQuote("a'b")).toBe("'a''b'");
  });

  it("launchCommandFor / launchCommandForWindows 는 경로와 seed 를 모두 인용한다", () => {
    expect(launchCommandFor("/a b", "go now")).toBe("cd '/a b' && claude 'go now'");
    expect(launchCommandForWindows("C:\\a b", "go now")).toBe(
      "Set-Location -LiteralPath 'C:\\a b'; claude 'go now'",
    );
  });

  it("terminalLaunchScript 는 AppleScript 문자열의 \\ 와 \" 만 이스케이프한다", () => {
    expect(terminalLaunchScript(`cd 'a\\b" c'`)).toContain(`do script "cd 'a\\\\b\\" c'"`);
  });
});
