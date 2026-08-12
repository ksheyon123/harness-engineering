import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { apply, plan } from "./init.mjs";

/** 패키지 이름은 **한 곳에서만** 온다. 여기 적으면 이름을 바꿀 때 이 파일만 낡는다. */
const PKG_NAME = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).name;

/**
 * 설치 대상 흉내. **git 은 부르지 않는다** — `plan` 이 git 에게 묻는 것은
 * `core.hooksPath` 하나뿐이라 가짜로 충분하다.
 */
function tree(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "init-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

/** `core.hooksPath` 가 `value` 인 저장소. `null` 이면 설정되지 않은 것이다. */
function fakeGit(value = null) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args.includes("--get")) {
      if (value === null) throw new Error("설정되지 않았다");
      return `${value}\n`;
    }
    return "";
  };
  git.calls = calls;
  return git;
}

const step = (result, path) => result.steps.find((s) => s.path === path);
const states = (result) => Object.fromEntries(result.steps.filter((s) => s.path).map((s) => [s.path, s.state]));

describe("init — 설치 판정", () => {
  it("빈 저장소에는 전부 새로 만든다", () => {
    const result = plan(tree(), fakeGit());

    expect(result.blockers).toEqual([]);
    expect(step(result, ".claude/hooks/path-ownership.mjs").state).toBe("create");
    expect(step(result, ".githooks/pre-commit").state).toBe("create");
    expect(step(result, ".claude/agents/developer.md").state).toBe("create");
    expect(step(result, ".claude/harness.md").state).toBe("create");
  });

  it("shim 은 패키지 이름을 임포트하는 한 줄이다", () => {
    // 본체는 패키지에 두고 A 에는 추적되는 한 줄만 남긴다 — worktree 사본에도 복사되고,
    // node 의 상향 해석이 부모의 node_modules 를 찾는다.
    const contents = step(plan(tree(), fakeGit()), ".claude/hooks/verify-green.mjs").contents;

    expect(contents.trim()).toBe(`import "${PKG_NAME}/hooks/verify-green.mjs";`);
  });

  it("두 번 돌려도 아무것도 안 바뀐다", () => {
    const dir = tree();
    const git = fakeGit();
    apply(dir, git);

    const again = plan(dir, fakeGit(".githooks"));

    expect(again.steps.filter((s) => s.state && s.state !== "same")).toEqual([]);
  });

  describe("이미 있는 것을 덮어쓰지 않는다", () => {
    it("`CLAUDE.md` 는 앞에 한 줄만 붙이고 본문을 남긴다", () => {
      const dir = tree({ ".claude/CLAUDE.md": "# A 프로젝트\n\n우리 규약\n" });
      const s = step(plan(dir, fakeGit()), ".claude/CLAUDE.md");

      expect(s.state).toBe("update");
      expect(s.contents).toContain("우리 규약");
      expect(s.contents.split(/\r?\n/)[0]).toBe("@harness.md");
    });

    it("임포트가 이미 있으면 손대지 않는다", () => {
      const dir = tree({ ".claude/CLAUDE.md": "@harness.md\n\n우리 규약\n" });

      expect(step(plan(dir, fakeGit()), ".claude/CLAUDE.md").state).toBe("same");
    });

    it("`.gitignore` 에 줄이 있으면 또 넣지 않는다", () => {
      const dir = tree({ ".gitignore": "node_modules\n.claude/worktrees/\n" });

      expect(step(plan(dir, fakeGit()), ".gitignore").state).toBe("same");
    });

    it("`.gitignore` 가 없으면 만든다 — 없으면 커밋이 사본을 쓸어 담는다", () => {
      const s = step(plan(tree(), fakeGit()), ".gitignore");

      expect(s.state).toBe("create");
      expect(s.contents).toContain(".claude/worktrees/");
    });

    it("`settings.json` 의 기존 훅을 지우지 않고 더한다", () => {
      const dir = tree({
        ".claude/settings.json": JSON.stringify({
          permissions: { allow: ["Bash"] },
          hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "내 훅" }] }] },
        }),
      });

      const merged = JSON.parse(step(plan(dir, fakeGit()), ".claude/settings.json").contents);

      expect(merged.permissions.allow).toEqual(["Bash"]);
      expect(merged.hooks.PreToolUse).toHaveLength(2);
      expect(JSON.stringify(merged.hooks.PreToolUse)).toContain("내 훅");
      expect(JSON.stringify(merged.hooks.PreToolUse)).toContain("path-ownership.mjs");
      expect(merged.worktree.baseRef).toBe("head");
    });

    it("같은 훅이 이미 배선돼 있으면 두 번 넣지 않는다", () => {
      const dir = tree();
      apply(dir, fakeGit());
      const first = readFileSync(join(dir, ".claude/settings.json"), "utf8");

      expect(step(plan(dir, fakeGit(".githooks")), ".claude/settings.json").state).toBe("same");
      expect(JSON.parse(first).hooks.PreToolUse).toHaveLength(1);
    });
  });

  describe("판단할 수 없는 것은 사람에게 넘긴다", () => {
    it("`core.hooksPath` 가 남의 것이면 멈춘다", () => {
      // husky·lefthook 이 같은 설정을 차지한다. 빼앗으면 그쪽 훅이 조용히 죽는다.
      const result = plan(tree(), fakeGit(".husky/_"));

      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].detail).toContain(".husky/_");
    });

    it("멈췄으면 아무것도 만들지 않는다", () => {
      const dir = tree();
      const result = apply(dir, fakeGit(".husky/_"));

      expect(result.applied).toEqual([]);
      expect(existsSync(join(dir, ".claude/hooks/path-ownership.mjs"))).toBe(false);
    });

    it("`posttest` 가 이미 있으면 빼앗지 않고 알린다", () => {
      const dir = tree({
        "package.json": JSON.stringify({ name: "a", scripts: { posttest: "내 스크립트" } }),
      });
      const s = step(plan(dir, fakeGit()), "package.json");

      expect(s.kind).toBe("manual");
      expect(s.detail).toContain("내 스크립트");
    });

    it("`worktree.baseRef` 가 다르면 알린다", () => {
      // 회수는 역할 브랜치가 스폰 시점의 직계 자손임을 전제한다.
      const dir = tree({ ".claude/settings.json": JSON.stringify({ worktree: { baseRef: "main" } }) });

      expect(step(plan(dir, fakeGit()), ".claude/settings.json").kind).toBe("manual");
    });

    it("`settings.json` 이 JSON 이 아니면 알린다", () => {
      const dir = tree({ ".claude/settings.json": "{ 깨진 JSON" });

      expect(step(plan(dir, fakeGit()), ".claude/settings.json").kind).toBe("manual");
    });
  });

  describe("손댈 수 없는 것은 적어서 넘긴다", () => {
    it("러너 제외와 설정 파일을 안내한다", () => {
      const { notes } = plan(tree(), fakeGit());

      expect(notes.join("\n")).toContain(".claude/worktrees/**");
      expect(notes.join("\n")).toContain("harness.config.json");
    });
  });

  describe("apply", () => {
    it("판정대로 만든다", () => {
      const dir = tree();
      apply(dir, fakeGit());

      for (const path of [
        ".claude/hooks/verify-green.mjs",
        ".githooks/pre-commit",
        ".githooks/pre-commit.mjs",
        ".claude/agents/qa.md",
        ".claude/planner-mode.md",
        ".claude/harness.md",
        ".claude/CLAUDE.md",
        ".claude/settings.json",
        ".gitignore",
      ]) {
        expect(existsSync(join(dir, path)), path).toBe(true);
      }
    });

    it("`core.hooksPath` 를 설정한다", () => {
      const git = fakeGit();
      apply(tree(), git);

      expect(git.calls).toContainEqual(["config", "--local", "core.hooksPath", ".githooks"]);
    });

    it("이미 설치돼 있으면 다시 쓰지 않는다", () => {
      const dir = tree();
      apply(dir, fakeGit());

      expect(apply(dir, fakeGit(".githooks")).applied).toEqual([]);
    });
  });
});
