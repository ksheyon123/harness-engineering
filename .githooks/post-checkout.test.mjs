import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HOOKS, "post-checkout.mjs");

/**
 * 상속된 `GIT_*` 를 씻는다. `GIT_DIR` 이 남아 있으면 임시 저장소를 겨냥한 것처럼 보이는
 * `git init` 이 **진짜 저장소를 초기화한다** — 이 파일은 worktree 를 만드는 테스트라
 * 특히 그렇다.
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

/** 훅이 붙은 저장소. 커밋 하나를 심어 둔다 — worktree 는 `HEAD` 가 있어야 만들어진다. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "post-checkout-"));
  fixtures.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "hook@example.invalid"]);
  git(dir, ["config", "user.name", "hook"]);
  // 절대경로다. 사본 안에서 불려도 **본체의 훅**이 잡혀야 한다.
  git(dir, ["config", "core.hooksPath", HOOKS]);

  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "seed"]);
  return dir;
}

const tracePath = (dir) => join(dir, ".claude", "post-checkout-trace.log");

function traceLines(dir) {
  const path = tracePath(dir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean);
}

/** 훅을 git 없이 직접 부른다 — 인자 판정만 따로 보기 위해서다. */
function runHook(cwd, args) {
  const result = spawnSync(process.execPath, [HOOK, ...args], {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

const ZERO40 = "0".repeat(40);

describe("post-checkout — 발동 흔적", () => {
  it("새 사본이 만들어지면 흔적을 남긴다", () => {
    const dir = makeRepo();
    const copy = join(dir, "copy");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    const lines = traceLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("post-checkout");
  });

  it("흔적 한 줄에 cwd · toplevel · 본체 경로가 들어 있다", () => {
    const dir = makeRepo();
    const copy = join(dir, "copy");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    const [line] = traceLines(dir);
    const field = (key) => /** @type {string} */ (line.split("\t").find((f) => f.startsWith(`${key}=`)))?.slice(key.length + 1);

    // 셋 다 실제 경로여야 한다. 빈 값이면 훅이 돌긴 했지만 **사본을 못 읽은 것**이고,
    // 그 상태로 심기를 얹으면 어디에 심을지를 모른 채 성공을 반환하게 된다.
    const real = (path) => path && existsSync(path);

    expect(real(field("cwd"))).toBe(true);
    expect(real(field("toplevel"))).toBe(true);
    expect(real(field("main"))).toBe(true);

    // cwd 와 toplevel 은 **사본**을, main 은 **본체**를 가리킨다. 이 구분이 무너지면
    // 심기가 자기 자신을 복사하게 된다.
    expect(same(field("cwd"), copy)).toBe(true);
    expect(same(field("toplevel"), copy)).toBe(true);
    expect(same(field("main"), dir)).toBe(true);
  });

  it("평범한 브랜치 전환에서는 아무것도 남기지 않는다", () => {
    const dir = makeRepo();
    git(dir, ["branch", "other"]);

    git(dir, ["checkout", "-q", "other"]);
    git(dir, ["checkout", "-q", "main"]);

    expect(existsSync(tracePath(dir))).toBe(false);
  });

  it("old-ref 가 실제 sha 이면 파일을 만들지 않고 0 으로 끝난다", () => {
    const dir = makeRepo();
    const head = git(dir, ["rev-parse", "HEAD"]).trim();

    const { status } = runHook(dir, [head, head, "1"]);

    expect(status).toBe(0);
    expect(existsSync(tracePath(dir))).toBe(false);
  });

  it("old-ref 가 전부 0 이면 흔적을 남기고 0 으로 끝난다", () => {
    const dir = makeRepo();
    const head = git(dir, ["rev-parse", "HEAD"]).trim();

    const { status } = runHook(dir, [ZERO40, head, "1"]);

    expect(status).toBe(0);
    expect(traceLines(dir)).toHaveLength(1);
  });

  it("사본이 여럿이면 줄도 여럿이고 서로 다른 cwd 를 가리킨다", () => {
    const dir = makeRepo();

    git(dir, ["worktree", "add", "-q", "-b", "one", join(dir, "one")]);
    git(dir, ["worktree", "add", "-q", "-b", "two", join(dir, "two")]);

    const cwds = traceLines(dir).map((line) => line.split("\t")[1]);
    expect(cwds).toHaveLength(2);
    expect(new Set(cwds).size).toBe(2);
  });
});

/** 경로 비교 — 구분자와 (Windows 면) 대소문자를 맞춘다. */
function same(a, b) {
  const norm = (p) => {
    const unified = `${p}`.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? unified.toLowerCase() : unified;
  };
  return norm(a) === norm(b);
}
