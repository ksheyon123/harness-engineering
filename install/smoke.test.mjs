import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { PROBES, inspect, mainRoot, report, trust } from "./smoke.mjs";

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
const look = (options) => {
  const { dir, git } = repo(options);
  try {
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

    it("`posttest` 가 없으면 push 가 전부 막힌다", () => {
      const { checks } = look({
        files: { "package.json": JSON.stringify({ name: "a", version: "1.0.0" }) },
      });

      expect(find(checks, "게이트 기록").state).toBe("broken");
    });

    it("추적되지 않는 파일은 worktree 사본에서 사라진다", () => {
      // 파일은 디스크에 있다. 그래서 **여기서는 멀쩡해 보이고 사본에서만 없다.**
      const { checks } = look({ untrack: [".claude/agents/qa.md"] });
      const check = find(checks, "worktree 안에서도");

      expect(check.state).toBe("broken");
      expect(check.detail).toContain("qa.md");
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
