import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { managedPaths } from "../install/managed.mjs";
import { plant, plantList } from "./plant.mjs";

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

function write(dir, rel, body) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/**
 * 훅이 붙은 저장소. 커밋 하나를 심어 둔다 — worktree 는 `HEAD` 가 있어야 만들어진다.
 *
 * 씨앗 커밋은 `--no-verify` 다. `core.hooksPath` 가 **이 저장소의 진짜 훅**을 가리키므로,
 * 안 그러면 픽스처가 층 2 의 판정을 받는다.
 */
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

/** 심기 대상이 되는 것들. 훅이 `plantList()` 로 짓는 것과 같은 집합이어야 한다. */
const HARNESS_FILES = [...managedPaths(), ".claude/settings.json", ".claude/CLAUDE.md"];

/**
 * 하네스가 설치된 저장소.
 *
 * @param {"ignored"|"committed"} mode `ignored` 면 `.claude/`·`.githooks/` 를 무시한다
 *   (= 미추적 설치). `committed` 면 전부 커밋한다 (= 이 저장소).
 */
function harnessRepo(mode) {
  const dir = makeRepo();

  for (const rel of HARNESS_FILES) write(dir, rel, `// ${rel}\n`);

  if (mode === "ignored") {
    writeFileSync(join(dir, ".gitignore"), ".claude/\n.githooks/\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--no-verify", "-m", "ignore harness"]);
  } else {
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--no-verify", "-m", "install harness"]);
  }

  return dir;
}

/**
 * 파일 내용. **줄바꿈을 normalize 한다.**
 *
 * `core.autocrlf=true` 인 Windows 에서는 커밋에서 나온 파일이 CRLF 로 체크아웃되므로,
 * 그대로 비교하면 이 기계에서만 깨진다. `managed.mjs` 의 `hashOf` 가 같은 이유로 같은
 * 짓을 한다 — 여기서 재려는 것은 줄바꿈이 아니라 **어느 쪽 내용이 왔는가**다.
 */
