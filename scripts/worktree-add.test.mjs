import { describe, it, expect } from "vitest";
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
} from "./worktree-add.mjs";

// worktree-add.mjs 의 순수 함수들. main()·git·설치 명령처럼 부수효과가 있는 부분은
// 여기서 다루지 않는다 — 부수효과는 주입(resolveBaseRef 의 refExists)으로 갈라 둔다.

// ── 이번 작업에서 추가되는 함수 (test-first) ────────────────────────────────

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
    expect(parseArgs(["feat/x", "--launch"])).toEqual({ branch: "feat/x", seed: undefined });
  });

  it("--seed <값> 과 --seed=<값> 을 모두 받는다", () => {
    expect(parseArgs(["feat/x", "--seed", "go"])).toEqual({ branch: "feat/x", seed: "go" });
    expect(parseArgs(["feat/x", "--seed=go"])).toEqual({ branch: "feat/x", seed: "go" });
  });

  // --seed 의 값 토큰이 브랜치로 오인되면 엉뚱한 worktree 가 만들어진다.
  it("--seed 의 값 토큰을 브랜치로 오인하지 않는다", () => {
    expect(parseArgs(["--seed", "feat/y", "feat/x"])).toEqual({ branch: "feat/x", seed: "feat/y" });
  });

  it("브랜치가 없으면 undefined 다", () => {
    expect(parseArgs(["--launch"]).branch).toBeUndefined();
  });
});

describe("seedPromptFor", () => {
  // spec 경로를 박지 않는다 — 새 세션의 load-spec 로더가 브랜치로 주입한다.
  it("task 로 시작하는 개발 트리거 문구를 만든다", () => {
    const seed = seedPromptFor("feat/monthly-view");
    expect(seed.startsWith("monthly-view ")).toBe(true);
    expect(seed).not.toMatch(/spec\.md/);
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
