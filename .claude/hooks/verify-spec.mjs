#!/usr/bin/env node
/**
 * spec 이 인계될 수 있는 모양인지 본다.
 *
 * **지금 이 훅은 아무 데도 걸려 있지 않다.** planner 가 서브에이전트였을 때의
 * `SubagentStop` 훅인데, 기획자가 세션 모드가 되면서 그 배선이 사라졌다 — 세션에는
 * `SubagentStop` 이 걸리지 않는다. 판정 로직(`problemsIn`)을 `pre-commit` 으로 옮기기
 * 위해 남겨둔 것이고, 그 자리가 맞는 이유는 **커밋이 곧 인계**여서 누가 커밋하든 걸리기
 * 때문이다. 옮길 때까지는 테스트만 이 파일을 살아 있게 한다.
 *
 * spec 이 없거나 깨져 있으면 뒤따르는 모든 단계가 무너진다 — developer 는 요구사항
 * 출처가 없고, qa 는 대조할 기준이 없다. "spec 없이 코드가 쓰이지 않는다"는 불변식의
 * 앞단이 여기다.
 *
 * **무엇이 좋은 spec 인가는 판정하지 않는다.** 그것은 사람과 QA 의 몫이다. 이 훅은
 * 기계가 확실히 아는 것만 본다 — 파일이 있는가, 인계될 수 있는 모양인가.
 *
 * 산출물을 `git status` 로 찾는 것은 '이번에 무엇을 썼는가' 를 알기 위해서다.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cleanEnv, emit, readHookInput, retryBudget } from "./hook-kit.mjs";

/**
 * planner 는 쓰거나(spec 작성) 못 쓰거나(task 이름 미지정) 둘 중 하나다. 한 번 되짚어
 * 주면 충분하고, 그 이상은 못 쓸 이유가 있다는 뜻이다.
 */
const MAX_ATTEMPTS = 2;

/**
 * 이번 세션이 건드린 spec 파일들.
 *
 * `-uall` 이 필수다. 기본값(`normal`)은 추적되지 않는 **디렉터리를 접어서** 보여주므로,
 * `harness/` 자체가 새로 생긴 경우 `?? harness/` 한 줄만 나오고 그 안의 spec.md 는
 * 목록에 없다 — planner 가 제대로 썼는데도 '안 썼다' 로 판정하게 된다.
 *
 * git 을 쓸 수 없으면 `null`(판정 불가). 없는 것과 모르는 것은 다르다.
 */
function changedSpecs(env) {
  let out;
  try {
    out = execSync("git status --porcelain -z -uall -- harness/", {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }

  return out
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3)) // "XY <path>"
    .filter((path) => path.endsWith("spec.md"));
}

/** 인계될 수 있는 모양인가. 내용의 좋고 나쁨은 보지 않는다. */
function problemsIn(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [`\`${path}\` 를 읽을 수 없다.`];
  }

  if (!text.trim()) return [`\`${path}\` 가 비어 있다.`];

  const problems = [];
  const lines = text.split(/\r?\n/);

  if (lines[0] !== "---") {
    problems.push(`\`${path}\`: 첫 줄이 \`---\` 가 아니다 — frontmatter 가 없다.`);
  } else {
    const close = lines.indexOf("---", 1);
    if (close === -1) {
      problems.push(`\`${path}\`: frontmatter 를 닫는 \`---\` 가 없다.`);
    } else if (!lines.slice(1, close).some((line) => /^branch:\s*\S/.test(line))) {
      problems.push(
        `\`${path}\`: frontmatter 에 \`branch: <task 브랜치>\` 가 없다. ` +
          `네 worktree 의 난수 브랜치가 아니라 스폰 프롬프트가 알려준 task 브랜치를 적는다.`,
      );
    }
  }

  if (!/^##\s+기능 목록\s*$/m.test(text)) {
    problems.push(`\`${path}\`: \`## 기능 목록\` 절이 없다 — developer 가 읽을 것이 없다.`);
  }

  return problems;
}

const env = cleanEnv();
const input = readHookInput();
const budget = retryBudget("verify-spec", { env, input, max: MAX_ATTEMPTS });

const specs = changedSpecs(env);

// git 을 못 쓰면 판정하지 않는다. 확인하지 않은 것을 '없다' 로 적으면 틀린 신호가 된다.
if (specs === null) emit(null);

const problems =
  specs.length === 0
    ? [
        "이번에 쓴 `harness/<task>/spec.md` 가 없다. " +
          "spec 은 네 유일한 산출물이고, 없으면 developer 와 qa 가 시작할 수 없다.",
      ]
    : specs.flatMap(problemsIn);

if (problems.length === 0) {
  budget.reset();
  emit(null);
}

const { count, exhausted } = budget.record();

if (exhausted) {
  // 정당하게 못 쓰는 경우가 있다 — 스폰 프롬프트에 `<task>` 가 없으면 추측한 이름으로
  // 쓰는 것보다 안 쓰는 것이 맞다. 그때 여기서 갇히면 안 된다.
  emit({
    systemMessage:
      `spec 없이 종료를 허용했다(재시도 ${count ?? "?"}회 소진). ` +
      `이 planner 는 회수할 산출물이 없다 — 스폰 프롬프트에 \`<task>\` 가 있었는지 확인하라.`,
  });
}

emit({
  decision: "block",
  reason:
    `아직 끝난 것이 아니다. 아래를 처리하고 다시 끝내라.\n\n` +
    problems.map((p) => `- ${p}`).join("\n") +
    `\n\n정말로 쓸 수 없는 상황이라면(스폰 프롬프트에 \`<task>\` 이름이 없는 등) ` +
    `추측한 경로로 쓰지 말고, 그 사실을 보고에 적고 그대로 다시 끝내라 — 다음에는 통과된다.`,
});
