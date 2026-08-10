import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./verify-checklist.mjs", import.meta.url));
const COUNTER = "harness-verify-checklist-attempts";

const HEADER = `| 기능 | 인수기준 | 판정 | 근거 | 사람이 시킬 일 |
|---|---|:---:|---|---|`;

function checklist(rows) {
  return `---
generated: 2026-08-10
spec: harness/thing/spec.md
---

# QA 커버리지 체크리스트 — thing

## 커버리지 매트릭스

${HEADER}
${rows.join("\n")}
`;
}

const COVERED = `| 교환 | 2회 진입해도 POST 1회 | ✅ | \`auth.test.ts > "중복 진입"\` | — |`;

function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  return { ...env, ...extra };
}

const fixtures = [];

afterEach(() => {
  while (fixtures.length) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "verify-checklist-"));
  fixtures.push(dir);
  git(dir, ["init", "-q"]);
  // 인계 커밋이 서명할 신원. 없으면 커밋이 실패해 훅의 성공 경로가 통째로 달라진다.
  git(dir, ["config", "user.email", "hook@example.invalid"]);
  git(dir, ["config", "user.name", "hook"]);
  return dir;
}

function write(dir, relPath, body) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function gitDirOf(cwd) {
  return git(cwd, ["rev-parse", "--absolute-git-dir"]).trim();
}

function runHook(cwd, { input = {} } = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: cleanEnv(),
  });
  const stdout = result.stdout ?? "";
  return {
    status: result.status,
    stdout,
    verdict: stdout.trim() ? JSON.parse(stdout) : null,
  };
}

describe("verify-checklist — qa 의 SubagentStop 훅", () => {
  it("근거가 붙은 체크리스트를 남기면 종료가 허용된다", () => {
    const dir = makeRepo();
    write(dir, "harness/thing/qa-checklist.md", checklist([COVERED]));

    const { status, stdout } = runHook(dir);

    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("아무것도 쓰지 않았으면 block 하고, 그래도 종료 코드는 0 이다", () => {
    const { status, verdict } = runHook(makeRepo());

    expect(status).toBe(0);
    expect(verdict.decision).toBe("block");
    expect(verdict.reason).toContain("qa-checklist.md` 가 없다");
  });

  it("근거 없는 ✅ 를 잡는다", () => {
    // 이 표에서 가장 위험한 출력. 초록 행은 사람이 다시 보지 않으므로
    // 잘못된 통과는 소음이 아니라 침묵이 된다.
    const dir = makeRepo();
    write(
      dir,
      "harness/thing/qa-checklist.md",
      checklist([`| 교환 | 2회 진입해도 POST 1회 | ✅ | — | — |`]),
    );

    expect(runHook(dir).verdict.reason).toContain("근거 없이 판정한 행이 1개");
  });

  it("근거 없는 △ 도 잡는다", () => {
    const dir = makeRepo();
    write(
      dir,
      "harness/thing/qa-checklist.md",
      checklist([`| 교환 | 만료 code 는 400 | △ |  | 엣지 추가 |`]),
    );

    expect(runHook(dir).verdict.reason).toContain("근거 없이 판정한 행이 1개");
  });

  it("`❌ (구현 있음)` 은 구현 위치를 대야 한다", () => {
    const dir = makeRepo();
    write(
      dir,
      "harness/thing/qa-checklist.md",
      checklist([`| 교환 | 실패 시 세션 없음 | ❌ (구현 있음) | — | 테스트 추가 |`]),
    );

    expect(runHook(dir).verdict.reason).toContain("근거 없이 판정한 행이 1개");
  });

  it("순수 ❌ 는 근거가 없어도 된다 — 없다는 주장에는 인용할 것이 없다", () => {
    const dir = makeRepo();
    write(
      dir,
      "harness/thing/qa-checklist.md",
      checklist([`| 교환 | 동시 요청 1건만 성공 | ❌ (구현 없음) | — | spec 미이행 |`]),
    );

    expect(runHook(dir).verdict).toBeNull();
  });

  it("표 헤더를 알아보지 못하면 근거 검사를 건너뛴다", () => {
    // 형식을 못 알아본 것과 위반을 찾은 것은 다르다. 전자로 막으면 표 모양을
    // 조금 바꿨다는 이유로 qa 가 갇힌다.
    const dir = makeRepo();
    write(
      dir,
      "harness/thing/qa-checklist.md",
      `---
spec: harness/thing/spec.md
---

| 항목 | 판정 |
|---|:---:|
| 교환 | ✅ |
`,
    );

    expect(runHook(dir).verdict).toBeNull();
  });

  it("커버리지 매트릭스가 없으면 block 한다", () => {
    const dir = makeRepo();
    write(
      dir,
      "harness/thing/qa-checklist.md",
      "---\nspec: harness/thing/spec.md\n---\n\n# 표가 없다\n",
    );

    expect(runHook(dir).verdict.reason).toContain("커버리지 매트릭스가 없다");
  });

  it("frontmatter 에 spec 이 없으면 block 한다", () => {
    const dir = makeRepo();
    write(
      dir,
      "harness/thing/qa-checklist.md",
      checklist([COVERED]).replace("spec: harness/thing/spec.md", "task: thing"),
    );

    expect(runHook(dir).verdict.reason).toContain("spec: harness/<task>/spec.md` 가 없다");
  });

  it("새로 생긴 디렉터리 안의 체크리스트도 찾아낸다", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "README.md"), "seed\n");
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
    write(dir, "harness/brand-new/qa-checklist.md", checklist([COVERED]));

    expect(runHook(dir).verdict).toBeNull();
  });

  it("상한을 넘으면 차단을 푼다 — 대조할 spec 이 없는 경우가 있다", () => {
    const dir = makeRepo();

    expect(runHook(dir).verdict.decision).toBe("block");

    const released = runHook(dir).verdict;
    expect(released.decision).toBeUndefined();
    expect(released.systemMessage).toContain("체크리스트 없이 종료를 허용했다");
  });

  it("통과하면 카운터를 지운다", () => {
    const dir = makeRepo();
    runHook(dir);
    const counter = join(gitDirOf(dir), COUNTER);
    expect(existsSync(counter)).toBe(true);

    write(dir, "harness/thing/qa-checklist.md", checklist([COVERED]));
    runHook(dir);

    expect(existsSync(counter)).toBe(false);
  });

  it("git 을 쓸 수 없으면 판정하지 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-checklist-nogit-"));
    fixtures.push(dir);

    expect(runHook(dir).verdict).toBeNull();
  });

  it("통과한 체크리스트를 인계 커밋으로 남긴다", () => {
    const dir = makeRepo();
    write(dir, "harness/thing/qa-checklist.md", checklist([COVERED]));

    runHook(dir);

    // qa 에도 Bash 가 없다. 이 지점을 놓치면 표가 worktree 와 함께 사라지고,
    // 사람이 PR 에서 볼 근거가 없어진다.
    expect(git(dir, ["log", "--format=%s"])).toContain(
      "chore(qa): 산출물을 인계 커밋으로 남긴다",
    );
    expect(git(dir, ["ls-files"])).toContain("harness/thing/qa-checklist.md");
  });

  it("표가 없어 상한이 소진되면 인계할 산출물이 없음을 함께 알린다", () => {
    const dir = makeRepo();
    runHook(dir);

    const released = runHook(dir).verdict;

    expect(released.systemMessage).toContain("체크리스트 없이 종료를 허용했다");
    expect(released.systemMessage).toContain("인계할 산출물이 없다");
  });
});
