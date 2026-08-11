#!/usr/bin/env node
/**
 * 층 1 — `PreToolUse(Edit|Write)`. **경로 소유권**을 강제한다.
 *
 * 자리마다 만질 수 있는 곳이 정해져 있는데, 지금까지 그것을 지키는 것은 규율뿐이었다.
 * 실제로 샌 적이 있다 — 실행자가 작업 세션 노릇을 하며 spec 을 쓰고 코드를 회수했다.
 *
 * ## 누구인지 어떻게 아는가
 *
 * 훅 입력의 **`agent_type` 이 먼저다.** 서브에이전트는 세션의 env 를 물려받으므로
 * `HARNESS_ROLE` 만 보면 `developer` 가 작업 세션으로 오인된다. `agent_type` 이 있으면
 * 그것이 자리이고, 없을 때만 `HARNESS_ROLE` 을 본다(미설정 = 실행자).
 *
 * ## deny 와 ask 를 가르는 기준
 *
 * `PreToolUse` 에는 `--no-verify` 가 없다. 잘못 막으면 **갇힌다.** 그래서:
 *
 * - **사람이 붙어 있고 정당한 예외가 있는 경로** → `ask`. 작업 세션이 머지 충돌을 풀려면
 *   소스를 만져야 하는데, 그건 규약이 상정하지 않은 정당한 필요다. 사람이 판단한다.
 * - **그 외** → `deny`. 서브에이전트에는 물어볼 사람이 없고, 실행자가 코드를 고치는 것은
 *   예외를 둘 이유가 없다 — 작업 세션을 띄우면 된다.
 *
 * ## 허용은 어떻게 답하는가 — 같은 기준이 여기에도 걸린다
 *
 * - **사람이 붙어 있는 자리**(실행자·작업 세션) → `defer`. `allow` 로 답하면 사용자의
 *   permission 설정을 건너뛴다. 이 훅이 답할 것은 '이 자리가 만져도 되는 경로인가' 뿐이다.
 * - **사람이 없는 자리**(`developer`·`qa`) → `allow`. `defer` 는 '결정하지 않음' 이라
 *   정상 권한 흐름으로 넘어가는데, 거기서 승인 프롬프트가 뜨면 **답할 사람이 없어
 *   서브에이전트가 그 자리에서 멈춘다.**
 *
 * 멈추는 것은 끝나는 것과 다르다. `SubagentStop` 이 돌지 않으므로 게이트도, 인계 커밋도,
 * `systemMessage` 도 없다 — 부모가 받는 것은 base 그대로인 브랜치와 빈 worktree 뿐이고
 * 무엇이 잘못됐는지 알 방법이 없다. 실측으로 그렇게 죽었다.
 *
 * `ask` 를 서브에이전트에 쓰지 않는 이유와 같은 이유다. **`defer` 도 결국 프롬프트로
 * 떨어질 수 있다**는 것이 빠져 있었다.
 */

import { relative, resolve } from "node:path";
import { loadConfig } from "./harness-config.mjs";
import { emit, readHookInput } from "./hook-kit.mjs";

/**
 * 자리별 규칙을 **설정에서** 짓는다. `deny`·`ask` 는 막을 경로, `only` 는 **그것 말고
 * 전부 막는다**.
 *
 * 실행자는 하네스가 본업이라 금지 목록이 짧고, `qa` 는 산출물이 하나뿐이라 허용 목록이
 * 짧다 — 짧은 쪽으로 적어야 규칙이 실재와 어긋나지 않는다.
 *
 * `unattended` 는 **그 자리에 사람이 없다**는 뜻이다. 프롬프트가 떠도 답할 사람이 없으므로
 * 허용을 `defer` 가 아니라 `allow` 로 확정한다(위 머리주석 참고).
 *
 * `harnessFiles` 에 드는 기준은 하나다 — **고치면 하네스의 동작이 바뀌는가.** 훅은 강제를,
 * 에이전트 정의는 권한을, 게이트 설정은 검증을 정의한다. `developer` 가 `verify-green.mjs`
 * 를 만질 수 있으면 자기 게이트를 끌 수 있다.
 *
 * **하네스에 *대한* 산문은 여기 들지 않는다**(`README.md` · `docs/**`). 고쳐도 강제되는
 * 것은 하나도 안 바뀐다. 누가 쓰느냐는 규약이 정할 문제지 층이 정할 문제가 아니다.
 */
