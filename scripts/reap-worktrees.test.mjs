import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { plan, reap } from "./reap-worktrees.mjs";

const HOOK = fileURLToPath(new URL("./reap-worktrees.mjs", import.meta.url));

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

function gitIn(cwd) {
  return (args) =>
    execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * 본체 + `.claude/worktrees/` 를 갖춘 저장소.
 *
 * 실물과 같은 경로 모양을 쓴다 — 판정이 디렉터리 이름(`worktrees/agent-<hex>`)에
 * 걸려 있어서, 경로를 대충 잡으면 정작 검사하려는 조건을 비껴간다.
 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "reap-worktrees-"));
  fixtures.push(dir);
  const git = gitIn(dir);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "hook@example.invalid"]);
  git(["config", "user.name", "hook"]);
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "seed"]);
  mkdirSync(join(dir, ".claude", "worktrees"), { recursive: true });
  return { dir, git };
}

/** 인계 커밋까지 찍힌 서브에이전트 사본을 만든다. */
function addAgent({ dir, git }, id, { dirName = `agent-${id}`, branch = `worktree-agent-${id}` } = {}) {
  const path = join(dir, ".claude", "worktrees", dirName);
  git(["worktree", "add", "-q", "-b", branch, path]);
  const inTree = gitIn(path);
  writeFileSync(join(path, `${id}.txt`), "산출물\n");
  inTree(["add", "-A"]);
  inTree(["commit", "-qm", `chore(developer): 산출물을 인계 커밋으로 남긴다`]);
  return { path, branch };
}

/** 오케스트레이터의 회수. */
function recover({ git }, branch) {
  git(["merge", "--no-ff", "-q", "-m", `merge ${branch}`, branch]);
}

const run = ({ dir }) => reap({ run: gitIn(dir), cwd: dir });

