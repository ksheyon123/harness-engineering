import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const MARK = join(HOOKS, "mark-verified.mjs");

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

/** 훅이 붙은 저장소 + 그것이 밀어 넣을 bare 원격. */
function makeRepoWithRemote() {
  const remote = mkdtempSync(join(tmpdir(), "pre-push-remote-"));
  fixtures.push(remote);
  git(remote, ["init", "-q", "--bare"]);

  const dir = mkdtempSync(join(tmpdir(), "pre-push-"));
  fixtures.push(dir);
  git(dir, ["init", "-q", "-b", "work"]);
  git(dir, ["config", "user.email", "hook@example.invalid"]);
  git(dir, ["config", "user.name", "hook"]);
  git(dir, ["config", "core.hooksPath", HOOKS]);
  git(dir, ["remote", "add", "origin", remote]);

  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "seed"]);
  return dir;
}

/** 게이트가 green 이었던 것처럼 기록한다 — npm 의 posttest 가 하는 일과 같다. */
function markVerified(dir) {
  execFileSync(process.execPath, [MARK], { cwd: dir, env: cleanEnv(), stdio: "ignore" });
}

function push(dir, args = ["origin", "work"]) {
  const result = spawnSync("git", ["push", ...args], {
    cwd: dir,
    env: cleanEnv(),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

function markerPath(dir) {
  return join(git(dir, ["rev-parse", "--absolute-git-dir"]).trim(), "harness-verified");
}

describe("pre-push — verified marker", () => {
  it("게이트 기록이 없으면 막는다", () => {
    const dir = makeRepoWithRemote();

    const { status, stderr } = push(dir);

    expect(status).not.toBe(0);
    expect(stderr).toContain("게이트를 통과한 기록이 없는 커밋");
  });

  it("그 커밋에서 게이트가 통과했으면 올라간다", () => {
    const dir = makeRepoWithRemote();
    markVerified(dir);

    expect(push(dir).status).toBe(0);
  });

  it("기록 이후에 커밋이 더 얹히면 다시 막는다", () => {
    // 커밋 전에 돌린 green 은 그 커밋의 것이 아니다. 회수·QA 로 트리가 더 움직인 뒤라면
    // 더욱 그렇다 — 이 훅이 강제하는 것이 정확히 그 순서다.
    const dir = makeRepoWithRemote();
    markVerified(dir);
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--no-verify", "-m", "그 뒤의 변경"]);

    expect(push(dir).status).not.toBe(0);
  });

  it("브랜치 삭제는 판정하지 않는다", () => {
    // 올릴 커밋이 없다. 여기서 막으면 정리조차 못 한다.
    const dir = makeRepoWithRemote();
    markVerified(dir);
    push(dir);
    git(dir, ["switch", "-q", "-c", "other"]);

    expect(push(dir, ["origin", "--delete", "work"]).status).toBe(0);
  });

  it("--no-verify 로 지나갈 수 있다", () => {
    const dir = makeRepoWithRemote();

    expect(push(dir, ["--no-verify", "origin", "work"]).status).toBe(0);
  });
});

describe("mark-verified — 게이트 결과 기록", () => {
  it("HEAD 를 기록한다", () => {
    const dir = makeRepoWithRemote();
    markVerified(dir);

    const head = git(dir, ["rev-parse", "HEAD"]).trim();
    expect(readFileSync(markerPath(dir), "utf8")).toContain(head);
  });

  it("같은 sha 를 두 번 적지 않는다", () => {
    const dir = makeRepoWithRemote();
    markVerified(dir);
    markVerified(dir);

    const lines = readFileSync(markerPath(dir), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("이전 기록을 지우지 않는다", () => {
    // amend·rebase 로 sha 가 갈린다. 하나만 두면 금세 어긋나 정당한 push 가 막힌다.
    const dir = makeRepoWithRemote();
    markVerified(dir);
    const first = git(dir, ["rev-parse", "HEAD"]).trim();

    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--no-verify", "-m", "다음"]);
    markVerified(dir);

    const marker = readFileSync(markerPath(dir), "utf8");
    expect(marker).toContain(first);
    expect(marker).toContain(git(dir, ["rev-parse", "HEAD"]).trim());
  });

  it("git 저장소가 아니면 조용히 지나간다", () => {
    // posttest 는 게이트 뒤에 붙는다. 여기서 실패하면 green 이 red 로 보인다.
    const dir = mkdtempSync(join(tmpdir(), "pre-push-nogit-"));
    fixtures.push(dir);

    const result = spawnSync(process.execPath, [MARK], { cwd: dir, env: cleanEnv() });
    expect(result.status).toBe(0);
  });
});
