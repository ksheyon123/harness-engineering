import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { PROBES, inspect, mainRoot, plantingWired, report, trust } from "./smoke.mjs";
import { pointsAtGithooks } from "./smoke.mjs";

/**
 * `inspect` 의 **판정**을 본다. 배선이 실제로 도는지는 `init.integration.test.mjs` 가
 * tarball 을 풀어 확인하고, 여기서는 **끊긴 배선을 끊겼다고 부르는가**만 묻는다.
 *
 * 그래서 훅 본체는 전부 stub 이다. 진짜 판정을 넣으면 이 파일이 층 1 의 테스트가 되고,
 * 그건 이미 `path-ownership.test.mjs` 가 한다.
 */

/** stdin 을 비우고 정해진 JSON 을 뱉는 훅. 실제 계약과 같은 모양이다. */
const PATH_OWNERSHIP = `import { readFileSync } from "node:fs";
try { readFileSync(0, "utf8"); } catch {}
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
}));
`;

const SESSION_ROLE = `import { readFileSync } from "node:fs";
try { readFileSync(0, "utf8"); } catch {}
const role = (process.env.HARNESS_ROLE ?? "").trim();
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: role === "" ? "너는 실행자다" : "너는 작업 세션이다",
  },
}));
`;

const agent = (role, hook) => `---
name: ${role}
tools: Read
isolation: worktree
hooks:
  SubagentStop:
    - hooks:
        - type: command
          command: node .claude/hooks/${hook}
---

본문.
`;

const SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Edit|Write",
        hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/path-ownership.mjs"' }],
      },
    ],
    SessionStart: [
      { hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/session-role.mjs"' }] },
    ],
  },
  worktree: { baseRef: "head" },
};

