/**
 * SubagentStop 훅의 공통 배선 — 판정 출력 · env 정화 · 재시도 상한.
 *
 * 이 하네스의 종료 훅은 전부 같은 모양이다: 객관 검사를 하나 돌리고, 실패하면 종료를
 * 거부해 같은 에이전트가 이어서 고치게 하고, 못 고치는 원인에서 영원히 갇히지 않도록
 * 상한을 둔다. 그 배선을 훅마다 복제하면 한쪽만 고쳐지고 나머지는 조용히 낡는다.
 *
 * **검사 자체는 여기 없다.** 무엇이 통과인지는 각 훅이 정한다.
 */

import { execFileSync, execSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

/**
 * 판정을 내보내고 종료한다. `payload` 가 없으면 아무 말 없이 통과시킨다.
 *
 * 판정은 **stdout 의 JSON 하나로만** 전달한다. 종료 코드로 하지 않는다:
 * `exit 1` 은 *non-blocking* error 라 사용자에게 메시지만 찍히고 **에이전트는 그대로
 * 끝난다** — 훅이 도는데 아무것도 막지 못하는 상태가 된다. 차단은 `exit 0` + JSON,
 * 또는 `exit 2` + stderr 뿐이다.
 *
 * `console.log` 는 파이프로 나갈 때 비동기라 곧바로 `process.exit` 하면 잘릴 수 있다.
 * 판정이 잘려 나가면 파싱할 JSON 이 없다고 보고 종료가 허용된다. 동기 write 로 고정한다.
 */
export function emit(payload) {
  if (payload) writeSync(1, JSON.stringify(payload));
  process.exit(0);
}

/**
 * 상속된 `GIT_*` 를 전부 씻어낸 env.
 *
 * `GIT_DIR` 이 설정돼 있으면 git 은 cwd 에서 위로 올라가며 저장소를 찾는 탐색을 통째로
 * 건너뛰고 그 값을 쓴다. `git -C <dir>` 도 `cwd` 도 이것을 이기지 못한다 — 임시
 * 디렉터리를 겨냥한 것처럼 보이는 명령이 실제로는 다른 저장소를 건드린다.
 *
 * 훅은 자식 프로세스를 띄우는 지점이라 오염을 **전파한다.** 자식을 띄우는 쪽이 매번 씻는다.
 */
export function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  // 훅 출력은 사람이 아니라 모델이 읽는다. ANSI 색상은 읽는 데 도움이 안 되면서
  // `reason` 의 길이만 늘린다.
  env.NO_COLOR = "1";
  return env;
}

/** 훅 입력(JSON on stdin). 없거나 깨져도 판정 자체는 계속되어야 한다. */
export function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

/**
 * 카운터는 **이 트리의 gitdir** 에 둔다. 링크된 worktree 의 `--absolute-git-dir` 은
 * `<main>/.git/worktrees/<id>` 라 에이전트마다 자연히 격리되고, worktree 가 사라질 때
 * 함께 사라진다. 추적되지도 않는다.
 */
