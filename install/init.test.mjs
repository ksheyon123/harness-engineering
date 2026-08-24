import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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

    const again = plan(dir, fakeGit(join(dir, ".githooks")));

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

    it("`.gitignore` 에 줄이 다 있으면 또 넣지 않는다", () => {
      const dir = tree({
        ".gitignore":
          "node_modules\n.claude/worktrees/\n.claude/post-checkout-trace.log\n.claude/harness.env\n",
      });

      expect(step(plan(dir, fakeGit()), ".gitignore").state).toBe("same");
    });

    it("`.gitignore` 에 일부만 있으면 **없는 줄만** 더한다", () => {
      // 줄이 늘어날 때마다 먼저 설치한 저장소가 그 줄을 못 받으면, 그 파일은
      // `pre-commit` 의 `git add -A` 에 잡혀 다음 커밋에 딸려 들어간다.
      const dir = tree({ ".gitignore": "node_modules\n.claude/worktrees/\n" });
      const s = step(plan(dir, fakeGit()), ".gitignore");

      expect(s.state).toBe("update");
      expect(s.contents).toContain(".claude/post-checkout-trace.log");
      expect(s.contents.match(/^\.claude\/worktrees\/$/gm)).toHaveLength(1);
    });

    it("`.gitignore` 가 없으면 만든다 — 없으면 커밋이 사본을 쓸어 담는다", () => {
      const s = step(plan(tree(), fakeGit()), ".gitignore");

      expect(s.state).toBe("create");
      expect(s.contents).toContain(".claude/worktrees/");
      expect(s.contents).toContain(".claude/post-checkout-trace.log");
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

  /**
   * 한때 이 판정이 문자열 비교(`current === ".githooks"`)였다. 그래서 **하네스가 심으려는
   * 바로 그 디렉터리를 절대경로로 적어 둔 저장소가 설치를 거부당했고**, 같은 값을 `smoke`
   * 는 정상이라고 했다 — 같은 저장소를 두 명령이 반대로 읽었다.
   */
  describe("`core.hooksPath` 는 표기가 아니라 가리키는 곳으로 판정한다", () => {
    const hooks = (result) => result.steps.concat(result.blockers).find((s) => s.kind === "config");

    /** `.githooks` 가 실재하든 안 하든 판정은 같다 — 없으면 곧 우리가 만든다. */
    for (const [label, files] of [
      ["`.githooks` 가 아직 없다", {}],
      ["`.githooks` 가 이미 있다", { ".githooks/pre-commit": "#!/bin/sh\n" }],
    ]) {
      describe(label, () => {
        it("설정되지 않았으면 우리가 심는다", () => {
          const result = plan(tree(files), fakeGit());

          expect(result.blockers).toEqual([]);
          expect(hooks(result).state).toBe("set");
        });

        it.each([".githooks", "./.githooks"])(
          "`%s` 는 우리 자리이지만 **상대값이라 절대경로로 다시 쓴다**",
          (value) => {
            // 충돌은 아니다 — 가리키는 곳은 우리 자리다. 그런데 git 은 이 값을 **각
            // 워킹트리 최상단 기준**으로 풀어서, 사본 안에서는 사본의 `.githooks/` 를
            // 찾는다. 하네스를 커밋하지 않은 저장소에서는 거기 아무것도 없어 훅이 **안 불린다.**
            const dir = tree(files);
            const result = plan(dir, fakeGit(value));

            expect(result.blockers).toEqual([]);
            expect(hooks(result).state).toBe("set");
            expect(hooks(result).value).toBe(join(dir, ".githooks"));
          },
        );

        it("절대경로로 우리 `.githooks` 를 가리키면 건드릴 것이 없다", () => {
          const dir = tree(files);
          const result = plan(dir, fakeGit(join(dir, ".githooks")));

          expect(result.blockers).toEqual([]);
          expect(hooks(result).state).toBe("same");
        });

        it("남의 곳을 가리키면 멈춘다", () => {
          const result = plan(tree(files), fakeGit(".husky/_"));

          expect(result.blockers).toHaveLength(1);
          expect(hooks(result).state).toBe("conflict");
        });
      });
    }

    it("`.husky/_` 가 실재해도 안 해도 충돌이다 — 없다는 것은 안 쓴다는 뜻이 아니다", () => {
      // husky 는 `prepare` 가 `npm install` 때 `.husky` 를 되살린다.
      for (const dir of [tree(), tree({ ".husky/_/pre-commit": "#!/bin/sh\n" })]) {
        expect(plan(dir, fakeGit(".husky/_")).blockers, dir).toHaveLength(1);
      }
    });

    it("이미 절대경로면 `git config` 를 다시 부르지 않는다", () => {
      const dir = tree();
      const git = fakeGit(join(dir, ".githooks"));

      apply(dir, git);

      expect(git.calls.filter((a) => a[0] === "config" && a[1] === "--local" && a[2] === "core.hooksPath")).toEqual([]);
    });

    it("판정식은 저장소에 한 번만 있다", () => {
      // 이번 버그의 원인은 규칙이 틀린 것이 아니라 **두 곳에 따로 적혀 어긋난 것**이다.
      const dir = fileURLToPath(new URL(".", import.meta.url));
      const hits = readdirSync(dir)
        .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
        .flatMap((name) =>
          readFileSync(join(dir, name), "utf8")
            .split(/\r?\n/)
            .filter((line) => line.includes("resolve(") && line.includes(".githooks"))
            .map((line) => `${name}: ${line.trim()}`),
        );

      expect(hits).toHaveLength(1);
      expect(hits[0].startsWith("smoke.mjs:"), hits.join("\n")).toBe(true);
    });
  });

  describe("충돌 메시지는 단정하지 않고 처방한다", () => {
    const detail = (dir) => plan(dir, fakeGit(".husky/_")).blockers[0].detail;

    it("현재 값을 그대로 보여준다", () => {
      expect(detail(tree())).toContain(".husky/_");
    });

    it("무엇을 해야 풀리는지 말한다", () => {
      expect(detail(tree())).toContain("harness init");
    });

    it("확인하지 않은 사실을 단정하지 않는다", () => {
      // 막힌 저장소에는 `.husky` 도 `.githooks` 도 없었다. 그 사람은 없는 husky 를 찾으러 갔다.
      expect(detail(tree())).not.toContain("쓰고 있을 것이다");
    });

    it("가리키는 디렉터리의 실재 여부를 찍지 않는다", () => {
      // 판정에 안 쓰기로 한 사실을 출력하면 읽는 사람이 그것을 근거로 행동한다.
      expect(detail(tree({ ".husky/_/pre-commit": "#!/bin/sh\n" }))).toBe(detail(tree()));
    });

    it("충돌이 아니면 아예 만들어지지 않는다", () => {
      const dir = tree();
      for (const value of [null, ".githooks", "./.githooks", join(dir, ".githooks")]) {
        expect(plan(dir, fakeGit(value)).blockers, `${value}`).toEqual([]);
      }
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

    it("**A 의 `package.json` 을 아예 건드리지 않는다**", () => {
      // 한때 여기에 `posttest` 를 배선했다. A 의 스크립트 자리 하나를 점유하는 일이었고,
      // 이미 쓰고 있는 프로젝트에서는 다투다 사람에게 넘기고 끝났다 — 그 안내를 놓치면
      // 게이트는 도는데 기록이 안 남아 push 가 전부 막힌다. 지금은 `harness gate` 가 한다.
      const dir = tree({
        "package.json": JSON.stringify({ name: "a", scripts: { posttest: "내 스크립트" } }),
      });
      const result = plan(dir, fakeGit());

      expect(step(result, "package.json")).toBeUndefined();
      expect(result.steps.concat(result.blockers).some((s) => s.path === "package.json")).toBe(false);
    });

    it("`package.json` 을 안 건드리는 대신 `harness gate` 로 돌리라고 말한다", () => {
      // 안 알려주면 게이트는 도는데 기록이 안 남고, 그 사실은 push 가 막히고 나서야 드러난다.
      const { notes } = plan(tree(), fakeGit());

      expect(notes.join("\n")).toContain("harness gate");
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

    it("커밋하라고 말한다 — 안 하면 worktree 사본에 하나도 안 간다", () => {
      // 파일을 쓰기만 하고 커밋하지 않는 것은 의도지만, 말해주지 않으면 사람은
      // 설치가 끝난 줄 알고 스폰한다. 그리고 사본에는 하네스가 통째로 없다.
      const { notes } = plan(tree(), fakeGit());

      expect(notes.join("\n")).toContain("git add -A");
    });

    it("게이트가 도는지 확인하라고 말한다 — 러너도 `scripts.test` 도 만들지 않았다", () => {
      const { notes } = plan(tree(), fakeGit());

      expect(notes.join("\n")).toContain("scripts.test");
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

    it("`core.hooksPath` 를 **절대경로로** 설정한다", () => {
      // 상대값이면 사본 안에서 사본의 `.githooks/` 를 찾아 훅이 안 불린다 — 그러면
      // 심기가 안 돌고, 심기가 안 도니 사본에 `.githooks/` 가 생기지도 않는다. 순환이다.
      const dir = tree();
      const git = fakeGit();
      apply(dir, git);

      expect(git.calls).toContainEqual(["config", "--local", "core.hooksPath", join(dir, ".githooks")]);
    });

    it("이미 설치돼 있으면 다시 쓰지 않는다", () => {
      const dir = tree();
      apply(dir, fakeGit());

      expect(apply(dir, fakeGit(join(dir, ".githooks"))).applied).toEqual([]);
    });
  });

  /**
   * **진짜 git 을 쓴다.** 여기서 묻는 것이 "`.gitignore` 가 막는가" 라서 가짜로는 아무것도
   * 검증되지 않는다.
   */
  describe("무시되는 경로 (진짜 저장소)", () => {
    const dirs = [];

    afterEach(() => {
      while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
    });

    function realRepo(gitignore) {
      const dir = mkdtempSync(join(tmpdir(), "init-real-"));
      dirs.push(dir);
      const git = (args) =>
        execFileSync("git", args, {
          cwd: dir,
          env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });

      git(["init", "-q", "-b", "main"]);
      git(["config", "user.email", "a@example.invalid"]);
      git(["config", "user.name", "a"]);
      writeFileSync(join(dir, ".gitignore"), gitignore);
      return { dir, git };
    }

    it("`.claude` 가 통째로 무시돼도 뚫지 않는다", () => {
      // A 가 `.claude` 를 무시한 것은 거기 든 것을 **개인 설정**으로 본 판단이다
      // (개발자마다 다른 하네스를 쓴다). 한때 설치기가 `git add -f` 로 그것을 뚫었는데,
      // 사본에 도달하는 길이 커밋 하나뿐이던 시절의 얘기다 — 지금은 심기가 데려간다.
      const { dir, git } = realRepo(".claude\nnode_modules\n");

      apply(dir, git);

      expect(git(["ls-files"])).toBe("");
      expect(git(["diff", "--cached", "--name-only"])).toBe("");
    });

    it("무시되지 않아도 인덱스를 건드리지 않는다", () => {
      // 사람이 칠 `git add -A` 가 알아서 담는다. `package.json` 같은 A 의 파일에는
      // 하네스와 무관한 미커밋 수정이 섞여 있을 수 있어, 필요 없는 것까지 올리지 않는다.
      const { dir, git } = realRepo("node_modules\n");

      apply(dir, git);

      expect(git(["ls-files"])).toBe("");
      expect(git(["diff", "--cached", "--name-only"])).toBe("");
    });

    it("`.githooks` 만 무시돼도 마찬가지다", () => {
      const { dir, git } = realRepo(".githooks\nnode_modules\n");

      apply(dir, git);

      expect(git(["diff", "--cached", "--name-only"])).toBe("");
    });

    it("`staged` 를 더는 보고하지 않는다 — 인덱스를 만지지 않으니 보고할 것이 없다", () => {
      const { dir, git } = realRepo(".claude\n");

      expect(apply(dir, git).staged).toBeUndefined();
    });
  });
});

/**
 * 그 문서는 **남의 저장소에 하네스를 세우는 절차**다. 거기 적힌 충돌 조건이 코드보다 좁으면
 * 읽는 사람은 자기 저장소가 왜 막혔는지 문서에서 답을 못 찾는다. 낡은 사본은 없는 것보다 나쁘다.
 */
describe("`docs/implementation.md` 가 판정과 같은 것을 말한다", () => {
  const doc = readFileSync(new URL("../docs/implementation.md", import.meta.url), "utf8");
  const row = (needle) => doc.split(/\r?\n/).find((line) => line.startsWith("|") && line.includes(needle));

  it("husky·lefthook 을 충돌의 조건으로 적지 않는다", () => {
    expect(doc).not.toContain("husky·lefthook 을 가리킨다");
    expect(doc).not.toContain("husky·lefthook 이 이미 차지했다");
  });

  it("충돌 조건을 가리키는 곳으로 적는다", () => {
    const conflict = row("빼앗으면 A 의 기존 훅");

    expect(conflict).toBeDefined();
    expect(conflict).toContain("가리키는 곳");
    expect(conflict).toContain("`.githooks`");
  });

  it("절대경로로 우리 `.githooks` 를 가리키는 것은 충돌이 아님을 명시한다", () => {
    expect(row("빼앗으면 A 의 기존 훅")).toContain("충돌이 아니다");
  });

  it("트러블슈팅 행의 처방이 `init` 이 찍는 것과 같다", () => {
    const trouble = row("`init` 이 멈추고 `core.hooksPath`");
    const detail = plan(tree(), fakeGit(".husky/_")).blockers[0].detail;

    expect(trouble).toBeDefined();
    for (const needle of ["harness init", "git config --local --unset core.hooksPath", "이어 붙"]) {
      expect(trouble, needle).toContain(needle);
      expect(detail, needle).toContain(needle);
    }
  });
});
