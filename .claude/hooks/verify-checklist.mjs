#!/usr/bin/env node
/**
 * SubagentStop 훅 — qa 는 근거 없는 표를 남기고 끝낼 수 없다.
 *
 * qa 의 산출물은 `<specRoot>/<task>/qa-checklist.md` 하나이고, 그것을 읽는 것은 사람이다
 * (`specRoot` 는 `harness.config.json` 이 정한다 — 기본값 `harness`).
 * QA 는 비차단(조언)이라 아무것도 막지 않으므로, **표가 틀려도 알려주는 장치가 없다.**
 * 그래서 최소한의 형태만 여기서 잡는다.
 *
 * 특히 **근거 없는 `✅`** 를 잡는다. 초록 행은 사람이 다시 보지 않으므로, 잘못된 통과는
 * 소음이 아니라 침묵이 된다 — QA 가 고무도장이 되는 유일한 경로가 이것이다. 인용이
 * *맞는지*는 판정할 수 없지만, **있는지**는 확실히 안다.
 *
 * spec 쪽의 `spec-shape.mjs` 와 같은 것을 본다 — 빈손이거나 인계될 수 없는 모양인가. 다만
 * 서는 자리가 다르다: spec 은 커밋이 곧 인계라 `pre-commit` 이 인덱스를 읽고, 체크리스트는
 * 종료 훅이 커밋을 만들기 **전**이라 여기서 워킹트리를 읽는다.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadConfig } from "./harness-config.mjs";
import { cleanEnv, emit, handoff, readHookInput, retryBudget } from "./hook-kit.mjs";

/** 이 훅은 qa 의 worktree 를 cwd 로 돈다 — 산출물도 설정도 그 트리의 것이다. */
const { specRoot } = loadConfig(process.cwd());

/** 인계 커밋에 이름을 남길 역할. 오케스트레이터가 로그에서 출처를 읽는다. */
const ROLE = "qa";

/** qa 는 쓰거나(체크리스트) 못 쓰거나(spec 없음) 둘 중 하나다. 한 번 되짚어 주면 충분하다. */
const MAX_ATTEMPTS = 2;

/** 근거를 요구하지 않는 유일한 판정 — 아무것도 없다는 주장에는 인용할 것이 없다. */
const NEEDS_EVIDENCE = /✅|△|❌[^|]*구현\s*있음/;

/**
 * 이번 세션이 건드린 체크리스트.
 *
 * `-uall` 이 필수다. 기본값은 추적되지 않는 디렉터리를 접어서 `?? harness/` 한 줄로만
 * 보여주므로, `harness/` 가 통째로 새로 생긴 경우 그 안의 파일이 목록에 없다.
 */
function changedChecklists(env) {
  let out;
  try {
    out = execSync(`git status --porcelain -z -uall -- ${specRoot}/`, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // git 을 못 쓴다 — 판정 불가
  }

  return out
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .filter((path) => path.endsWith("qa-checklist.md"));
}

/** `| a | b | c |` → `["a", "b", "c"]`. 표 행이 아니면 `null`. */
function cells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** `—`, `-`, 공백만 있으면 비어 있는 것으로 본다. */
function isBlank(cell) {
  return !cell || /^[—\-–\s]*$/.test(cell);
}

/**
 * 근거 없는 판정을 찾는다.
 *
 * 표의 열 구성을 강제하지는 않는다 — 헤더에서 '판정'·'근거' 를 못 찾으면 이 검사를
 * 건너뛴다. 형식을 못 알아본 것과 위반을 찾은 것은 다르고, 전자로 종료를 막으면
 * 표 모양을 조금 바꿨다는 이유로 qa 가 갇힌다.
 */
function unevidencedRows(text) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const row = cells(line);
    return row?.some((c) => c.includes("판정")) && row?.some((c) => c.includes("근거"));
  });
  if (headerIndex === -1) return [];

  const header = cells(lines[headerIndex]);
  const verdictAt = header.findIndex((c) => c.includes("판정"));
  const evidenceAt = header.findIndex((c) => c.includes("근거"));

  const offenders = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const row = cells(line);
    if (!row || row.length <= Math.max(verdictAt, evidenceAt)) continue;
    if (row.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 구분선

    const verdict = row[verdictAt];
    if (!NEEDS_EVIDENCE.test(verdict)) continue;
    if (isBlank(row[evidenceAt])) offenders.push(`${verdict} — ${row[0] || "(이름 없는 행)"}`);
  }
  return offenders;
}

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
    } else if (!lines.slice(1, close).some((line) => /^spec:\s*\S/.test(line))) {
      problems.push(
        `\`${path}\`: frontmatter 에 \`spec: ${specRoot}/<task>/spec.md\` 가 없다 — ` +
          `무엇을 대조한 표인지 남아야 한다.`,
      );
    }
  }

  if (!/^\|.*판정.*\|/m.test(text)) {
    problems.push(`\`${path}\`: 커버리지 매트릭스가 없다 — \`판정\` 열이 있는 표가 있어야 한다.`);
  }

  const unevidenced = unevidencedRows(text);
  if (unevidenced.length > 0) {
    problems.push(
      `\`${path}\`: 근거 없이 판정한 행이 ${unevidenced.length}개 있다. ` +
        `인용하지 못하면 한 단계 내려라 — 과소평가는 사람이 바로잡지만 과대평가는 그대로 통과한다.\n` +
        unevidenced.map((row) => `    · ${row}`).join("\n"),
    );
  }

  return problems;
}

const env = cleanEnv();
const input = readHookInput();
const budget = retryBudget("verify-checklist", { env, input, max: MAX_ATTEMPTS });

const checklists = changedChecklists(env);

// 확인하지 않은 것을 '없다' 로 적으면 틀린 신호가 된다.
if (checklists === null) emit(null);

const problems =
  checklists.length === 0
    ? [
        `이번에 쓴 \`${specRoot}/<task>/qa-checklist.md\` 가 없다. ` +
          "체크리스트는 네 유일한 산출물이고, 없으면 사람이 볼 것이 없다.",
      ]
    : checklists.flatMap(problemsIn);

if (problems.length === 0) {
  budget.reset();
  // 검사를 통과한 체크리스트를 그 자리에서 커밋으로 굳힌다. qa 에도 Bash 가 없어
  // 이 지점을 놓치면 표가 worktree 와 함께 사라진다.
  const { notice } = handoff(ROLE, { env });
  emit(notice ? { systemMessage: notice } : null);
}

const { count, exhausted } = budget.record();

if (exhausted) {
  // 표가 없어도 커밋은 시도한다. qa 가 다른 무언가는 남겼을 수 있고, 없으면 handoff 가
  // '인계할 산출물이 없다' 를 돌려준다 — 확인해야 할 사실은 그쪽도 마찬가지다.
  const { notice } = handoff(ROLE, { env });

  // spec 이 없어 대조할 것이 없는 경우가 있다. 그때 여기서 갇히면 안 된다.
  emit({
    systemMessage:
      `체크리스트 없이 종료를 허용했다(재시도 ${count ?? "?"}회 소진). ` +
      `이 QA 는 회수할 산출물이 없다 — spec 이 있었는지 확인하라.` +
      (notice ? `\n${notice}` : ""),
  });
}

emit({
  decision: "block",
  reason:
    `아직 끝난 것이 아니다. 아래를 처리하고 다시 끝내라.\n\n` +
    problems.map((p) => `- ${p}`).join("\n") +
    `\n\n대조할 spec 자체가 없어 표를 쓸 수 없는 상황이라면, ` +
    `그 사실을 보고에 적고 그대로 다시 끝내라 — 다음에는 통과된다.`,
});
