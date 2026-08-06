import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isHarnessMeta,
  classifyLocation,
  stripWorktreeSuffix,
  resolveMetaPaths,
  nearestExistingDir,
} from "./verify-branch.mjs";
import { DEFAULTS } from "../../scripts/gate.mjs";

// verify-branch 훅의 판정 로직(순수 함수)만 다룬다. git 호출·stdin 파싱은 main() 에만 있다.
// gate.test.mjs 와 같은 관례: 부수효과 없는 함수를 import 해서 테스트한다.

const META = DEFAULTS.harnessMetaPaths;

describe("isHarnessMeta", () => {
  it("저장소 루트 바로 아래의 harness/·.claude/ 는 면제다", () => {
    expect(isHarnessMeta("harness/index.json", META)).toBe(true);
    expect(isHarnessMeta(".claude/CLAUDE.md", META)).toBe(true);
    expect(isHarnessMeta(".claude/hooks/verify-branch.mjs", META)).toBe(true);
  });

  // 이것이 기능 B 의 핵심 회귀: 부분 문자열 매칭이면 제품 코드가 뚫린다.
  it("하위 디렉터리의 같은 이름은 면제가 아니다", () => {
    expect(isHarnessMeta("apps/web/harness/foo.ts", META)).toBe(false);
    expect(isHarnessMeta("vendor/.claude/x.ts", META)).toBe(false);
    expect(isHarnessMeta("packages/core/src/harness/util.ts", META)).toBe(false);
  });

  it("역슬래시 경로·선행 './' 에 대해 같은 결과를 낸다", () => {
    expect(isHarnessMeta("harness\\index.json", META)).toBe(true);
    expect(isHarnessMeta("./harness/index.json", META)).toBe(true);
    expect(isHarnessMeta(".\\apps\\web\\harness\\foo.ts", META)).toBe(false);
  });

  it("설정에 넣은 디렉터리 접두어가 면제된다", () => {
    expect(isHarnessMeta(".githooks/pre-push", META)).toBe(false);
    expect(isHarnessMeta(".githooks/pre-push", [...META, ".githooks/"])).toBe(true);
  });

  // 단일 파일 항목은 접두어가 아니라 정확 일치여야 한다 — BACKLOG.md 가 BACKLOG.md.bak 을 뚫으면 안 된다.
  it("단일 파일 항목은 정확 일치로만 면제한다", () => {
    const meta = [...META, "BACKLOG.md"];
    expect(isHarnessMeta("BACKLOG.md", meta)).toBe(true);
    expect(isHarnessMeta("BACKLOG.md.bak", meta)).toBe(false);
    expect(isHarnessMeta("docs/BACKLOG.md", meta)).toBe(false);
  });

  // 항목에 슬래시를 빠뜨려도(harness) 디렉터리 경계에서는 면제된다 — 설정 오타가 조용히
  // worktree 강제를 뒤집는 것보다, 경계 매칭이 안전한 방향의 실패다.
  it("슬래시 없는 디렉터리 항목도 경계에서 매칭한다", () => {
    expect(isHarnessMeta("harness/index.json", ["harness"])).toBe(true);
    expect(isHarnessMeta("harnessed/x.ts", ["harness"])).toBe(false);
  });

  it("면제 목록이 비면 아무것도 면제하지 않는다", () => {
    expect(isHarnessMeta("harness/index.json", [])).toBe(false);
  });

  it("기본값은 현재 동작과 같다(harness/·.claude/)", () => {
    expect(DEFAULTS.harnessMetaPaths).toEqual(["harness/", ".claude/"]);
  });
});

describe("classifyLocation", () => {
  const S = { sessionTop: "/repo", sessionCommon: "/repo/.git" };

  it("세션과 대상이 같은 워킹트리면 same", () => {
    expect(classifyLocation({ ...S, targetTop: "/repo", targetCommon: "/repo/.git" })).toBe("same");
  });

  it("common-dir 이 같고 toplevel 이 다르면 other-worktree", () => {
    expect(
      classifyLocation({ ...S, targetTop: "/repo-task", targetCommon: "/repo/.git" }),
    ).toBe("other-worktree");
  });

  it("common-dir 이 다르면 other-repo", () => {
    expect(
      classifyLocation({ ...S, targetTop: "/other", targetCommon: "/other/.git" }),
    ).toBe("other-repo");
  });

  it("대상이 git 밖이면 outside", () => {
    expect(classifyLocation({ ...S, targetTop: null, targetCommon: null })).toBe("outside");
    expect(classifyLocation({ ...S, targetTop: "", targetCommon: "" })).toBe("outside");
  });

  // 세션 쪽 git 정보를 못 구하면 비교 자체가 성립하지 않는다 → 간섭하지 않는다(통과 방향).
  it("세션 git 정보가 없으면 outside 로 물러선다", () => {
    expect(
      classifyLocation({
        sessionTop: null,
        sessionCommon: null,
        targetTop: "/repo",
        targetCommon: "/repo/.git",
      }),
    ).toBe("outside");
  });

  it("구분자·후행 슬래시 차이를 흡수한다", () => {
    expect(
      classifyLocation({
        sessionTop: "/repo/",
        sessionCommon: "/repo/.git",
        targetTop: "/repo",
        targetCommon: "/repo/.git/",
      }),
    ).toBe("same");
  });
});

