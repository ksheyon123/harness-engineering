import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./session-role.mjs", import.meta.url));

/** 이 저장소의 최상단. 배포되는 `.claude/planner/` 가 실제로 실리는지 볼 때 쓴다. */
const REPO = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 빈 트리. **기본 `cwd` 를 이걸로 둔다** — 실제 저장소를 기준으로 돌리면 이 저장소에
 * 깔린 `.claude/planner/` 가 딸려 들어와, 주입과 무관한 케이스들이 그 내용에 묶인다.
 */
const EMPTY = mkdtempSync(join(tmpdir(), "session-role-empty-"));

/** `<트리>/.claude/planner/` 에 문서를 깔아 둔 임시 트리를 만든다. */
function treeWithPlanner(docs) {
  const tree = mkdtempSync(join(tmpdir(), "session-role-planner-"));
  const dir = join(tree, ".claude", "planner");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(docs)) writeFileSync(join(dir, name), body);
  return tree;
}

/**
 * 부모의 `HARNESS_*` 를 지운 env. 이 테스트를 **작업 세션 안에서** 돌리면 실제
 * `HARNESS_ROLE` 을 물려받아, '미설정이면 실행자' 를 검증하는 케이스가 조용히 통과한다.
 */
function baseEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("HARNESS_")) env[key] = value;
  }
  return { ...env, ...extra };
}

function runHook({ env = {}, source = "startup", cwd = EMPTY } = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart", source, cwd }),
    encoding: "utf8",
    env: baseEnv(env),
  });
  const stdout = result.stdout ?? "";
  return {
    status: result.status,
    out: stdout.trim() ? JSON.parse(stdout).hookSpecificOutput : null,
  };
}

describe("session-role — SessionStart 역할 주입 훅", () => {
  it("HARNESS_ROLE 이 없으면 실행자로 선언한다", () => {
    // 부재가 곧 실행자다. 맨몸 claude 에는 아무도 변수를 심어주지 않는다.
    const { status, out } = runHook();

    expect(status).toBe(0);
    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toContain("실행자");
    // 안내하는 명령이 설치본에도 있어야 한다 — `scripts/` 는 A 에 복사되지 않는다.
    expect(out.additionalContext).toContain("harness spawn");
    // 라우팅의 두 출구를 이름으로 못 박는다. 이 주입문이 하네스 요청을 넘기라고 말하면
    // 작업 세션은 spec 까지 쓰고 층 1 에 막힌다 — 실측으로 그렇게 샜다.
    expect(out.additionalContext).toContain("/task");
    expect(out.additionalContext).toContain("/harness-fix");
  });

  it("work-session 이면 작업 세션으로 선언하고 spec 지침을 가리킨다", () => {
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" } });

    expect(out.additionalContext).toContain("작업 세션");
    expect(out.additionalContext).toContain("기획자 모드로 시작한다");
    // 잘못 열린 탭이 **논의를 시작하기 전에** 되돌아갈 수 있어야 한다. 층 1 도 같은
    // 출구를 알려주지만, 거기까지 가면 이미 spec 을 쓴 뒤다.
    expect(out.additionalContext).toContain("/harness-fix");
    // 형식 지침이 CLAUDE.md 에 없으므로, 경로를 알려주지 않으면 찾을 방법이 없다.
    expect(out.additionalContext).toContain(".claude/planner-mode.md");
  });

  it("아는 값이 아니면 실행자로 흡수하지 않고 판정 불가를 알린다", () => {
    // 오설정을 기본값으로 삼키면 역할이 틀린 채로 일이 굴러가고 아무도 모른다.
    const { out } = runHook({ env: { HARNESS_ROLE: "planner" } });

    expect(out.additionalContext).toContain("판정할 수 없다");
    expect(out.additionalContext).toContain("planner");
  });

  it("공백뿐인 값은 미설정으로 본다", () => {
    const { out } = runHook({ env: { HARNESS_ROLE: "   " } });

    expect(out.additionalContext).toContain("실행자");
  });

  it.each(["startup", "resume", "clear", "compact", "fork"])(
    "%s 에도 역할을 다시 싣는다",
    (source) => {
      // 환경변수를 고른 이유가 이것이다 — 대화에 적어둔 역할 선언은 /clear 에 사라지지만
      // 변수는 프로세스에 남고, 훅은 그때마다 다시 돈다.
      const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, source });

      expect(out.additionalContext).toContain("작업 세션");
    },
  );

  it("첫 메시지를 만들지 않는다 — 원문은 spawn 이 직접 건넨다", () => {
    // 훅의 initialUserMessage 는 설치된 버전에서 아무 일도 일으키지 않았다.
    // 파이프라인 진입이 그 필드에 걸려 있으면 조용히 실패한다.
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" } });

    expect(out.initialUserMessage).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(["additionalContext", "hookEventName"]);
  });
});