function rulesFor({ source, harnessFiles, specRoot }) {
  const spec = `${specRoot}/**`;

  return {
    실행자: {
      deny: [
        { paths: source, why: "저장소 코드는 작업 세션의 몫이다. `scripts/spawn.ps1 \"<원문>\"` 으로 띄워라 — 오타·리팩터도 마찬가지다." },
        { paths: [spec], why: "spec 과 QA 체크리스트는 작업 세션·qa 의 산출물이다." },
      ],
    },
    "작업 세션": {
      deny: [
        { paths: harnessFiles, why: "하네스는 실행자 자리다. 맨몸 `claude` 세션에서 고쳐라." },
      ],
      ask: [
        { paths: source, why: "소스는 역할이 자기 사본에서 고치고 너는 커밋·머지만 한다. 머지 충돌을 푸는 경우라면 사람이 승인해야 한다." },
      ],
    },
    developer: {
      unattended: true,
      deny: [
        { paths: [spec], why: "spec 은 기획자, 체크리스트는 qa 의 것이다. 틀렸다고 판단되면 고치지 말고 보고하라." },
        { paths: harnessFiles, why: "하네스와 게이트 정의는 이 자리에서 만지지 않는다." },
      ],
    },
    qa: {
      unattended: true,
      only: { paths: [`${specRoot}/**/qa-checklist.md`], why: "qa 의 산출물은 체크리스트 하나다. 코드도 spec 도 고치지 않는다." },
    },
  };
}

const input = readHookInput();
const decision = decide(input);

emit({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: decision.verdict,
    ...(decision.why ? { permissionDecisionReason: decision.why } : {}),
  },
});

function decide(hookInput) {
  const path = repoRelative(hookInput);
  if (!path) return { verdict: "defer" }; // 경로가 없거나 저장소 밖이다.

  const seat = seatOf(hookInput);
  // 설정은 판정 대상 경로를 재는 기준과 같은 트리에서 읽는다.
  const rules = rulesFor(loadConfig(hookInput.cwd))[seat];
  if (!rules) return { verdict: "defer" }; // 모르는 자리 — 판정하지 않는다.

  for (const rule of rules.deny ?? []) {
    if (rule.paths.some((p) => matches(p, path))) {
      return { verdict: "deny", why: `${seat} 는 \`${path}\` 를 만들거나 고칠 수 없다. ${rule.why}` };
    }
  }

  for (const rule of rules.ask ?? []) {
    if (rule.paths.some((p) => matches(p, path))) {
      return { verdict: "ask", why: `${seat} 가 \`${path}\` 를 고치려 한다. ${rule.why}` };
    }
  }

  if (rules.only && !rules.only.paths.some((p) => matches(p, path))) {
    return { verdict: "deny", why: `${seat} 는 \`${path}\` 를 만들거나 고칠 수 없다. ${rules.only.why}` };
  }

  // 이 자리가 만져도 되는 경로다. 사람이 없는 자리에서는 여기서 확정해야 한다 —
  // `defer` 로 넘기면 승인 프롬프트에서 멈출 수 있고, 그러면 종료 훅조차 돌지 않는다.
  if (rules.unattended) {
    return { verdict: "allow", why: `${seat} 의 소유 경로다.` };
  }

  return { verdict: "defer" };
}

/**
 * 자리 판정. **`agent_type` 이 `HARNESS_ROLE` 을 이긴다** — 서브에이전트는 세션의 env 를
 * 그대로 물려받기 때문이다.
 */
function seatOf({ agent_type: agentType }) {
  if (agentType) return agentType; // developer·qa 외의 에이전트는 RULES 에 없어 defer 된다.

  const role = (process.env.HARNESS_ROLE ?? "").trim();
  if (role === "") return "실행자";
  if (role === "work-session") return "작업 세션";
  return null; // 오설정 — session-role 훅이 이미 알린다. 여기서 또 막지 않는다.
}

/** 편집 대상의 저장소 상대 경로. 밖이면 `null`. */
function repoRelative({ tool_input: toolInput, cwd }) {
  const filePath = toolInput?.file_path;
  if (!filePath || !cwd) return null;

  const rel = relative(resolve(cwd), resolve(filePath)).replaceAll("\\", "/");
  if (!rel || rel.startsWith("../")) return null; // 저장소 밖 — 우리 관할이 아니다.
  return rel;
}

/**
 * `dir/**` · `**\/name` · 정확한 파일명만 쓰는 최소 글롭.
 *
 * **한 번의 스캔으로 바꾼다.** 순차 치환하면 앞선 치환이 만든 정규식 메타문자를 뒤의
 * 치환이 또 건드린다 — `**` → `.*` 로 바꾼 뒤 `*` 를 `[^/]*` 로 바꾸면 `.[^/]*` 가 되어
 * 디렉터리 경계를 못 넘는다.
 */
function matches(pattern, path) {
  const source = pattern.replace(
    /(\*\*\/)|(\*\*)|(\*)|([.+^${}()|[\]\\])/g,
    (_, dirPrefix, deep, single, special) => {
      if (dirPrefix) return "(?:.*/)?";
      if (deep) return ".*";
      if (single) return "[^/]*";
      return `\\${special}`;
    },
  );
  return new RegExp(`^${source}$`).test(path);
}