function counterPath(name, env) {
  try {
    const gitDir = execSync("git rev-parse --absolute-git-dir", {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return gitDir ? join(gitDir, `harness-${name}-attempts`) : null;
  } catch {
    return null;
  }
}

/**
 * 재시도 예산. 무조건 차단하면 에이전트가 못 고치는 원인(외부 의존성, spec 자체의 모순)에서
 * 무한 루프에 빠지므로, 실패 횟수를 세고 상한을 넘으면 차단을 푼다.
 *
 * 카운터를 쓸 수 없으면(git 저장소가 아니거나 쓰기 실패) 훅 입력의 `stop_hook_active` 로
 * 대체한다 — 재시도가 1회로 줄지만, 상한이 아예 없는 것보다는 낫다.
 */
export function retryBudget(name, { env, input, max }) {
  const path = counterPath(name, env);

  return {
    /** 실패를 한 번 기록하고 남은 여유를 판정한다. */
    record() {
      const count = bump(path);
      return {
        count,
        exhausted: count === null ? input.stop_hook_active === true : count >= max,
        lastChance: count === null || max - count <= 1,
      };
    },

    /** 통과했으니 지운다. 남겨두면 다음 실패가 남은 횟수를 물려받는다. */
    reset() {
      if (!path) return;
      try {
        rmSync(path, { force: true });
      } catch {
        /* 카운터 정리 실패가 통과 판정을 뒤집어서는 안 된다. */
      }
    },
  };
}

/**
 * 역할의 산출물을 커밋해 **인계 지점**을 만든다.
 *
 * worktree 는 커밋된 상태만 밖으로 보인다. 그런데 커밋할 수 있는 자리가 여기밖에 없다:
 *
 * - `developer`·`qa` 에는 Bash 가 없다 — 층 0(도구 화이트리스트)이 의도적으로 뺀 것이다.
 * - 작업 세션은 `EnterWorktree` 격리 안에 있어 `git -C <역할 worktree>` 로 **밖을
 *   겨냥할 수 없다.** 격리가 주는 이득의 대가이고, 회수는 정확히 밖을 겨냥하는 동작이다.
 *
 * 훅은 양쪽 제약을 다 비껴간다. 도구 화이트리스트 밖의 node 프로세스이고, 역할의
 * worktree 를 cwd 로 돈다 — `verify-green` 이 거기서 `npm test` 를 돌리는 것과 같은 자리다.
 *
 * **판정을 뒤집지 않는다.** 커밋이 실패해도 종료를 막지 않는다 — 역할에는 git 을 고칠
 * 수단이 없어서 되돌려 봐야 같은 자리에서 다시 실패한다. 대신 `notice` 로 알린다.
 * 조용히 실패하면 산출물이 worktree 와 함께 사라지고 아무도 모른다.
 */
export function handoff(role, { env }) {
  const run = (args) =>
    execFileSync("git", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  try {
    // 부분 스테이징을 하지 않는다 — 검사한 트리와 커밋되는 내용이 어긋나면 안 된다.
    run(["add", "-A"]);
  } catch (error) {
    return failedHandoff(role, error);
  }

  try {
    run(["diff", "--cached", "--quiet"]);
    // 종료 코드 0 = 차이 없음. 빈 커밋은 인계가 아니다.
    return {
      committed: false,
      sha: null,
      notice: `${role} 가 변경 없이 끝났다 — 인계할 산출물이 없다. 회수할 것이 없으니 확인이 필요하다.`,
    };
  } catch {
    /* 종료 코드 1 = 차이 있음. 커밋으로 간다. */
  }

  try {
    run(["commit", "-m", `chore(${role}): 산출물을 인계 커밋으로 남긴다`, "-m", HANDOFF_BODY]);
  } catch (error) {
    return failedHandoff(role, error);
  }

  let sha = null;
  try {
    sha = run(["rev-parse", "--short", "HEAD"]).trim();
  } catch {
    /* sha 를 못 읽었을 뿐 커밋은 됐다. 인계 자체는 성립한다. */
  }

  return { committed: true, sha, notice: null };
}

const HANDOFF_BODY =
  "종료 훅이 자동으로 만든 커밋이다. 역할에는 Bash 가 없고 작업 세션은 worktree 격리 밖을\n" +
  "겨냥할 수 없어, 산출물을 커밋할 수 있는 자리가 종료 훅뿐이다.\n" +
  "\n" +
  "무엇을 왜 바꿨는지는 오케스트레이터의 머지 커밋에 적힌다.";

function failedHandoff(role, error) {
  const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error);
  return {
    committed: false,
    sha: null,
    notice:
      `${role} 산출물을 커밋하지 못했다 — 이 worktree 에는 회수할 커밋이 없다. ` +
      `지우기 전에 손으로 건져야 한다.\n${detail.slice(-1000)}`,
  };
}

function bump(path) {
  if (!path) return null;
  let count = 0;
  try {
    count = Number.parseInt(readFileSync(path, "utf8"), 10) || 0;
  } catch {
    count = 0;
  }
  count += 1;
  try {
    writeFileSync(path, String(count));
  } catch {
    return null;
  }
  return count;
}