const body = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

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
    // 그러면 어디에 심을지를 모른 채 성공을 반환하게 된다.
    const real = (path) => path && existsSync(path);

    expect(real(field("cwd"))).toBe(true);
    expect(real(field("toplevel"))).toBe(true);
    expect(real(field("main"))).toBe(true);

    // cwd 와 toplevel 은 **사본**을, main 은 **본체**를 가리킨다. 이 구분이 무너지면
    // 심기가 자기 자신을 복사한다.
    expect(same(field("cwd"), copy)).toBe(true);
    expect(same(field("toplevel"), copy)).toBe(true);
    expect(same(field("main"), dir)).toBe(true);
  });

  it("흔적에 심은 결과가 숫자로 남는다", () => {
    // 흔적이 '불렸다' 만 말하면, 심기가 조용히 아무것도 안 한 상태와 구별되지 않는다.
    const dir = harnessRepo("ignored");

    git(dir, ["worktree", "add", "-q", "-b", "work", join(dir, "copy")]);

    const [line] = traceLines(dir);
    expect(line).toMatch(/\tplanted=\d+/);
    expect(line).toContain("failed=0");
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

describe("post-checkout — 언제 아무것도 하지 않는가", () => {
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

  it("본체 자신에서 불리면 아무것도 하지 않는다 — `git clone` 이 이 경로로 온다", () => {
    // clone 도 old-ref 가 전부 0 이다. 본체를 사본으로 착각하면 자기 자신에 자기를 심는다.
    const dir = harnessRepo("ignored");

    const { status } = runHook(dir, [ZERO40, git(dir, ["rev-parse", "HEAD"]).trim(), "1"]);

    expect(status).toBe(0);
    expect(existsSync(tracePath(dir))).toBe(false);
  });
});

describe("post-checkout — 심기", () => {
  it("`.claude/` 가 무시된 저장소에서도 사본이 하네스를 갖는다", () => {
    // 이 task 의 심장이다. 커밋되지 않았으므로 사본은 `HEAD` 에서 아무것도 못 받는다.
    const dir = harnessRepo("ignored");
    const copy = join(dir, "copy");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    for (const rel of HARNESS_FILES) {
      expect(existsSync(join(copy, rel)), rel).toBe(true);
    }
  });

  it("사본에 `.claude/worktrees/` 는 생기지 않는다", () => {
    // 목적지가 원본 안에 중첩돼 있어, 통째 복사는 재귀에 걸려 **조용히 절반만 복사하고
    // 성공을 반환한다**(실측). 목록을 명시하는 이유가 이것이다.
    const dir = harnessRepo("ignored");
    const copy = join(dir, "copy");
    write(dir, ".claude/worktrees/old/marker.txt", "남의 사본\n");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    expect(existsSync(join(copy, ".claude/worktrees"))).toBe(false);
  });

  it("심고 나서도 사본의 `git status` 가 비어 있다", () => {
    // 갓 만든 사본이 dirty 하면 안 된다 — 그 트리에서 인계 커밋이 찍히고,
    // `harness reap` 은 커밋되지 않은 변경이 있는 사본을 거부한다.
    const dir = harnessRepo("ignored");
    const copy = join(dir, "copy");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    expect(git(copy, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("`.claude/` 가 이미 커밋된 저장소에서도 안전하다", () => {
    const dir = harnessRepo("committed");
    const copy = join(dir, "copy");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    for (const rel of HARNESS_FILES) {
      expect(body(join(copy, rel)), rel).toBe(`// ${rel}\n`);
    }
    expect(git(copy, ["status", "--porcelain"]).trim()).toBe("");

    // **`planted=0` 만으로는 못 읽는다.** 이미 다 있어서 0 인 것과 목록이 비어서 0 인 것은
    // 진단이 정반대라, 사본이 이미 갖고 있던 것을 따로 센다.
    const [line] = traceLines(dir);
    expect(line).toContain("planted=0");
    expect(line).toMatch(/\tpresent=[1-9]/);
  });

  it("본체에 미커밋 수정이 있어도 사본을 더럽히지 않는다", () => {
    // 사본이 이미 갖고 있는 것을 본체의 **워킹트리** 파일로 덮으면, 하네스를 고치는
    // 중인 저장소에서 만든 사본이 전부 dirty 해진다.
    const dir = harnessRepo("committed");
    const copy = join(dir, "copy");
    write(dir, ".claude/harness.md", "// 아직 커밋 안 한 수정\n");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    expect(git(copy, ["status", "--porcelain"]).trim()).toBe("");
    expect(body(join(copy, ".claude/harness.md"))).toBe("// .claude/harness.md\n");
  });

  it("본체에 없는 것은 실패가 아니다", () => {
    // 벤더링본도 `harness.config.json` 도 선택 사항이다. 없다고 종료 코드를 물들이면
    // 멀쩡한 저장소가 전부 빨개진다.
    const dir = harnessRepo("ignored");
    const copy = join(dir, "copy");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    const { skipped, failed } = plant(dir, copy);
    expect(failed).toEqual([]);
    expect(skipped).toContain(".claude/harness/");
  });

  it("디렉터리는 그 아래까지 심는다", () => {
    const dir = harnessRepo("ignored");
    const copy = join(dir, "copy");
    write(dir, ".claude/harness/scripts/harness.mjs", "// 벤더링본\n");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);

    expect(existsSync(join(copy, ".claude/harness/scripts/harness.mjs"))).toBe(true);
  });
});

describe("post-checkout — 실패를 삼키지 않는다", () => {
  it("못 심은 것이 있으면 `failed` 에 경로가 남는다", () => {
    const main = harnessRepo("ignored");
    const copy = mkdtempSync(join(tmpdir(), "post-checkout-copy-"));
    fixtures.push(copy);

    // 디렉터리가 와야 할 자리에 **파일**을 둔다 — 그 아래로는 아무것도 못 심는다.
    write(copy, ".claude/hooks", "디렉터리가 아니다\n");

    const { failed } = plant(main, copy);

    expect(failed.length).toBeGreaterThan(0);
    expect(failed.join("\n")).toContain(".claude/hooks/");
  });

  it("심기가 실패하면 훅이 0 이 아닌 코드와 stderr 를 낸다", () => {
    // 조용히 넘기면 사본이 반쪽인 채로 에이전트가 시작하고, 그 실패에는 신호가 없다.
    const dir = harnessRepo("ignored");
    const copy = join(dir, "copy");

    git(dir, ["worktree", "add", "-q", "-b", "work", copy]);
    rmSync(join(copy, ".claude/hooks"), { recursive: true, force: true });
    write(copy, ".claude/hooks", "디렉터리가 아니다\n");

    const { status, stderr } = runHook(copy, [ZERO40, git(dir, ["rev-parse", "HEAD"]).trim(), "1"]);

    expect(status).not.toBe(0);
    expect(stderr).toContain("심지 못했다");
  });
});

describe("plantList — 목록의 출처", () => {
  it("`managedPaths()` 를 하나도 빠뜨리지 않는다", () => {
    // 손 목록이면 `sync` 가 파일을 하나 더 얹을 때 이 훅만 그것을 모르고, 새 파일은
    // 미추적으로 태어나므로 **하필 가장 필요한 순간에** 빠진다.
    const list = plantList();

    for (const rel of managedPaths()) expect(list, rel).toContain(rel);
  });

  it("`.claude/settings.json` 이 들어 있다 — 사본에서는 층 1 의 유일한 출처다", () => {
    // 에이전트 정의는 사본에 상속되지만 `settings.json` 은 안 온다(실측). 그래서
    // 이것이 빠지면 **에이전트는 정상 스폰되는데 종료 훅만 없는** 상태가 된다.
    expect(plantList()).toContain(".claude/settings.json");
  });

  it("`.claude/worktrees/` 는 들어 있지 않다", () => {
    expect(plantList().some((rel) => rel.includes("worktrees"))).toBe(false);
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
