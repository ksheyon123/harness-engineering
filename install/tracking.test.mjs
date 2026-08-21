import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  COMMITTED,
  IGNORED,
  MISSING,
  PRESCRIPTION,
  STAGED,
  UNTRACKED,
  groupByState,
  reaches,
  trackingStates,
} from "./tracking.mjs";

/**
 * **진짜 git 을 쓴다.** 여기서 묻는 것이 정확히 "git 이 이 파일을 어떻게 보는가" 라서,
 * 가짜로는 아무것도 검증되지 않는다 — 이 판정의 이전 버전이 틀렸던 이유도 git 에게 안 묻고
 * 인덱스만 봤기 때문이었다.
 */
const trees = [];

afterEach(() => {
  while (trees.length) rmSync(trees.pop(), { recursive: true, force: true });
});

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return env;
}

function repo({ commits = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "track-"));
  trees.push(dir);

  const git = (args) =>
    execFileSync("git", args, { cwd: dir, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const write = (path, text) => {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  };

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "a@example.invalid"]);
  git(["config", "user.name", "a"]);
  write(".gitignore", ".claude\nnode_modules\n");
  if (commits) {
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
  }

  return { dir, git, write };
}

describe("tracking — 사본까지 가는가", () => {
  it("다섯 상태를 가른다", () => {
    const { dir, git, write } = repo();

    write("committed.md", "a\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "second"]);

    write("staged.md", "b\n");
    git(["add", "--", "staged.md"]);

    write("untracked.md", "c\n");
    write(".claude/harness.md", "d\n"); // `.gitignore` 가 막는다

    const states = trackingStates(
      dir,
      ["committed.md", "staged.md", "untracked.md", ".claude/harness.md", ".claude/gone.md"],
      git,
    );

    expect(states.get("committed.md")).toBe(COMMITTED);
    expect(states.get("staged.md")).toBe(STAGED);
    expect(states.get("untracked.md")).toBe(UNTRACKED);
    expect(states.get(".claude/harness.md")).toBe(IGNORED);
    expect(states.get(".claude/gone.md")).toBe(MISSING);
  });

  it("스테이징은 커밋이 아니다 — 사본은 커밋된 것만 받는다", () => {
    // 이 한 줄이 예전 판정이 놓쳤던 전부다. `git ls-files` 는 인덱스라 여기서 초록을 냈고,
    // 그동안 worktree 사본에는 아무것도 없었다.
    const { dir, git, write } = repo();

    write(".claude/harness.md", "x\n");
    git(["add", "-f", "--", ".claude/harness.md"]);

    expect(trackingStates(dir, [".claude/harness.md"], git).get(".claude/harness.md")).toBe(STAGED);
  });

  it("한 번 담기면 `.gitignore` 는 그 파일에 힘이 없다", () => {
    // 그래서 `-f` 는 한 번만 하면 되고, 이후 `git add -A` 가 수정분을 정상적으로 담는다.
    const { dir, git, write } = repo();

    write(".claude/harness.md", "x\n");
    git(["add", "-f", "--", ".claude/harness.md"]);
    git(["commit", "-qm", "forced"]);
    write(".claude/harness.md", "고쳤다\n");
    git(["add", "-A"]);

    expect(trackingStates(dir, [".claude/harness.md"], git).get(".claude/harness.md")).toBe(COMMITTED);
  });

  it("커밋이 하나도 없는 저장소를 오류로 보지 않는다", () => {
    // 갓 `git init` 한 트리에 설치하는 것은 정상 경로다. 답은 "못 쟀다" 가 아니라
    // "아무것도 커밋 안 됐다" 여야 한다.
    const { dir, git, write } = repo({ commits: false });
    write("a.md", "x\n");

    expect(trackingStates(dir, ["a.md"], git).get("a.md")).toBe(UNTRACKED);
  });

  it("git 을 못 쓰면 `null` — 모른다는 것도 정보다", () => {
    const { dir } = repo();
    const dead = () => {
      throw new Error("git 없음");
    };

    expect(trackingStates(dir, ["a.md"], dead)).toBeNull();
  });

  it("묶음은 상태별로 처방을 하나씩 낸다", () => {
    const { dir, git, write } = repo();
    write("untracked.md", "c\n");
    write(".claude/harness.md", "d\n");

    const groups = groupByState(trackingStates(dir, ["untracked.md", ".claude/harness.md", ".gitignore"], git));

    // 커밋된 것은 빠지고, 급한 것(고쳐야 담기는 것)이 앞에 온다.
    expect(groups.map((g) => g.state)).toEqual([IGNORED, UNTRACKED]);
    expect(groups[0].paths).toEqual([".claude/harness.md"]);
    expect(groups[1].prescription).toContain("git add -A");
  });

  it("무시되는 것에 `git add -f` 를 처방하지 않는다", () => {
    // A 가 `.claude/` 를 무시한 판단을 설치 도구가 뒤집을 일이 아니다. 뚫지 않아도 되는
    // 이유는 도달 경로가 둘이 됐기 때문이다 — 커밋이거나, `post-checkout` 의 심기거나.
    expect(PRESCRIPTION[IGNORED]).not.toContain("git add -f");
    expect(PRESCRIPTION[IGNORED]).toContain("post-checkout");
  });

  describe("도달 판정 — 길이 둘이다", () => {
    it("커밋돼 있으면 심기와 무관하게 도달한다", () => {
      expect(reaches(COMMITTED, false)).toBe(true);
      expect(reaches(COMMITTED, true)).toBe(true);
    });

    it("심기가 있으면 디스크에 있는 것은 전부 도달한다", () => {
      // 심기는 본체의 **워킹트리**에서 복사하므로 git 상태를 묻지 않는다.
      for (const state of [IGNORED, UNTRACKED, STAGED]) {
        expect(reaches(state, true), state).toBe(true);
        expect(reaches(state, false), state).toBe(false);
      }
    });

    it("없는 것은 심기가 있어도 도달하지 못한다", () => {
      expect(reaches(MISSING, true)).toBe(false);
    });

    it("심기가 있으면 묶음에 `MISSING` 만 남는다", () => {
      const { dir, git, write } = repo();
      write("untracked.md", "c\n");
      write(".claude/harness.md", "d\n");

      const states = trackingStates(dir, ["untracked.md", ".claude/harness.md", "없다.md"], git);

      expect(groupByState(states, true).map((g) => g.state)).toEqual([MISSING]);
    });
  });
});
