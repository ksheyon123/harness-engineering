#!/usr/bin/env node
/**
 * SessionStart 훅 — 세션에게 **자기가 누구인지** 알려준다.
 *
 * CLAUDE.md 는 모든 세션에 똑같이 로드되므로 역할을 가르지 못한다. 지금까지 그 판정은
 * 사람의 첫 발화에 기대고 있었는데, 그건 정의상 신뢰할 수 없다 — 세션이 대화를 보고
 * 자기 역할을 정하면 **정해졌을 땐 이미 논의를 받은 뒤**다.
 *
 * 그래서 역할을 **프로세스 환경**에 둔다. `harness spawn` 이 자식 프로세스에
 * `HARNESS_ROLE` 을 심고, 이 훅이 그 값을 읽어 컨텍스트로 주입한다. 세션이 만들어낸 값이
 * 아니라 **부모가 심은 값**이라는 것이 요점이다. 맨몸 `claude` 에는 변수가 없고, 그
 * 부재가 곧 '실행자' 다.
 *
 * 환경변수를 골랐기 때문에 이것이 **컨텍스트 초기화를 견딘다.** `/clear` 이후에도 훅이
 * 다시 돌고(`source: "clear"`) 변수는 프로세스에 그대로 있다. 대화에 적어둔 역할 선언은
 * 그 지점에서 사라진다.
 *
 * **이것은 강제가 아니라 통보다.** `SessionStart` 는 차단할 수 없는 이벤트다. 진짜
 * 강제는 층 1(`PreToolUse` 경로 소유권)이 같은 변수를 읽어 붙일 때 생긴다.
 *
 * **역할만 싣는다.** 사람의 원문은 `spawn` 이 `claude` 의 첫 프롬프트로 직접 건넨다.
 * 이 훅의 `initialUserMessage` 로도 심어봤으나 설치된 버전에서 아무 일도 일어나지
 * 않았다 — 문서에만 있는 필드에 파이프라인 진입을 걸지 않는다.
 *
 * ## `.claude/planner/` — 작업 세션이 물고 시작하는 문서
 *
 * 역할 선언 뒤에 그 디렉터리의 `*.md` 를 붙인다. **작업 세션에만** 붙는다.
 *
 * 스킬로는 이걸 못 한다. 스킬은 시작 시점에 `name`·`description` 만 컨텍스트에 넣고
 * 본문은 `Skill` 도구가 부를 때 로드한다 — 즉 "부를 수 있는 것" 이지 "물고 시작하는 것"
 * 이 아니다. 그런데 `spawn` 은 사람의 원문을 `claude` 의 첫 프롬프트 인자로 건네므로
 * **탭이 열리는 순간 논의가 이미 시작된다.** 누군가 `/grilling` 을 칠 틈이 없고, 칠 수
 * 있는 시점엔 이미 늦었다 — 역할을 첫 발화로 정하지 않는 것과 같은 이유다.
 *
 * `CLAUDE.md` 에 넣는 것도 아니다. 그건 모든 세션과 **모든 서브에이전트**에 로드되므로,
 * 논의를 하지 않는 `developer`·`qa`·실행자까지 값을 치른다.
 *
 * **디렉터리가 곧 스위치다.** 하네스는 `grilling.md` 를 기본으로 깔아주고, 설치한
 * 프로젝트는 지우거나 바꾸거나 더한다. 훅에 내장 fallback 을 두지 않는 이유가 이것이다 —
 * 본문이 코드 안으로 들어가면 끌 수가 없다. 비어 있는 것은 오설정이 아니라 정당한
 * 상태이므로 조용히 넘어간다(`HARNESS_ROLE` 의 모르는 값과는 성격이 다르다).
 *
 * **경로는 `harness.config.json` 에 두지 않는다.** 거기 있는 값들은 프로젝트마다 실제로
 * 달라지는 것(`src/**` 냐 `lib/**` 냐)인데, 이 경로는 하네스가 통째로 소유하는 `.claude/`
 * 안이라 남이 옮길 이유가 없다. 게다가 `install/managed.mjs` 의 `VERBATIM` 과 manifest
 * 키가 이 경로를 정적으로 물고 있어, 설정으로 흔들면 설치·`sync` 가 전부 동적이 된다.
 *
 * > 주의: 서브에이전트는 세션의 env 를 물려받으므로 `HARNESS_ROLE` 을 그대로 갖는다.
 * > `SessionStart` 가 서브에이전트에는 돌지 않아 지금은 문제가 없지만, 층 1 이 이 변수로
 * > 경로를 강제하게 되면 **서브에이전트가 작업 세션으로 오인된다.** 그때는 변수만으로
 * > 부족하고 훅 입력의 에이전트 정보를 함께 봐야 한다.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { emit, readHookInput } from "./hook-kit.mjs";

/** `HARNESS_ROLE` 이 이 값이면 작업 세션. 미설정이면 실행자. 그 외는 오설정이다. */
const WORK_SESSION = "work-session";

/** 작업 세션이 물고 시작할 문서가 사는 곳. 저장소 최상단 기준의 상대 경로다. */
const PLANNER_DIR = ".claude/planner";

/**
 * 붙이기 전에 세우는 한 줄. **적용 구간을 못 박는다.**
 *
 * 주입된 본문은 spec 커밋 뒤에도 컨텍스트에 남는데, 2모드는 "묻지 않는다 — 멈춤 조건만"
 * 이다. 이 문장이 없으면 "relentlessly interview" 가 거기서 조용히 충돌한다.
 */