/** 배선이 전부 살아 있는 저장소. `edit` 으로 한 군데씩 망가뜨린다. */
function repo({ files = {}, drop = [], untrack = [], hooksPath = ".githooks" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "smoke-"));

  const base = {
    ".claude/settings.json": JSON.stringify(SETTINGS, null, 2),
    ".claude/CLAUDE.md": "@harness.md\n",
    ".claude/harness.md": "# 규약\n",
    ".claude/planner-mode.md": "# 지침\n",
    // 작업 세션이 시작할 때 물고 들어가는 문서. 추적되지 않으면 사본에서 사라진다.
    ".claude/planner/grilling.md": "# 논의 지침\n",
    // 라우팅 스킬. 훅과 층 1 의 안내가 이름으로 부르므로, 없으면 없는 곳을 가리킨다.
    ".claude/skills/harness-fix/SKILL.md": "# 하네스 수정\n",
    ".claude/skills/task/SKILL.md": "# 작업 세션으로 넘긴다\n",
    ".claude/agents/developer.md": agent("developer", "verify-green.mjs"),
    ".claude/agents/qa.md": agent("qa", "verify-checklist.mjs"),
    ".claude/hooks/path-ownership.mjs": PATH_OWNERSHIP,
    ".claude/hooks/session-role.mjs": SESSION_ROLE,
    ".claude/hooks/verify-green.mjs": "// 본체\n",
    ".claude/hooks/verify-checklist.mjs": "// 본체\n",
    ".githooks/pre-commit": '#!/bin/sh\nexec node "$(dirname "$0")/pre-commit.mjs"\n',
    ".githooks/pre-push": '#!/bin/sh\nexec node "$(dirname "$0")/pre-push.mjs"\n',
    ".githooks/pre-commit.mjs": "// 판정\n",
    ".githooks/pre-push.mjs": "// 판정\n",
    // `git worktree add` 가 새 사본 안에서 부른다. 사본에 하네스를 심을 자리라, 정작
    // 그 훅이 사본에 없으면 안 된다 — 그래서 여기도 생존 목록에 든다.
    ".githooks/post-checkout": '#!/bin/sh\nexec node "$(dirname "$0")/post-checkout.mjs" "$@"\n',
    ".githooks/post-checkout.mjs": "// 판정\n",
    // `posttest` 가 부르고 `pre-push` 가 그 기록을 읽는다. 이것도 사본에 있어야 한다.
    ".githooks/mark-verified.mjs": "// 기록\n",
    ".gitignore": ".claude/worktrees/\nnode_modules\n",
    "package.json": JSON.stringify(
      {
        name: "a",
        version: "1.0.0",
        type: "module",
        // 게이트가 부를 것과 그 결과를 적을 곳. 둘 다 있어야 설치본이 실제로 돈다.
        scripts: { test: "vitest run", posttest: "node .githooks/mark-verified.mjs" },
      },
      null,
      2,
    ),
  };

  const contents = { ...base, ...files };
  for (const path of drop) delete contents[path];

  for (const [path, text] of Object.entries(contents)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    // POSIX 에서 git 은 실행권한 없는 훅을 조용히 건너뛴다. 기본 644 로 두면 멀쩡한
    // 픽스처가 이 기계에서만 통과한다.
    if (path.startsWith(".githooks/") && !path.endsWith(".mjs")) chmodSync(full, 0o755);
  }

  const git = (args) =>
    execFileSync("git", args, { cwd: dir, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  git(["init", "-q", "-b", "work"]);
  git(["config", "user.email", "a@example.invalid"]);
  git(["config", "user.name", "a"]);
  git(["add", "-A"]);
  for (const path of untrack) git(["rm", "-q", "--cached", path]);
  // 훅을 붙이기 **전에** 커밋한다 — 픽스처의 stub 훅이 커밋을 판정하게 두지 않는다.
  git(["commit", "-qm", "init"]);
  git(["config", "core.hooksPath", hooksPath]);

  return { dir, git };
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return env;
}

/** 이름으로 하나 집는다. 문구가 아니라 **상태**를 본다. */
const find = (checks, needle) => checks.find((c) => c.name.includes(needle));
const dead = (checks) => checks.filter((c) => c.state === "broken").map((c) => c.name);

/**
 * 신뢰는 저장소 **밖**(`~/.claude.json`)에 있다. 디스크를 읽게 두면 이 파일의 판정이
 * 검사를 돌리는 기계의 개인 설정에 달리므로, 픽스처가 자기 트리를 신뢰하는 설정을 만들어
 * 넣는다. 신뢰 판정 자체는 아래 `신뢰` 절이 `trust` 를 직접 불러 덮는다.
 */
const look = (options, after) => {
  const { dir, git } = repo(options);
  try {
    after?.(dir, git);
    const root = mainRoot(dir, git);
    return inspect(dir, git, { trustConfig: { projects: { [root]: { hasTrustDialogAccepted: true } } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("smoke — 배선이 살아 있는가", () => {
  it("멀쩡한 트리에는 끊긴 배선이 없다", () => {
    expect(dead(look().checks)).toEqual([]);
  });

  describe("층 1", () => {
    it("배선이 없으면 끊긴 것이다", () => {
      const { checks } = look({
        files: { ".claude/settings.json": JSON.stringify({ worktree: { baseRef: "head" } }) },
      });

      expect(find(checks, "층 1").state).toBe("broken");
      expect(find(checks, "층 1").detail).toContain("배선이 없다");
    });

    it("matcher 가 한쪽 도구만 잡으면 끊긴 것이다", () => {
      // `Write` 가 빠지면 **새 파일 생성이 전부 통과한다** — 있는 파일만 지켜진다.
      const settings = structuredClone(SETTINGS);
      settings.hooks.PreToolUse[0].matcher = "Edit";
      const { checks } = look({ files: { ".claude/settings.json": JSON.stringify(settings) } });

      expect(find(checks, "층 1").state).toBe("broken");
      expect(find(checks, "층 1").detail).toContain("Write");
    });

    it("훅이 판정을 못 내면 끊긴 것이다", () => {
      // 설치본에서 shim 의 임포트가 깨지는 것이 정확히 이 모양으로 보인다.
      const { checks } = look({
        files: { ".claude/hooks/path-ownership.mjs": 'import "없는-패키지/hooks/x.mjs";\n' },
      });

      expect(find(checks, "층 1").state).toBe("broken");
      expect(find(checks, "층 1").detail).toContain("돌리지 못했다");
    });
  });

  describe("세션 훅", () => {
    it("`HARNESS_ROLE` 을 바꿔도 같은 문장이면 끊긴 것이다", () => {
      // 파일은 돌고 JSON 도 나온다. 그런데 역할이 안 갈리므로 **아무 구실도 못 한다.**
      const { checks } = look({
        files: {
          ".claude/hooks/session-role.mjs":
            'process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:"고정"}}));\n',
        },
      });

      expect(find(checks, "세션 훅").state).toBe("broken");
      expect(find(checks, "세션 훅").detail).toContain("역할이 갈리지 않는다");
    });
  });

  describe("종료 게이트", () => {
    it("`isolation` 이 빠지면 끊긴 것이다", () => {
      const { checks } = look({
        files: { ".claude/agents/developer.md": agent("developer", "verify-green.mjs").replace("isolation: worktree\n", "") },
      });

      expect(find(checks, "`developer`").state).toBe("broken");
      expect(find(checks, "`developer`").detail).toContain("isolation");
      expect(find(checks, "`qa`").state).toBe("ok"); // 하나가 깨져도 나머지는 따로 본다
    });

    it("`SubagentStop` 이 안 걸려 있으면 끊긴 것이다", () => {
      const { checks } = look({
        files: { ".claude/agents/qa.md": "---\nname: qa\nisolation: worktree\n---\n본문\n" },
      });

      expect(find(checks, "`qa`").state).toBe("broken");
      expect(find(checks, "`qa`").detail).toContain("verify-checklist.mjs");
    });

    it("shim 이 가리키는 패키지가 없으면 끊긴 것이다", () => {
      // **돌려보지 않고** 잡는다 — `verify-green` 은 게이트를 돌리고 커밋을 찍는다.
      const { checks } = look({
        files: { ".claude/hooks/verify-green.mjs": 'import "없는-패키지/hooks/verify-green.mjs";\n' },
      });

      expect(find(checks, "`developer`").state).toBe("broken");
      expect(find(checks, "`developer`").detail).toContain("해석되지 않는다");
    });
  });

  describe("신뢰", () => {
    // 경로는 실제 기록 철자를 흉내 낸다 — 구분자 `/`, 드라이브 문자 포함.
    const ROOT = "C:/Users/a/projects/x";
    const config = (projects) => ({ projects });
    const yes = { hasTrustDialogAccepted: true };
    const no = { hasTrustDialogAccepted: false };

    it("이 저장소 키가 신뢰돼 있으면 정상이다", () => {
      expect(trust(ROOT, config({ [ROOT]: yes })).state).toBe("ok");
    });

    it("조상만 신뢰돼 있으면 끊긴 것이다 — 다이얼로그가 안 떠서 스스로 낫지 않는다", () => {
      // **이 저장소에서 실제로 난 사고다.** 세션은 멀쩡히 돌고 층 1·2 도 붙는데,
      // 종료 훅만 등록되지 않아 회수할 커밋이 영영 안 생긴다.
      const check = trust(ROOT, config({ "C:/Users/a/projects": yes, [ROOT]: no }));

      expect(check.state).toBe("broken");
      expect(check.detail).toContain("C:/Users/a/projects");
      expect(check.detail).toContain("hasTrustDialogAccepted");
    });

    it("엔트리가 아예 없어도 조상이 신뢰돼 있으면 끊긴 것이다", () => {
      expect(trust(ROOT, config({ "C:/Users/a": yes })).state).toBe("broken");
    });

    it("조상도 신뢰돼 있지 않으면 모르는 것이다 — 열면 다이얼로그가 뜬다", () => {
      // 여기서 red 를 내면 **아직 한 번도 안 연 저장소가 전부 빨개진다.**
      expect(trust(ROOT, config({ [ROOT]: no })).state).toBe("unknown");
      expect(trust(ROOT, config({})).state).toBe("unknown");
    });

    it("철자만 다른 키가 신뢰돼 있으면 끊긴 것이다 — 조회는 정확히 일치할 때만 성립한다", () => {
      const check = trust(ROOT, config({ "c:/users/a/projects/x": yes }));

      expect(check.state).toBe("broken");
      expect(check.detail).toContain("철자");
    });

    it("설정을 못 읽으면 모르는 것이다", () => {
      expect(trust(ROOT, null).state).toBe("unknown");
    });

    it("worktree 사본 안에서 물어도 본체 루트가 나온다", () => {
      // 신뢰 키는 본체 하나뿐이다. 사본 경로로 물으면 영원히 `false` 로 보인다.
      const { dir, git } = repo();
      try {
        const copy = join(dir, ".claude", "worktrees", "w");
        git(["worktree", "add", "-q", "-b", "w", copy]);
        const inCopy = (args) =>
          execFileSync("git", args, { cwd: copy, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

        expect(mainRoot(copy, inCopy)).toBe(mainRoot(dir, git));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("층 2", () => {
    it("`core.hooksPath` 가 없으면 끊긴 것이다", () => {
      // `.githooks/` 는 그냥 파일이 든 디렉터리가 된다.
      const { checks } = look({ hooksPath: "" });

      expect(find(checks, "층 2").state).toBe("broken");
    });

    it("남의 훅 디렉터리를 가리키면 끊긴 것이다", () => {
      const { checks } = look({ hooksPath: ".husky" });

      expect(find(checks, "층 2").state).toBe("broken");
      expect(find(checks, "층 2").detail).toContain(".husky");
    });

    it("절대경로도 같은 곳을 가리키면 정상이다", () => {
      // 이 저장소가 그렇게 쓴다 — 링크된 worktree 에서 커밋해도 본체의 훅이 불린다.
      const { dir, git } = repo();
      try {
        git(["config", "core.hooksPath", join(dir, ".githooks")]);

        expect(find(inspect(dir, git).checks, "층 2").state).not.toBe("broken");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("판정 모듈이 깨져 있으면 끊긴 것이다", () => {
      const { checks } = look({ files: { ".githooks/pre-push.mjs": 'import "없는-패키지/githooks/pre-push.mjs";\n' } });

      expect(find(checks, "층 2").state).toBe("broken");
      expect(find(checks, "층 2").detail).toContain("pre-push.mjs");
    });
  });

  describe("나머지 불변식", () => {
    it("`baseRef` 가 `head` 가 아니면 회수가 깨진다", () => {
      const settings = structuredClone(SETTINGS);
      settings.worktree.baseRef = "main";

      expect(find(look({ files: { ".claude/settings.json": JSON.stringify(settings) } }).checks, "회수").state).toBe(
        "broken",
      );
    });

    it("`@harness.md` 가 없으면 규약이 안 실린다", () => {
      const { checks } = look({ files: { ".claude/CLAUDE.md": "# A 의 규약\n" } });

      expect(find(checks, "규약").state).toBe("broken");
    });

    it("`.gitignore` 에 사본 경로가 없으면 커밋이 사본을 쓸어 담는다", () => {
      const { checks } = look({ files: { ".gitignore": "node_modules\n" } });

      expect(find(checks, "사본이 커밋에").state).toBe("broken");
    });

    it("게이트가 부르는 스크립트가 없으면 `developer` 가 끝날 방법이 없다", () => {
      // **설치 직후의 프로젝트가 정확히 이 모양이다** — `init` 은 러너를 깔지 않는다.
      // 배선은 전부 멀쩡한데 돌릴 것이 없다.
      const { checks } = look({
        files: {
          "package.json": JSON.stringify({ name: "a", scripts: { posttest: "node .githooks/mark-verified.mjs" } }),
        },
      });
      const check = find(checks, "돌릴 것이 있다");

      expect(check.state).toBe("broken");
      expect(check.detail).toContain("scripts.test");
    });

    it("`npm run <이름>` 게이트도 그 스크립트를 따라간다", () => {
      const { checks } = look({
        files: {
          "harness.config.json": JSON.stringify({ gate: "npm run verify" }),
          "package.json": JSON.stringify({
            name: "a",
            scripts: { verify: "node --test", posttest: "node .githooks/mark-verified.mjs" },
          }),
        },
      });

      expect(find(checks, "돌릴 것이 있다").state).toBe("ok");
    });

    it("npm 이 아닌 게이트는 판정하지 않는다 — 없는 것과 모르는 것은 다르다", () => {
      // 여기서 red 를 내면 make·just 를 쓰는 멀쩡한 프로젝트가 전부 빨개진다.
      const { checks } = look({ files: { "harness.config.json": JSON.stringify({ gate: "make check" }) } });

      expect(find(checks, "돌릴 것이 있다").state).toBe("unknown");
    });


    it("`.claude` 를 통째로 무시해도 사본 무시 판정은 초록이다", () => {
      // 글자로 `.claude/worktrees/` 줄을 찾던 시절에는 여기서 거짓 ✗ 가 났다.
      // 무시되는지는 git 에게 물으면 정확히 답한다.
      const { checks } = look({ files: { ".gitignore": ".claude\nnode_modules\n" } });

      expect(find(checks, "사본이 커밋에 쓸려").state).toBe("ok");
    });
  });

  /**
   * 사본에 도달하는 길이 둘이다 — 커밋되어 있거나, `post-checkout` 이 심어 주거나.
   *
   * **심기를 끄는 방법으로 `core.hooksPath` 를 남의 곳으로 돌린다.** 훅 파일을 지우면
   * 그것 자체가 `managedPaths()` 의 결손이 되어 다른 이유로도 빨개지므로, 재려는 것 하나만
   * 남기려면 배선 쪽을 끊어야 한다.
   */
  describe("사본에 도달하는가", () => {
    const NO_PLANTING = { hooksPath: ".husky/_" };

    it("심기가 없으면 추적되지 않는 파일은 사본에서 사라진다", () => {
      // 파일은 디스크에 있다. 그래서 **여기서는 멀쩡해 보이고 사본에서만 없다.**
      const { checks } = look({ ...NO_PLANTING, untrack: [".claude/agents/qa.md"] });
      const check = find(checks, "worktree 안에서도");

      expect(check.state).toBe("broken");
      expect(check.detail).toContain("qa.md");
    });

    it("심기가 없으면 스테이징만 한 것도 초록이 아니다 — 사본은 커밋된 것만 받는다", () => {
      // 이 판정의 이전 버전은 `git ls-files`(인덱스)를 봐서 여기서 **초록을 냈다.**
      // 그동안 사본에는 아무것도 없었고, smoke 가 존재하는 이유가 정확히 그 실패였다.
      const { checks } = look({ ...NO_PLANTING, untrack: [".claude/agents/qa.md"] }, (dir, git) => {
        git(["add", "-f", "--", ".claude/agents/qa.md"]);
      });
      const check = find(checks, "worktree 안에서도");

      expect(check.state).toBe("broken");
      expect(check.detail).toContain("커밋해야");
    });

    it("심기가 없으면 무시되는 것이 결함이고, 그 사실을 말해 준다", () => {
      const { checks } = look({ ...NO_PLANTING, files: { ".gitignore": ".claude\nnode_modules\n" } });
      const check = find(checks, "worktree 안에서도");

      expect(check.state).toBe("broken");
      expect(check.detail).toContain("심기가 배선돼 있지 않다");
    });

    it("**심기가 있으면 무시돼도 초록이다** — 커밋 없이도 사본이 하네스를 갖는다", () => {
      // 이 한 줄이 이 task 의 목적이다. 예전에는 이 상태가 **항상 빨간불**이라
      // 아무 정보도 아니었고, 그래서 설치기가 `git add -f` 로 뚫었다.
      const { checks } = look({ files: { ".gitignore": ".claude\nnode_modules\n" } });
      const check = find(checks, "worktree 안에서도");

      expect(check.state).toBe("ok");
      expect(check.detail).toContain("post-checkout");
    });

    it("심기가 있어도 파일 자체가 없으면 도달하지 못한다", () => {
      // 심기는 본체의 워킹트리에서 복사한다 — **없는 것은 못 데려간다.**
      const { checks } = look({ drop: [".claude/agents/qa.md"] });
      const check = find(checks, "worktree 안에서도");

      expect(check.state).toBe("broken");
      expect(check.detail).toContain("qa.md");
    });

    it("`core.hooksPath` 가 남의 곳이면 훅이 있어도 심기로 안 쳐준다", () => {
      // 파일은 있는데 안 불린다. 존재만 보면 **조용한 초록**이 된다.
      const { dir, git } = repo({ hooksPath: ".husky/_" });
      try {
        expect(plantingWired(dir, git).ok).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("훅이 서 있으면 심는다고 판정한다", () => {
      const { dir, git } = repo();
      try {
        expect(plantingWired(dir, git).ok).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("게이트가 사본을 다시 세지 않는가", () => {
    const EXCLUDED = 'export default { test: { exclude: ["**/.claude/worktrees/**"] } };\n';

    it("러너가 사본을 제외하면 초록이다", () => {
      const { checks } = look({ files: { "vitest.config.mjs": EXCLUDED } });

      expect(find(checks, "다시 세지 않는다").state).toBe("ok");
    });

    it("아는 러너 설정에 제외가 없으면 끊긴 것이다", () => {
      // 사본의 테스트가 부모 실행에 다시 잡힌다(이 저장소 실측 172 → 344). 그리고 red 로
      // 끝난 사본이 남아 있으면 **내 트리에 원인이 없는 실패**를 게이트가 주워온다.
      const { checks } = look({ files: { "vitest.config.mjs": "export default {};\n" } });
      const check = find(checks, "다시 세지 않는다");

      expect(check.state).toBe("broken");
      expect(check.detail).toContain(".claude/worktrees");
    });

    it("`package.json` 의 jest 설정도 본다", () => {
      const { checks } = look({
        files: {
          "package.json": JSON.stringify({
            name: "a",
            scripts: { test: "jest", posttest: "node .githooks/mark-verified.mjs" },
            jest: { testPathIgnorePatterns: ["/node_modules/", "/\\.claude/worktrees/"] },
          }),
        },
      });

      expect(find(checks, "다시 세지 않는다").state).toBe("ok");
    });

    it("모르는 러너면 판정하지 않는다 — 조용한 초록보다 낫다", () => {
      // 러너 설정은 프로젝트마다 파일도 형식도 다르다. 못 쟀으면 못 쟀다고 말한다.
      expect(find(look().checks, "다시 세지 않는다").state).toBe("unknown");
    });
  });

  describe("보고", () => {
    const swallow = () => {};

    it("끊긴 배선이 있으면 1 이다", () => {
      expect(report({ checks: [{ name: "x", state: "broken", detail: "" }] }, swallow)).toBe(1);
    });

    it("모르는 것만 있으면 0 이다 — 막지 않는다", () => {
      expect(report({ checks: [{ name: "x", state: "unknown", detail: "" }] }, swallow)).toBe(0);
    });

    it("사람이 볼 것을 항상 같이 찍는다", () => {
      // 자동 검사가 전부 통과해도 **증명되지 않은 것이 남는다.** 그 목록이 안 보이면
      // 초록만 보고 끝났다고 믿게 된다.
      let out = "";
      report({ checks: [] }, (s) => (out += s));

      expect(out).toContain("세션에서 사람이 본다");
      for (const probe of PROBES) expect(out).toContain(probe.name);
    });
  });

  it("각 probe 는 붙여 넣을 명령과 통과 기준을 둘 다 갖는다", () => {
    // 기준이 없는 항목은 아무도 안 돌린다 — "확인한다" 로 끝나면 확인되지 않는다.
    for (const probe of PROBES) {
      expect(probe.command.trim(), probe.name).not.toBe("");
      expect(probe.expect.trim(), probe.name).not.toBe("");
    }
  });
});

/**
 * 층 2 와 `init` 이 **같은 식**을 쓰게 하려고 밖으로 낸 판정. 파일을 만들지 않는다 —
 * 실재 여부를 묻지 않는 것이 이 함수의 계약이라, 디스크가 필요 없는 것 자체가 검증이다.
 */
describe("`pointsAtGithooks`", () => {
  const tree = process.platform === "win32" ? "C:\\repo" : "/repo";

  it.each([".githooks", "./.githooks", ".githooks/", join(tree, ".githooks")])("`%s` 는 우리 자리다", (value) => {
    expect(pointsAtGithooks(tree, value)).toBe(true);
  });

  it.each([".husky/_", ".husky", "hooks", join(tree, ".husky", "_")])("`%s` 는 남의 자리다", (value) => {
    expect(pointsAtGithooks(tree, value)).toBe(false);
  });

  it("빈 값은 아무 곳도 가리키지 않는다", () => {
    expect(pointsAtGithooks(tree, "")).toBe(false);
  });
});