describe("stripWorktreeSuffix", () => {
  // --path-format 미지원 git(2.31 미만)에서 --absolute-git-dir 로 폴백하면 링크드 worktree 는
  // <공용>/.git/worktrees/<name> 을 준다. 그대로 비교하면 모든 worktree 가 other-repo 가 된다.
  it("링크드 worktree 의 git-dir 을 공용 git-dir 로 되돌린다", () => {
    expect(stripWorktreeSuffix("/repo/.git/worktrees/task")).toBe("/repo/.git");
    expect(stripWorktreeSuffix("/repo/.git/worktrees/task/")).toBe("/repo/.git");
    expect(stripWorktreeSuffix("C:\\repo\\.git\\worktrees\\task")).toBe("C:/repo/.git");
  });

  it("메인 체크아웃의 git-dir 은 그대로 둔다", () => {
    expect(stripWorktreeSuffix("/repo/.git")).toBe("/repo/.git");
  });

  it("빈 값은 빈 값이다", () => {
    expect(stripWorktreeSuffix("")).toBe("");
    expect(stripWorktreeSuffix(null)).toBe("");
  });
});

describe("resolveMetaPaths", () => {
  it("설정에 harnessMetaPaths 가 있으면 그것을 쓴다", () => {
    expect(resolveMetaPaths(JSON.stringify({ harnessMetaPaths: ["a/", "b.md"] }))).toEqual([
      "a/",
      "b.md",
    ]);
  });

  it("harnessMetaPaths 가 없으면 기본값(현재 동작)이다", () => {
    expect(resolveMetaPaths("{}")).toEqual(DEFAULTS.harnessMetaPaths);
  });

  // 훅은 설정이 깨져도 조용히 죽으면 안 된다 — 기본값으로 물러선다(qa-hash.mjs 와 같은 방침).
  it("설정이 없거나 JSON 이 깨져도 기본값으로 물러선다", () => {
    expect(resolveMetaPaths(null)).toEqual(DEFAULTS.harnessMetaPaths);
    expect(resolveMetaPaths("{ not json ")).toEqual(DEFAULTS.harnessMetaPaths);
    expect(resolveMetaPaths(JSON.stringify({ harnessMetaPaths: "harness/" }))).toEqual(
      DEFAULTS.harnessMetaPaths,
    );
  });
});

describe("nearestExistingDir", () => {
  const here = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "");

  it("존재하는 파일이면 그 파일의 디렉터리다", () => {
    expect(nearestExistingDir(fileURLToPath(import.meta.url))).toBe(here);
  });

  // 신규 파일은 아직 없다 — 파일 존재를 전제하면 Write 신규 생성에서 오작동한다.
  it("아직 없는 파일·디렉터리면 존재하는 상위로 올라간다", () => {
    expect(nearestExistingDir(join(here, "not-yet.mjs"))).toBe(here);
    expect(nearestExistingDir(join(here, "a", "b", "c", "not-yet.mjs"))).toBe(here);
  });

  it("루트까지 올라가도 없으면 null 이 아니라 루트에서 멈춘다", () => {
    // 어떤 경로든 루트는 존재하므로 null 이 나오지 않는다(무한 루프도 없다).
    expect(nearestExistingDir(join(here, "x"))).toBeTruthy();
  });
});

