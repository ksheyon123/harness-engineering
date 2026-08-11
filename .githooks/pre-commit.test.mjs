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

  it("`git mv` 만 한 커밋을 부분 스테이징으로 오인하지 않는다", () => {
    // rename 은 `XY <새 경로>\0<원래 경로>` 두 레코드로 온다. 뒤엣것을 레코드로
    // 해석하면 맨 경로의 첫 두 글자를 상태로 읽어, 옮기기만 한 커밋이 통째로 막힌다.
    const dir = makeRepo();
    write(dir, ".claude/hooks/thing.mjs", "x\n");
    git(dir, ["add", "-A"]);
    commit(dir, "seed");

    mkdirSync(join(dir, "scripts"), { recursive: true });
    git(dir, ["mv", ".claude/hooks/thing.mjs", "scripts/thing.mjs"]);

    expect(commit(dir).status).toBe(0);
  });

  it("`git mv` 와 함께 남은 미스테이징은 여전히 잡는다", () => {
    const dir = makeRepo();
    write(dir, ".claude/hooks/thing.mjs", "x\n");
    git(dir, ["add", "-A"]);
    commit(dir, "seed");

    mkdirSync(join(dir, "scripts"), { recursive: true });
    git(dir, ["mv", ".claude/hooks/thing.mjs", "scripts/thing.mjs"]);
    write(dir, "stray.txt", "잊힌 파일\n");

    const { status, stderr } = commit(dir);

    expect(status).not.toBe(0);
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

  describe("한 브랜치에 spec 은 하나", () => {
    /**
     * `main` 에 base 커밋 하나를 두고 작업 브랜치로 갈라진 저장소.
     *
     * **base 커밋을 `main` 위에서 만들 수는 없다** — 이 훅이 바로 그것을 막는다. 보호되지
     * 않는 브랜치에서 커밋한 뒤 `main` 을 거기 붙인다.
     */
    function branchedRepo(seed = () => {}) {
      const dir = makeRepo("seed");
      write(dir, "a.txt", "a\n");
      seed(dir);
      git(dir, ["add", "-A"]);
      commit(dir, "base");
      git(dir, ["branch", "main"]);
      git(dir, ["checkout", "-q", "-b", "feat/thing"]);
      return dir;
    }

    function addSpec(dir, task) {
      write(dir, `harness/${task}/spec.md`, SPEC);
      git(dir, ["add", "-A"]);
    }

    it("하나면 통과한다", () => {
      const dir = branchedRepo();
      addSpec(dir, "first");

      expect(commit(dir, "spec").status).toBe(0);
    });

    it("한 커밋에 둘을 담으면 막는다", () => {
      const dir = branchedRepo();
      addSpec(dir, "first");
      addSpec(dir, "second");

      const { status, stderr } = commit(dir, "spec 둘");

      expect(status).not.toBe(0);
      expect(stderr).toContain("spec 을 2개 추가한다");
      expect(stderr).toContain("harness/first/spec.md");
      expect(stderr).toContain("harness/second/spec.md");
    });

    it("커밋을 나눠 담아도 막는다 — 브랜치 전체로 센다", () => {
      // HEAD 가 아니라 base 와 인덱스를 비교하는 이유가 이것이다.
      const dir = branchedRepo();
      addSpec(dir, "first");
      commit(dir, "첫 spec");
      addSpec(dir, "second");

      const { status, stderr } = commit(dir, "둘째 spec");

      expect(status).not.toBe(0);
      expect(stderr).toContain("spec 을 2개 추가한다");
    });

    it("기존 spec 을 고치는 것은 추가가 아니다 — 리비전은 통과한다", () => {
      const dir = branchedRepo();
      addSpec(dir, "first");
      commit(dir, "첫 spec");
      write(dir, "harness/first/spec.md", `${SPEC}\n- **인수기준**: 재시도는 1회\n`);
      git(dir, ["add", "-A"]);

      expect(commit(dir, "spec 개정").status).toBe(0);
    });

    it("base 에 이미 있던 spec 은 세지 않는다", () => {
      const dir = branchedRepo((d) => write(d, "harness/old/spec.md", SPEC));
      addSpec(dir, "new");

      expect(commit(dir, "새 spec").status).toBe(0);
    });

    it("보호 브랜치가 없는 저장소에서는 판정하지 않는다", () => {
      // 없는 것과 모르는 것은 다르다. base 를 못 잡으면 세지 않는다.
      const dir = makeRepo("work");
      write(dir, "a.txt", "a\n");
      git(dir, ["add", "-A"]);
      commit(dir, "base");
      addSpec(dir, "first");
      addSpec(dir, "second");

      expect(commit(dir, "spec 둘").status).toBe(0);
    });
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