const PLANNER_PREFACE =
  `아래는 \`${PLANNER_DIR}/\` 가 실은 **기획자 모드의 논의 지침**이다. ` +
  `**spec 커밋으로 오케스트레이터 모드에 들어가면 적용되지 않는다** — 그 뒤로는 묻지 않는다.`;

const EXECUTOR = `너는 **실행자**다 — 맨몸 \`claude\` 로 열렸다(\`HARNESS_ROLE\` 미설정). 파이프라인 밖에 서 있다.

- **기능 요청·설계 논의는 받지 않는다.** \`harness spawn "<사람의 원문>"\` 으로 작업 세션을 새 탭에 띄우고, 그 탭에서 논의하라고 안내한다. "로그인 어떻게 만들까" 처럼 코드가 아직 안 바뀌는 것도 **미래를 정하는 일이라 넘긴다.**
- **저장소 코드를 고치지 않는다.** 오타·리팩터도 마찬가지다. 하네스(\`.claude/\` · \`.githooks/\` · 루트 설정 · 문서)가 네 본업이다.
- 넘길 때는 **사람의 원문을 그대로** 싣는다. 요약해서 넘기면 spec 이 그 요약 수준에서 멈춘다.
- 하네스를 고칠 때도 \`main\`/\`dev\` 에 직접 커밋하지 않는다 — 브랜치를 자른다.`;

const WORK = `너는 **작업 세션**이다(\`HARNESS_ROLE=${WORK_SESSION}\`). 이 세션은 **한 task** 를 끝까지 들고 간다.

- **기획자 모드로 시작한다.** 사람과 논의하는 것이 본업이다. **\`.claude/planner-mode.md\` 를 읽어라 — 기획자 모드는 그 파일이 전부다.** 논의를 어디서 하는지, 격리에 언제 들어가는지, spec 형식·인수기준·task 경계가 거기 있다.
- **spec 커밋이 모드 전환점**이다. 그 뒤로는 오케스트레이터 모드 — 묻지 않고 스폰 · 회수 · 검증 · QA · push 까지 간다. 멈추는 것은 닫힌 집합에 해당할 때뿐이다.
- **하네스 파일(\`.claude/\` · \`.githooks/\` · 루트 설정)은 고치지 않는다** — 실행자 자리다.
- 세션은 끝나면 닫힌다. **spec 에 안 적힌 것은 없는 것이다.**`;

const input = readHookInput();

emit({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: contextFor((process.env.HARNESS_ROLE ?? "").trim(), baseDirOf(input)),
  },
});

/**
 * 문서를 찾을 트리의 최상단.
 *
 * **모듈 위치(`import.meta.url`)로 찾으면 안 된다** — 설치된 프로젝트에서 훅 본체는
 * `node_modules/<패키지>/` 안에서 돌기 때문에 거기엔 A 의 `.claude/planner/` 가 없다.
 * `path-ownership` 과 같이 훅 입력의 `cwd` 를 쓴다. 입력에 없으면 프로세스의 cwd 로
 * 떨어진다 — Claude Code 는 훅을 프로젝트 루트에서 부른다.
 *
 * worktree 안에서는 이 값이 worktree 루트를 가리키는데, 그것이 맞다. 거기에는 **추적된
 * 파일만** 있고 `.claude/planner/` 는 A 의 저장소에 커밋되므로 사본에도 따라온다.
 */
function baseDirOf(hookInput) {
  return hookInput?.cwd ?? process.cwd();
}

function contextFor(value, baseDir) {
  if (value === "") return EXECUTOR;
  if (value === WORK_SESSION) return WORK + plannerDocs(baseDir);

  // 조용히 실행자로 떨어뜨리지 않는다. 오설정을 기본값으로 흡수하면 역할이 틀린 채로
  // 일이 굴러가고, 그 사실을 아무도 모른다.
  return (
    `\`HARNESS_ROLE\` 이 \`${value}\` 다 — 하네스가 아는 값이 아니다. ` +
    `**네가 실행자인지 작업 세션인지 판정할 수 없다.** 아는 값은 \`${WORK_SESSION}\`(작업 세션) ` +
    `또는 미설정(실행자)뿐이다. 일을 시작하기 전에 이 사실을 사람에게 알려라.`
  );
}

/**
 * `<baseDir>/.claude/planner/*.md` 를 파일명 순으로 모은다.
 *
 * 순서를 파일명에 맡기는 이유는 그것이 **설치한 쪽이 쥘 수 있는 유일한 손잡이**이기
 * 때문이다(`10-foo.md` · `20-bar.md`). 훅에 순서를 박으면 파일을 더할 때마다 훅을 고쳐야 한다.
 *
 * 디렉터리가 없거나 비어 있으면 빈 문자열이다 — **정당한 상태다.** 문서를 지우는 것이 곧
 * 이 기능을 끄는 방법이므로, 없다고 불평하면 끌 수가 없어진다.
 */
function plannerDocs(baseDir) {
  const dir = join(baseDir, PLANNER_DIR);

  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return "";
  }

  const docs = [];
  for (const name of names) {
    try {
      // 빈 파일은 구분선만 남긴다. 자리만 차지하므로 버린다.
      const body = readFileSync(join(dir, name), "utf8").trim();
      if (body) docs.push(body);
    } catch {
      // 한 파일을 못 읽었다고 나머지를 버리지 않는다. 있는 것만이라도 싣는 편이 낫다.
    }
  }

  if (docs.length === 0) return "";
  return `\n\n---\n\n${PLANNER_PREFACE}\n\n${docs.join("\n\n---\n\n")}`;
}