describe("reap-worktrees — 회수가 끝난 서브에이전트 사본만 거둔다", () => {
  it("회수된 사본을 거두고 브랜치까지 접는다", () => {
    const repo = makeRepo();
    const agent = addAgent(repo, "aaaa11");
    recover(repo, agent.branch);

    const { reaped } = run(repo);

    expect(reaped.map((t) => t.branch)).toEqual([agent.branch]);
    expect(existsSync(agent.path)).toBe(false);
    expect(repo.git(["branch", "--list"])).not.toContain(agent.branch);
  });

  it("거둔 뒤에도 인계 커밋은 남는다 — 회수된 내용이 사라지지 않는다", () => {
    const repo = makeRepo();
    const agent = addAgent(repo, "bbbb22");
    recover(repo, agent.branch);

    run(repo);

    expect(repo.git(["log", "--format=%s"])).toContain("산출물을 인계 커밋으로 남긴다");
    expect(repo.git(["ls-files"])).toContain("bbbb22.txt");
  });

  it("아직 회수되지 않은 사본은 건드리지 않는다", () => {
    // 머지 전에 지우면 오케스트레이터가 회수할 것을 잃는다 — 이 훅이 절대 하면 안 되는 일.
    const repo = makeRepo();
    const agent = addAgent(repo, "cccc33");

    const { reaped } = run(repo);

    expect(reaped).toEqual([]);
    expect(existsSync(agent.path)).toBe(true);
    expect(repo.git(["branch", "--list"])).toContain(agent.branch);
  });

  it("작업 세션의 worktree 는 회수 여부와 무관하게 대상이 아니다", () => {
    // 이것이 이 훅의 핵심 경계다. 작업 세션의 브랜치는 정의상 main 에 머지되지 않은 채
    // push 되고, 지우면 살아 있는 PR 이 죽는다.
    const repo = makeRepo();
    const session = join(repo.dir, ".claude", "worktrees", "feat-login");
    repo.git(["worktree", "add", "-q", "-b", "worktree-feat+login", session]);

    const { reap: targets } = plan({ run: gitIn(repo.dir), cwd: repo.dir });

    expect(targets).toEqual([]);
    expect(existsSync(session)).toBe(true);
  });

  it("작업 세션 브랜치가 머지되어 있어도 대상이 아니다", () => {
    const repo = makeRepo();
    const session = join(repo.dir, ".claude", "worktrees", "feat-login");
    repo.git(["worktree", "add", "-q", "-b", "worktree-feat+login", session]);
    const inSession = gitIn(session);
    writeFileSync(join(session, "spec.md"), "spec\n");
    inSession(["add", "-A"]);
    inSession(["commit", "-qm", "spec"]);
    recover(repo, "worktree-feat+login");

    run(repo);

    expect(existsSync(session)).toBe(true);
    expect(repo.git(["branch", "--list"])).toContain("worktree-feat+login");
  });

  it("브랜치 이름이 맞아도 디렉터리가 `worktrees/agent-<hex>` 가 아니면 남긴다", () => {
    // 자물쇠 둘 중 하나가 흔들렸을 때 작업 세션의 사본으로 번지지 않게 하는 장치.
    const repo = makeRepo();
    const odd = join(repo.dir, ".claude", "worktrees", "login");
    repo.git(["worktree", "add", "-q", "-b", "worktree-agent-dddd44", odd]);
    recover(repo, "worktree-agent-dddd44");

    const { reaped, skipped } = run(repo);

    expect(reaped).toEqual([]);
    expect(existsSync(odd)).toBe(true);
    expect(skipped[0].reason).toContain("서브에이전트 사본이 아니다");
    // 남긴다는 것은 브랜치까지 남긴다는 뜻이다 — 사본을 지키고 ref 만 지우면 반쪽이다.
    expect(repo.git(["branch", "--list"])).toContain("worktree-agent-dddd44");
  });

  it("커밋되지 않은 변경이 남은 사본은 git 이 지켜준다", () => {
    // 인계 커밋이 실패한 경우다. 산출물이 워킹트리에만 있으므로 지우면 유실이다.
    const repo = makeRepo();
    const agent = addAgent(repo, "eeee55");
    recover(repo, agent.branch);
    writeFileSync(join(agent.path, "미커밋.txt"), "아직 인계되지 않았다\n");

    const { reaped, skipped } = run(repo);

    expect(reaped).toEqual([]);
    expect(existsSync(agent.path)).toBe(true);
    expect(skipped[0].reason).toMatch(/modified or untracked/);
  });

  it("locked 사본은 남긴다 — 쓰는 쪽이 있다", () => {
    const repo = makeRepo();
    const agent = addAgent(repo, "ffff66");
    recover(repo, agent.branch);
    repo.git(["worktree", "lock", "--reason", "claude session", agent.path]);

    const { reaped, skipped } = run(repo);

    expect(reaped).toEqual([]);
    expect(existsSync(agent.path)).toBe(true);
    expect(skipped[0].reason).toContain("locked");
    expect(repo.git(["branch", "--list"])).toContain(agent.branch);
  });

  it("내 task 브랜치 위에서 부르면 내 에이전트만 거둔다", () => {
    const repo = makeRepo();
    const task = join(repo.dir, ".claude", "worktrees", "feat-login");
    repo.git(["worktree", "add", "-q", "-b", "worktree-feat+login", task]);
    const inTask = gitIn(task);
    writeFileSync(join(task, "spec.md"), "spec\n");
    inTask(["add", "-A"]);
    inTask(["commit", "-qm", "spec"]);

    const agent = join(repo.dir, ".claude", "worktrees", "agent-a1b2c3");
    inTask(["worktree", "add", "-q", "-b", "worktree-agent-a1b2c3", agent]);
    const inAgent = gitIn(agent);
    writeFileSync(join(agent, "src.txt"), "구현\n");
    inAgent(["add", "-A"]);
    inAgent(["commit", "-qm", "chore(developer): 산출물을 인계 커밋으로 남긴다"]);
    inTask(["merge", "--no-ff", "-q", "-m", "recover", "worktree-agent-a1b2c3"]);

    // 오케스트레이터는 push 직후, 아직 자기 worktree 안에 서서 부른다.
    const { reaped } = reap({ run: gitIn(task), cwd: task });

    expect(reaped.map((t) => t.branch)).toEqual(["worktree-agent-a1b2c3"]);
    expect(existsSync(agent)).toBe(false);
    // 그러면서 작업 세션의 사본과 브랜치는 그대로다.
    expect(existsSync(task)).toBe(true);
    expect(repo.git(["branch", "--list"])).toContain("worktree-feat+login");
  });

  it("다른 세션의 에이전트 사본은 회수됐어도 건드리지 않는다", () => {
    // 이것이 이 스크립트가 낸 실제 사고다. 판정을 '아무 브랜치나 품고 있으면 회수된 것'
    // 으로 넓혔더니, 세션 하나가 Ctrl+C 로 죽으면서 병렬로 돌던 다른 세션들의 사본까지
    // 전부 쓸어갔다. 소유의 근거는 '내 HEAD 에 머지됐나' 하나뿐이다.
    const repo = makeRepo();

    const mine = join(repo.dir, ".claude", "worktrees", "feat-mine");
    repo.git(["worktree", "add", "-q", "-b", "worktree-feat+mine", mine]);
    const inMine = gitIn(mine);
    writeFileSync(join(mine, "mine.md"), "mine\n");
    inMine(["add", "-A"]);
    inMine(["commit", "-qm", "my spec"]);

    const other = join(repo.dir, ".claude", "worktrees", "other-task");
    repo.git(["worktree", "add", "-q", "-b", "worktree-other", other]);
    const inOther = gitIn(other);
    writeFileSync(join(other, "other.md"), "other\n");
    inOther(["add", "-A"]);
    inOther(["commit", "-qm", "other task"]);

    // 남의 세션의 에이전트 — 그쪽 브랜치에는 이미 회수됐다.
    const foreign = join(repo.dir, ".claude", "worktrees", "agent-999999");
    inOther(["worktree", "add", "-q", "-b", "worktree-agent-999999", foreign]);
    const inForeign = gitIn(foreign);
    writeFileSync(join(foreign, "x.txt"), "x\n");
    inForeign(["add", "-A"]);
    inForeign(["commit", "-qm", "handoff"]);
    inOther(["merge", "--no-ff", "-q", "-m", "recover", "worktree-agent-999999"]);

    const { reaped } = reap({ run: inMine, cwd: mine });

    expect(reaped).toEqual([]);
    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(repo.git(["branch", "--list"])).toContain("worktree-agent-999999");
  });

  it("사본이 이미 없고 회수된 브랜치만 남았으면 ref 를 접는다", () => {
    const repo = makeRepo();
    const agent = addAgent(repo, "aaab77");
    recover(repo, agent.branch);
    repo.git(["worktree", "remove", agent.path]);

    const { reaped } = run(repo);

    expect(reaped).toEqual([{ branch: agent.branch, path: null }]);
    expect(repo.git(["branch", "--list"])).not.toContain(agent.branch);
  });

  it("거둘 것이 여럿이면 다 거둔다", () => {
    const repo = makeRepo();
    const dev = addAgent(repo, "abc111");
    recover(repo, dev.branch);
    const qa = addAgent(repo, "abc222");
    recover(repo, qa.branch);

    const { reaped } = run(repo);

    expect(reaped.map((t) => t.branch).sort()).toEqual([dev.branch, qa.branch].sort());
    expect(existsSync(dev.path)).toBe(false);
    expect(existsSync(qa.path)).toBe(false);
  });

  it("하나가 막혀도 나머지는 거둔다", () => {
    const repo = makeRepo();
    const blocked = addAgent(repo, "abc333");
    recover(repo, blocked.branch);
    writeFileSync(join(blocked.path, "미커밋.txt"), "x\n");
    const clean = addAgent(repo, "abc444");
    recover(repo, clean.branch);

    const { reaped } = run(repo);

    expect(reaped.map((t) => t.branch)).toEqual([clean.branch]);
    expect(existsSync(blocked.path)).toBe(true);
  });

  it("직접 실행하면 종료 코드 0 으로 무엇을 했는지 적는다", () => {
    const repo = makeRepo();
    const agent = addAgent(repo, "abc555");
    recover(repo, agent.branch);

    const result = spawnSync(process.execPath, [HOOK], {
      cwd: repo.dir,
      input: JSON.stringify({ reason: "other" }),
      encoding: "utf8",
      env: cleanEnv(),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`정리: ${agent.branch}`);
    expect(existsSync(agent.path)).toBe(false);
  });

  it("git 을 못 써도 실패로 끝나지 않되, 조용히 넘어가지도 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "reap-worktrees-nogit-"));
    fixtures.push(dir);

    const result = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: "{}",
      encoding: "utf8",
      env: cleanEnv(),
    });

    // push 는 이미 끝난 뒤라 여기서 실패해도 되돌릴 것이 없다. 다만 부른 쪽이
    // '정리됐다' 고 오해하면 사본이 소리 없이 쌓인다.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("정리하지 못했다");
  });
});
