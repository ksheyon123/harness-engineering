#!/usr/bin/env node
/**
 * SubagentStop 훅 — planner 는 spec 을 남기지 않고 끝낼 수 없다.
 *
 * planner 의 산출물은 `harness/<task>/spec.md` 하나다. 그것이 없으면 뒤따르는 모든
 * 단계가 무너진다 — developer 는 요구사항 출처가 없고, qa 는 대조할 기준이 없다.
 * "spec 없이 코드가 쓰이지 않는다"는 불변식의 앞단이 여기다.
 *
 * **무엇이 좋은 spec 인가는 판정하지 않는다.** 그것은 사람과 QA 의 몫이다. 이 훅은
 * 기계가 확실히 아는 것만 본다 — 파일이 있는가, 인계될 수 있는 모양인가.
 *
 * planner 는 Bash 가 없어 커밋할 수 없으므로, 산출물은 항상 워킹트리의 미커밋 변경으로
 * 나타난다. 그래서 `git status` 가 곧 '이번에 무엇을 썼는가' 다.
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