describe("session-role — .claude/planner/ 를 작업 세션이 물고 시작한다", () => {
  it("작업 세션이면 디렉터리의 문서를 본문째 싣는다", () => {
    // 스킬은 시작 시점에 이름·설명만 넣고 본문은 부를 때 로드한다. spawn 이 원문을 첫
    // 프롬프트로 건네므로 누가 /grilling 을 칠 틈이 없다 — 그래서 훅이 직접 붙인다.
    const cwd = treeWithPlanner({ "grilling.md": "# Grilling\n\nInterview relentlessly." });
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, cwd });

    expect(out.additionalContext).toContain("작업 세션");
    expect(out.additionalContext).toContain("Interview relentlessly.");
  });

  it("적용 구간을 못 박는 프레이밍을 앞에 세운다", () => {
    // 본문은 spec 커밋 뒤에도 컨텍스트에 남는데 2모드는 묻지 않는다. 이 문장이 없으면
    // '상대를 끝까지 심문하라' 가 거기서 조용히 충돌한다.
    const cwd = treeWithPlanner({ "grilling.md": "Interview relentlessly." });
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, cwd });

    expect(out.additionalContext).toContain("기획자 모드의 논의 지침");
    expect(out.additionalContext).toContain("적용되지 않는다");
    // 프레이밍이 본문보다 뒤에 오면 이미 읽은 뒤라 늦다.
    expect(out.additionalContext.indexOf("기획자 모드의 논의 지침")).toBeLessThan(
      out.additionalContext.indexOf("Interview relentlessly."),
    );
  });

  it("여러 문서는 파일명 순으로 싣는다", () => {
    // 순서는 설치한 쪽이 쥘 수 있는 유일한 손잡이다(10- · 20-). 훅에 박으면 파일을
    // 더할 때마다 훅을 고쳐야 한다.
    const cwd = treeWithPlanner({
      "20-second.md": "SECOND",
      "10-first.md": "FIRST",
    });
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, cwd });

    expect(out.additionalContext.indexOf("FIRST")).toBeLessThan(
      out.additionalContext.indexOf("SECOND"),
    );
  });

  it("md 가 아닌 파일은 무시한다", () => {
    const cwd = treeWithPlanner({ "grilling.md": "LOADED", "notes.txt": "IGNORED" });
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, cwd });

    expect(out.additionalContext).toContain("LOADED");
    expect(out.additionalContext).not.toContain("IGNORED");
  });

  it("디렉터리가 없으면 조용히 넘어간다 — 끄는 방법이 그것이다", () => {
    // 문서를 지우는 것이 이 기능의 스위치다. 없다고 불평하면 끌 수가 없어진다.
    // HARNESS_ROLE 의 모르는 값과는 성격이 다르다 — 저건 오설정이고 이건 정당한 상태다.
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, cwd: EMPTY });

    expect(out.additionalContext).toContain("작업 세션");
    expect(out.additionalContext).not.toContain("기획자 모드의 논의 지침");
  });

  it("빈 파일뿐이면 프레이밍도 붙이지 않는다", () => {
    const cwd = treeWithPlanner({ "empty.md": "   \n\n" });
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, cwd });

    expect(out.additionalContext).not.toContain("기획자 모드의 논의 지침");
  });

  it("실행자에게는 붙이지 않는다", () => {
    // 실행자는 논의를 받지 않는 자리다. 라우팅해서 넘긴다.
    const cwd = treeWithPlanner({ "grilling.md": "Interview relentlessly." });
    const { out } = runHook({ cwd });

    expect(out.additionalContext).toContain("실행자");
    expect(out.additionalContext).not.toContain("Interview relentlessly.");
  });

  it("모르는 역할에게도 붙이지 않는다", () => {
    const cwd = treeWithPlanner({ "grilling.md": "Interview relentlessly." });
    const { out } = runHook({ env: { HARNESS_ROLE: "planner" }, cwd });

    expect(out.additionalContext).toContain("판정할 수 없다");
    expect(out.additionalContext).not.toContain("Interview relentlessly.");
  });

  it("/clear 이후에도 다시 싣는다", () => {
    const cwd = treeWithPlanner({ "grilling.md": "Interview relentlessly." });
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, source: "clear", cwd });

    expect(out.additionalContext).toContain("Interview relentlessly.");
  });

  it("이 저장소가 배포하는 grilling.md 가 실제로 실린다", () => {
    // 위 케이스들은 임시 트리를 쓴다 — 기본 문서가 실종돼도 전부 통과한다.
    // 배포되는 물건 자체를 한 번은 실제로 물려 봐야 한다.
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, cwd: REPO });

    expect(out.additionalContext).toContain("design tree");
  });
});