// ── 훅 전체 계약(stdin JSON → 결정 JSON) ────────────────────────────────────
// 순수 함수만으로는 '판정 순서' 를 증명할 수 없다. 실제 저장소·worktree 를 임시로 만들어
// 훅을 프로세스로 돌린다 — 이 spec 의 ① 증상(메인 세션이 worktree 파일을 편집)이 정확히
// 순서 문제였기 때문이다(보호 브랜치 ask 가 먼저 반환하면 교차 편집이 ask 로 샌다).
describe("훅 실행(end-to-end)", () => {
  const HOOK = fileURLToPath(new URL("./verify-branch.mjs", import.meta.url));
  let tmp;
  let mainRepo;
  let wt;
  let otherRepo;

  // GIT_* 를 걷어낸 환경. pre-commit/pre-push 훅 안에서 게이트가 돌면 GIT_DIR·GIT_INDEX_FILE
  // 등이 상속돼, 임시 저장소를 겨냥한 git 호출이 이 저장소를 건드린다(그러면 테스트가 통째로
  // 깨진다 — 실제로 pre-commit 에서 그렇게 실패했다). 하위 프로세스에는 씻어서 넘긴다.
  const ENV = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );

  const git = (repo, ...args) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "ignore"], env: ENV })
      .toString()
      .trim();

  // 훅 출력이 비면 '간섭하지 않음(통과)' 이다.
  function runHook(cwd, filePath) {
    const out = execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ cwd, tool_input: { file_path: filePath } }),
      encoding: "utf8",
      env: ENV,
    });
    return out.trim() ? JSON.parse(out).hookSpecificOutput : null;
  }

  beforeAll(() => {
    // realpath: macOS 의 /var → /private/var 심볼릭 링크를 미리 흡수한다.
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "verify-branch-")));
    mainRepo = join(tmp, "repo");
    wt = join(tmp, "repo-task");
    otherRepo = join(tmp, "other");

    for (const dir of [mainRepo, otherRepo]) {
      mkdirSync(dir, { recursive: true });
      execFileSync("git", ["init", "-q", dir], { stdio: "ignore", env: ENV });

      // 안전장치: 이 아래의 add/commit/checkout 이 정말 임시 저장소를 보는지 먼저 확인한다.
      // GIT_* 가 한 번이라도 새어 들어오면 이 호출들은 '이 저장소' 를 건드린다 — 브랜치가
      // 옮겨지고 인덱스가 리셋된다(실제로 그렇게 망가뜨렸다). 새는 순간 시끄럽게 실패시킨다.
      const top = git(dir, "rev-parse", "--show-toplevel").split("\\").join("/");
      const want = dir.split("\\").join("/");
      if (top.toLowerCase() !== want.toLowerCase()) {
        throw new Error(
          `임시 저장소가 아닌 곳을 가리킵니다: ${top} (기대: ${want}) — GIT_* 환경변수 누수`,
        );
      }

      git(dir, "config", "user.email", "harness@example.com");
      git(dir, "config", "user.name", "harness");
      writeFileSync(join(dir, "README.md"), "x\n");
    }

    // 하네스 설정은 커밋해 둔다 — worktree 에도 따라가야 그 트리에서 같은 판정이 난다.
    mkdirSync(join(mainRepo, "harness"), { recursive: true });
    writeFileSync(
      join(mainRepo, "harness/index.json"),
      JSON.stringify({ tasks: { "feat/solo": "harness/solo/spec.md", "feat/task": "harness/task/spec.md" } }),
    );
    writeFileSync(
      join(mainRepo, "harness/config.json"),
      JSON.stringify({ harnessMetaPaths: ["harness/", ".claude/"] }),
    );
    git(mainRepo, "add", "-A");
    git(mainRepo, "commit", "-qm", "init");
    git(otherRepo, "add", "-A");
    git(otherRepo, "commit", "-qm", "init");

    git(mainRepo, "checkout", "-q", "-B", "feat/solo");
    git(mainRepo, "worktree", "add", "-q", "-b", "feat/task", wt, "HEAD");
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  });

  // ① 이 spec 이 고치는 증상 그 자체: 메인 체크아웃 세션이 worktree 안의 소스를 편집한다.
  it("메인 체크아웃 세션이 링크드 worktree 의 파일을 편집하면 deny 다", () => {
    const res = runHook(mainRepo, join(wt, "scripts/gate.mjs"));
    expect(res.permissionDecision).toBe("deny");
    expect(res.permissionDecisionReason).toMatch(/다른 워킹트리/);
  });

  // 보호 브랜치 ask 가 먼저 반환하면 교차 편집이 ask 로 샌다 — 판정 순서의 회귀 테스트.
  it("세션이 보호 브랜치여도 교차 워킹트리 편집은 ask 가 아니라 deny 다", () => {
    git(mainRepo, "checkout", "-q", "-B", "main");
    try {
      const res = runHook(mainRepo, join(wt, "scripts/gate.mjs"));
      expect(res.permissionDecision).toBe("deny");
    } finally {
      git(mainRepo, "checkout", "-q", "feat/solo");
    }
  });

  it("아직 존재하지 않는 파일 경로에도 교차 워킹트리 판정이 동작한다", () => {
    const res = runHook(mainRepo, join(wt, "a/b/c/new-file.mjs"));
    expect(res.permissionDecision).toBe("deny");
  });

  it("같은 워킹트리(worktree 세션) 안의 소스 편집은 간섭하지 않는다", () => {
    expect(runHook(wt, join(wt, "scripts/gate.mjs"))).toBeNull();
  });

  it("대상이 다른 저장소면 deny 가 아니라 ask 다", () => {
    const res = runHook(mainRepo, join(otherRepo, "src/x.mjs"));
    expect(res.permissionDecision).toBe("ask");
    expect(res.permissionDecisionReason).toMatch(/다른 저장소/);
  });

  it("대상이 git 저장소 밖이면 간섭하지 않는다", () => {
    expect(runHook(mainRepo, join(tmp, "scratch.txt"))).toBeNull();
  });

  it("등록된 task 를 메인 체크아웃에서 편집하면 deny 다", () => {
    const res = runHook(mainRepo, join(mainRepo, "scripts/gate.mjs"));
    expect(res.permissionDecision).toBe("deny");
  });

  // 기능 B: 루트 앵커링. 부분 문자열 매칭이면 여기가 통과해 버린다.
  it("하위 디렉터리의 harness/ 는 면제가 아니라 deny 다", () => {
    const res = runHook(mainRepo, join(mainRepo, "apps/web/harness/foo.ts"));
    expect(res.permissionDecision).toBe("deny");
  });

  it("루트 바로 아래 harness/·.claude/ 는 메인 체크아웃에서도 통과한다", () => {
    expect(runHook(mainRepo, join(mainRepo, "harness/solo/spec.md"))).toBeNull();
    expect(runHook(mainRepo, join(mainRepo, ".claude/settings.json"))).toBeNull();
  });

  // 기능 D: 메시지.
  it("deny 메시지에 apps/·packages/ 가 등장하지 않고 면제 목록의 출처를 알린다", () => {
    const reason = runHook(mainRepo, join(mainRepo, "scripts/gate.mjs")).permissionDecisionReason;
    expect(reason).not.toMatch(/apps\/|packages\//);
    expect(reason).toMatch(/harnessMetaPaths/);
  });

  it("교차 워킹트리 차단과 메인 체크아웃 차단의 메시지가 서로 다르다", () => {
    const cross = runHook(mainRepo, join(wt, "scripts/gate.mjs")).permissionDecisionReason;
    const mainCheckout = runHook(mainRepo, join(mainRepo, "scripts/gate.mjs"))
      .permissionDecisionReason;
    expect(cross).not.toBe(mainCheckout);
    expect(cross).toMatch(/worktree 에서 세션을 열어/);
    expect(mainCheckout).toMatch(/worktree-add/);
  });

  it("설정 파일이 깨져도 훅은 기본값으로 계속 판정한다", () => {
    const configFile = join(mainRepo, "harness/config.json");
    const backup = readFileSync(configFile, "utf8");
    writeFileSync(configFile, "{ not json ");
    try {
      expect(runHook(mainRepo, join(mainRepo, "harness/solo/spec.md"))).toBeNull();
      expect(
        runHook(mainRepo, join(mainRepo, "scripts/gate.mjs")).permissionDecision,
      ).toBe("deny");
    } finally {
      writeFileSync(configFile, backup);
    }
  });
});

describe("이 저장소의 harness/config.json", () => {
  const configText = readFileSync(
    fileURLToPath(new URL("../../harness/config.json", import.meta.url)),
    "utf8",
  );

  it("문서가 '면제' 라고 약속한 하네스 메타 경로를 실제로 면제한다", () => {
    const meta = resolveMetaPaths(configText);
    for (const p of [
      "harness/index.json",
      ".claude/CLAUDE.md",
      ".githooks/pre-push",
      "README.md",
      "BACKLOG.md",
    ]) {
      expect(isHarnessMeta(p, meta)).toBe(true);
    }
  });

  // scripts/ 는 의도적으로 면제하지 않는다 — 이 저장소의 제품 소스가 거의 전부 scripts/ 라
  // 면제하면 worktree 강제가 사라진다(spec '배경' 절).
  it("scripts/ 는 면제하지 않는다", () => {
    expect(isHarnessMeta("scripts/gate.mjs", resolveMetaPaths(configText))).toBe(false);
  });
});
