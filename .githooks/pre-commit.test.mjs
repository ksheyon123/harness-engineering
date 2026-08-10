import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/** 임시 저장소가 가리킬 훅 디렉터리. 이 저장소의 것을 그대로 쓴다. */
const HOOKS = dirname(fileURLToPath(import.meta.url));

const SPEC = `---
branch: feat/thing
---

# thing

## 기능 목록

### 기능: 교환
- **인수기준**: 동일 code 로 2회 진입해도 POST 는 1회
`;

/**
 * `GIT_` 접두어를 지운 env. 이 파일은 픽스처에 `git init` 을 하므로, 부모에게서
 * `GIT_DIR` 을 물려받으면 임시 디렉터리가 아니라 이 저장소를 초기화한다.
 */
function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  return env;
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

/** 훅이 붙은 임시 저장소. */
function makeRepo(branch = "work") {
  const dir = mkdtempSync(join(tmpdir(), "pre-commit-"));
  fixtures.push(dir);
  git(dir, ["init", "-q", "-b", branch]);
  git(dir, ["config", "user.email", "hook@example.invalid"]);
  git(dir, ["config", "user.name", "hook"]);
  git(dir, ["config", "core.hooksPath", HOOKS]);
  return dir;
}

function write(dir, relPath, body) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** 커밋을 시도한다. 훅이 막으면 status 가 0 이 아니고 stderr 에 이유가 실린다. */
function commit(dir, message = "wip", extra = []) {
  const result = spawnSync("git", ["commit", ...extra, "-m", message], {
    cwd: dir,
    env: cleanEnv(),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

describe("pre-commit — 층 2 불변식", () => {
  it("전부 스테이징했으면 통과한다", () => {
    const dir = makeRepo();
    write(dir, "a.txt", "a\n");
    git(dir, ["add", "-A"]);

    expect(commit(dir).status).toBe(0);
  });

  it("추적되지 않은 파일이 남아 있으면 막는다", () => {
    // 검사한 트리와 커밋되는 내용이 어긋나면 검사가 무의미해진다.
    const dir = makeRepo();
    write(dir, "a.txt", "a\n");
    git(dir, ["add", "-A"]);
    write(dir, "stray.txt", "잊힌 파일\n");

    const { status, stderr } = commit(dir);

    expect(status).not.toBe(0);
    expect(stderr).toContain("부분 스테이징");
    expect(stderr).toContain("stray.txt");
  });

  it("새로 생긴 디렉터리 안의 파일도 찾아낸다", () => {
    // -uall 이 없으면 `?? harness/` 한 줄만 보이고 그 안의 파일은 목록에 없다.
    const dir = makeRepo();
    write(dir, "a.txt", "a\n");
    git(dir, ["add", "-A"]);
    write(dir, "brand/new/deep.txt", "x\n");

    expect(commit(dir).stderr).toContain("brand/new/deep.txt");
  });

  it("스테이징되지 않은 수정이 있으면 막는다", () => {
    const dir = makeRepo();
    write(dir, "a.txt", "a\n");
    git(dir, ["add", "-A"]);
    commit(dir, "seed");
    write(dir, "a.txt", "staged\n");
    git(dir, ["add", "-A"]);
    write(dir, "a.txt", "그 뒤에 또 고쳤다\n");

    const { status, stderr } = commit(dir);

    expect(status).not.toBe(0);
    expect(stderr).toContain("수정이 스테이징되지 않음");
  });

  it("main 에 직접 커밋하면 막는다", () => {
    const dir = makeRepo("main");
    write(dir, "a.txt", "a\n");
    git(dir, ["add", "-A"]);

    const { status, stderr } = commit(dir);

    expect(status).not.toBe(0);
    expect(stderr).toContain("`main` 에 직접 커밋");
  });

  it("충돌을 푼 뒤의 머지 커밋은 main 에서도 통과한다", () => {
    // 사람이 PR 을 머지하는 정당한 경로다. 충돌이 없으면 pre-merge-commit 이 받지만,
    // 충돌을 손으로 풀면 그 커밋이 여기로 온다.
    // 셋업 커밋은 --no-verify 로 만든다. main 에 직접 커밋하는 것은 훅이 막는 바로
    // 그 동작이라, 여기서 정직하게 커밋하면 셋업 자체가 성립하지 않는다.
    const dir = makeRepo("main");
    const seed = (msg) => commit(dir, msg, ["--no-verify"]);

    write(dir, "a.txt", "base\n");
    git(dir, ["add", "-A"]);
    seed("seed");

    git(dir, ["switch", "-q", "-c", "side"]);
    write(dir, "a.txt", "side\n");
    git(dir, ["add", "-A"]);
    seed("side");

    git(dir, ["switch", "-q", "main"]);
    write(dir, "a.txt", "main\n");
    git(dir, ["add", "-A"]);
    seed("main");

    spawnSync("git", ["merge", "side"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    write(dir, "a.txt", "resolved\n");
    git(dir, ["add", "-A"]);

    expect(commit(dir, "merge: 충돌 해소").status).toBe(0);
  });

  it("온전한 spec 은 통과한다", () => {
    const dir = makeRepo();
    write(dir, "harness/thing/spec.md", SPEC);
    git(dir, ["add", "-A"]);

    expect(commit(dir).status).toBe(0);
  });

  it("깨진 spec 을 막는다", () => {
    const dir = makeRepo();
    write(dir, "harness/thing/spec.md", "# 형식이 없다\n");
    git(dir, ["add", "-A"]);

    const { status, stderr } = commit(dir);

    expect(status).not.toBe(0);
    expect(stderr).toContain("frontmatter 가 없다");
    expect(stderr).toContain("`## 기능 목록` 절이 없다");
  });

  it("harness 아래여도 spec.md 가 아니면 형식을 보지 않는다", () => {
    // qa-checklist.md 는 verify-checklist 가 본다. 여기서 또 보면 규칙이 둘로 갈린다.
    const dir = makeRepo();
    write(dir, "harness/thing/qa-checklist.md", "형식 없는 메모\n");
    git(dir, ["add", "-A"]);

    expect(commit(dir).status).toBe(0);
  });

  it("spec 을 지우는 커밋은 형식을 보지 않는다", () => {
    const dir = makeRepo();
    write(dir, "harness/thing/spec.md", SPEC);
    git(dir, ["add", "-A"]);
    commit(dir, "spec");
    rmSync(join(dir, "harness/thing/spec.md"));
    git(dir, ["add", "-A"]);

    expect(commit(dir, "spec 철회").status).toBe(0);
  });

  it("--no-verify 로 지나갈 수 있다", () => {
    // 정당하게 못 지키는 상황이 있다. 다만 그 사실이 명령에 보이게 남는다.
    const dir = makeRepo("main");
    write(dir, "a.txt", "a\n");
    git(dir, ["add", "-A"]);
    write(dir, "stray.txt", "x\n");

    expect(commit(dir, "우회", ["--no-verify"]).status).toBe(0);
  });
});
