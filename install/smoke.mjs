#!/usr/bin/env node
/**
 * `harness smoke` — **배선이 살아 있는지** 묻는다. 서 있는 그 트리에 대고.
 *
 * ## `doctor` 와 무엇이 다른가
 *
 * `doctor` 는 **값**을 본다 — `harness.config.json` 의 키와 타입, 설치본의 버전. 값이 다
 * 멀쩡해도 훅이 안 불릴 수 있고, 그때 doctor 는 아무 말도 하지 않는다.
 *
 * 여기가 보는 것은 **배선**이다: `settings.json` 의 명령이 실재하는 파일을 가리키는가,
 * 그 파일이 실제로 돌아 판정을 내놓는가, git 이 그것을 추적하는가(추적되지 않으면
 * worktree 사본에 복사되지 않아 **거기서 하네스가 통째로 사라진다**).
 *
 * ## 그래도 자동으로 답할 수 없는 것이 남는다
 *
 * 이 명령이 증명하는 것은 **"부르면 도는가"** 까지다. **"Claude Code 가 실제로 부르는가"**
 * 는 세션을 띄워야만 안다 — 훅 배선을 읽는 주체가 우리 프로세스가 아니기 때문이다.
 * `isolation: worktree` 와 frontmatter `SubagentStop` 은 비대화형(`claude -p`)에서 아예
 * 안 걸리는 것으로 실측됐으므로, 스크립트로 감쌀 수도 없다.
 *
 * 그래서 이 명령은 **두 몫으로 갈라 보고한다** — 여기서 판정한 것과, 사람이 세션에서
 * 확인해야 하는 것. 후자를 문서 어딘가에 적어두지 않고 여기서 같이 찍는 이유는,
 * **떨어져 있으면 낡기 때문**이다. 자동 검사가 늘면 목록에서 빠지는 것도 여기서 빠진다.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../.claude/hooks/harness-config.mjs";
import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";

const OK = "ok";
const BROKEN = "broken";
const UNKNOWN = "unknown";

/** `permissionDecision` 이 가질 수 있는 값. 넷 중 하나가 아니면 층 1 이 판정을 못 낸 것이다. */
const DECISIONS = ["allow", "deny", "ask", "defer"];

/**
 * 사람이 세션에서만 확인할 수 있는 것들.
 *
 * **`command` 는 붙여 넣으면 그대로 도는 것**이고, `expect` 는 **무엇이 보이면 통과인가**다.
 * "확인한다" 같은 말을 적지 않는다 — 판정 기준이 없는 항목은 아무도 안 돌린다.
 */
export const PROBES = [
  {
    name: "SessionStart 가 역할을 싣는가",
    command: `claude   (맨몸으로 연 뒤)  "너는 누구지? 한 줄로."`,
    expect: "**실행자**라고 답한다. '모르겠다'거나 일반 어시스턴트로 답하면 훅이 안 불린 것이다.",
  },
  {
    name: "층 1 이 실제로 도구를 막는가",
    command: `claude   (같은 세션에서)  "src 아래 아무 파일이나 한 줄 고쳐봐."`,
    expect: "거부되고 그 이유에 `harness spawn` 안내가 뜬다. 그냥 고쳐지면 PreToolUse 배선이 죽은 것이다.",
  },
  {
    name: "`spawn` 이 다른 프로세스를 띄우는가",
    command: `harness spawn "이 저장소 뭐 하는 거야"`,
    expect:
      "새 탭(없으면 새 창)이 뜨고, 거기서 `너는 누구지?` 에 **작업 세션**이라고 답한다. " +
      "실행자라고 답하면 `HARNESS_ROLE` 이 자식에 안 심긴 것이다.",
  },
  {
    name: "서브에이전트가 격리된 사본을 얻는가",
    command: `작업 세션에서 developer 를 하나 스폰한 뒤:  git worktree list`,
    expect:
      "`.claude/worktrees/agent-<hex>` 가 하나 늘어 있다. 안 늘면 `isolation: worktree` 가 " +
      "안 걸린 것이고, 그러면 그 에이전트는 네 트리를 직접 고치고 있다.",
  },
  {
    name: "종료 훅이 게이트를 걸고 인계 커밋을 찍는가",
    command: `git branch --list 'worktree-agent-*' --contains <내 spec 커밋 sha>\ngit show <나온 브랜치>`,
    expect:
      "`chore(developer): 산출물을 인계 커밋으로 남긴다` 가 보인다. 브랜치가 base 그대로면 " +
      "SubagentStop 이 안 돈 것이고, **회수할 것이 없다.**",
  },
  {
    name: "층 2 가 검증 안 된 push 를 막는가",
    command: `git commit --allow-empty -m "chore: smoke"  후  git push`,
    expect: "게이트 기록이 없다며 거부된다. 그냥 올라가면 `pre-push` 나 `posttest` 배선이 죽은 것이다.",
  },
];

/**
 * 배선을 검사한다. **파일을 건드리지 않고, 게이트도 돌리지 않는다.**
 *
 * @param {string} tree 검사할 저장소의 최상단
 * @param {(args: string[]) => string} git `tree` 를 겨냥한 git 러너
 * @returns {{checks: {name: string, state: string, detail: string}[]}}
 */
export function inspect(tree, git) {
  const config = loadConfig(tree);
  const tracked = trackedSet(tree, git);
  const settings = readJson(join(tree, ".claude/settings.json"));

  const checks = [
    layerOne(tree, settings, config),
    sessionHook(tree, settings),
    ...exitGates(tree),
    layerTwo(tree, git),
    baseRef(settings),
    contract(tree),
    gateTarget(tree, config),
    gateRecord(tree),
    ignored(tree),
    trackedForWorktrees(tree, tracked),
  ];

  return { checks: checks.filter(Boolean) };
}

/* ── 층 1 ─────────────────────────────────────────────────────────────────── */

function layerOne(tree, settings, config) {
  const name = "층 1 — PreToolUse(Edit|Write) 가 경로 소유권을 판정한다";
  const entry = (settings?.hooks?.PreToolUse ?? []).find((e) =>
    (e.hooks ?? []).some((h) => (h.command ?? "").includes("path-ownership.mjs")),
  );

  if (!entry) {
    return broken(name, "`settings.json` 에 배선이 없다 — 아무 경로도 지켜지지 않는다.");
  }

  // 매처가 좁으면 **한쪽 도구만** 막힌다. `Write` 가 빠지면 새 파일 생성이 전부 통과한다.
  const matcher = entry.matcher ?? "";
  const uncovered = ["Edit", "Write"].filter((tool) => !safeMatch(matcher, tool));
  if (uncovered.length > 0) {
    return broken(name, `matcher \`${matcher}\` 가 ${uncovered.join(" · ")} 를 안 잡는다.`);
  }

  const path = hookPathIn(entry.hooks.find((h) => (h.command ?? "").includes("path-ownership.mjs")).command);
  if (!path) return broken(name, "명령에서 `${CLAUDE_PROJECT_DIR}` 기준 경로를 못 읽었다.");

  // 실제로 돌려본다. shim 이면 이 한 번이 **패키지 해석까지** 검증한다.
  let verdict;
  try {
    verdict = runHook(tree, path, {
      hook_event_name: "PreToolUse",
      cwd: tree,
      tool_input: { file_path: join(tree, config.specRoot, "smoke", "spec.md") },
    });
  } catch (error) {
    return broken(name, `\`${path}\` 를 돌리지 못했다 — ${firstLine(error)}`);
  }

  const decision = verdict?.hookSpecificOutput?.permissionDecision;
  if (!DECISIONS.includes(decision)) {
    return broken(name, `\`${path}\` 가 판정을 안 냈다 (받은 것: ${JSON.stringify(decision)}).`);
  }

  return ok(name, `\`${path}\` 가 \`${decision}\` 를 냈다.`);
}

/* ── 세션 훅 ───────────────────────────────────────────────────────────────── */

function sessionHook(tree, settings) {
  const name = "세션 훅 — SessionStart 가 역할을 주입한다";
  const command = (settings?.hooks?.SessionStart ?? [])
    .flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? ""))
    .find((c) => c.includes("session-role.mjs"));

  if (!command) {
    return broken(name, "`settings.json` 에 배선이 없다 — 세션이 자기 역할을 모른 채 시작한다.");
  }

  const path = hookPathIn(command);
  if (!path) return broken(name, "명령에서 `${CLAUDE_PROJECT_DIR}` 기준 경로를 못 읽었다.");

  // 두 값을 다 물어본다. 하나만 보면 "무엇을 주든 같은 문장" 인 상태를 못 잡는데,
  // 그건 역할 구분이 통째로 사라진 것과 같다.
  let executor;
  let work;
  try {
    const input = { hook_event_name: "SessionStart", cwd: tree };
    executor = runHook(tree, path, input, { HARNESS_ROLE: "" });
    work = runHook(tree, path, input, { HARNESS_ROLE: "work-session" });
  } catch (error) {
    return broken(name, `\`${path}\` 를 돌리지 못했다 — ${firstLine(error)}`);
  }

  const a = executor?.hookSpecificOutput?.additionalContext;
  const b = work?.hookSpecificOutput?.additionalContext;

  if (!a || !b) return broken(name, `\`${path}\` 가 \`additionalContext\` 를 안 냈다.`);
  if (a === b) {
    return broken(name, "`HARNESS_ROLE` 을 바꿔도 같은 문장이 나온다 — 역할이 갈리지 않는다.");
  }

  return ok(name, `\`${path}\` 가 실행자·작업 세션을 다르게 선언한다.`);
}

/* ── 종료 게이트 ───────────────────────────────────────────────────────────── */

/**
 * 역할의 `SubagentStop` 배선. **돌려보지 않는다** — `verify-green` 은 게이트를 돌리고
 * 인계 커밋을 찍는다. 검사하려다 저장소에 커밋을 남기는 것은 스모크가 할 일이 아니다.
 */
function exitGates(tree) {
  return [
    { role: "developer", hook: "verify-green.mjs" },
    { role: "qa", hook: "verify-checklist.mjs" },
  ].map(({ role, hook }) => {
    const name = `종료 게이트 — \`${role}\` 가 빈손으로 못 끝낸다`;
    const path = `.claude/agents/${role}.md`;
    const full = join(tree, path);

    if (!existsSync(full)) return broken(name, `\`${path}\` 가 없다 — 스폰 자체가 안 된다.`);

    const front = frontmatter(readFileSync(full, "utf8"));
    if (!/^\s*isolation:\s*worktree\s*$/m.test(front)) {
      return broken(name, `\`${path}\` 에 \`isolation: worktree\` 가 없다 — 네 트리에서 직접 돈다.`);
    }

    const wired = new RegExp(`command:\\s*node\\s+(\\S*${hook.replace(".", "\\.")})`).exec(front);
    if (!wired) return broken(name, `\`${path}\` 의 \`SubagentStop\` 이 \`${hook}\` 을 안 부른다.`);

    const target = wired[1];
    const loaded = loads(tree, target);
    if (!loaded.ok) return broken(name, `\`${target}\` 를 불러올 수 없다 — ${loaded.why}`);

    return ok(name, `\`${path}\` → \`${target}\``);
  });
}

/* ── 층 2 ─────────────────────────────────────────────────────────────────── */

function layerTwo(tree, git) {
  const name = "층 2 — git 훅이 붙어 있다";

  let hooksPath;
  try {
    hooksPath = git(["config", "--local", "--get", "core.hooksPath"]).trim();
  } catch {
    hooksPath = "";
  }

  if (!hooksPath) {
    return broken(name, "`core.hooksPath` 가 설정되지 않았다 — `.githooks/` 는 아무것도 아닌 디렉터리다.");
  }

  // **상대·절대 둘 다 정상이다.** `init` 은 `.githooks` 를 심고 이 저장소는 절대경로를
  // 쓴다(그래야 링크된 worktree 에서 커밋해도 본체의 훅이 불린다). 물어야 할 것은 표기가
  // 아니라 **어디를 가리키는가** 다.
  if (normalize(resolve(tree, hooksPath)) !== normalize(join(tree, ".githooks"))) {
    return broken(name, `\`core.hooksPath\` 가 \`${hooksPath}\` 다 — 이 하네스의 훅은 안 불린다.`);
  }

  const missing = [];
  const notExecutable = [];

  for (const entry of ["pre-commit", "pre-push"]) {
    const full = join(tree, ".githooks", entry);
    if (!existsSync(full)) {
      missing.push(entry);
      continue;
    }
    // Windows 에는 실행권한이 없어 이 판정 자체가 성립하지 않는다. POSIX 에서는 git 이
    // 실행권한 없는 훅을 **에러 없이 건너뛴다** — 층 2 가 통째로 사라지는데 신호가 없다.
    if (process.platform !== "win32" && (statSync(full).mode & 0o111) === 0) {
      notExecutable.push(entry);
    }
  }

  if (missing.length > 0) return broken(name, `\`.githooks/${missing.join("\` · \`")}\` 가 없다.`);
  if (notExecutable.length > 0) {
    return broken(
      name,
      `\`${notExecutable.join("\` · \`")}\` 에 실행권한이 없다 — git 이 **조용히 건너뛴다.** ` +
        `\`chmod +x .githooks/*\` 로 고친다.`,
    );
  }

  const judges = ["pre-commit.mjs", "pre-push.mjs"].map((entry) => ({
    entry,
    loaded: loads(tree, `.githooks/${entry}`),
  }));
  const dead = judges.filter((j) => !j.loaded.ok);
  if (dead.length > 0) {
    return broken(name, dead.map((j) => `\`${j.entry}\` — ${j.loaded.why}`).join(" · "));
  }

  return process.platform === "win32"
    ? unknown(name, "붙어 있다. **실행권한은 이 기계에서 잴 수 없다** — POSIX 에서 다시 확인해라.")
    : ok(name, "`pre-commit` · `pre-push` 가 실행 가능하고 판정 모듈도 살아 있다.");
}

/* ── 나머지 불변식 ─────────────────────────────────────────────────────────── */

function baseRef(settings) {
  const name = "회수 — 역할 브랜치가 내 `HEAD` 의 자손이 된다";
  const value = settings?.worktree?.baseRef;

  if (value === "head") return ok(name, "`worktree.baseRef` 가 `head` 다.");
  return broken(
    name,
    `\`worktree.baseRef\` 가 ${JSON.stringify(value)} 다 — \`"head"\` 여야 한다. ` +
      `아니면 \`--contains <spec 커밋>\` 조상 질의로 내 에이전트를 못 찾는다.`,
  );
}

function contract(tree) {
  const name = "규약 — 모든 세션이 `harness.md` 를 읽는다";
  const claudeMd = join(tree, ".claude/CLAUDE.md");

  if (!existsSync(join(tree, ".claude/harness.md"))) {
    return broken(name, "`.claude/harness.md` 가 없다 — 규약 본문이 통째로 빠져 있다.");
  }
  if (!existsSync(claudeMd)) return broken(name, "`.claude/CLAUDE.md` 가 없다 — 임포트할 자리가 없다.");

  const imports = readFileSync(claudeMd, "utf8")
    .split(/\r?\n/)
    .some((line) => line.trim() === "@harness.md");

  return imports
    ? ok(name, "`.claude/CLAUDE.md` 가 `@harness.md` 를 끌어온다.")
    : broken(name, "`.claude/CLAUDE.md` 에 `@harness.md` 가 없다 — 규약이 안 실린다.");
}

/**
 * 게이트가 부르는 것이 **실재하는가.**
 *
 * 설치 직후의 프로젝트가 정확히 이 자리에서 무너진다. `init` 은 테스트 러너를 설치하지도
 * `scripts.test` 를 만들지도 않는다(무엇을 검사할지는 A 가 정한다). 그래서 배선은 전부
 * 멀쩡한데 **돌릴 것이 없는** 상태가 만들어지는데, 지금까지 그것을 묻는 자리가 없었다 —
 * `gateRecord` 는 `posttest` 만 보므로 이 상태에서도 초록이다.
 *
 * 드러나는 시점이 최악이다: `developer` 를 스폰하고 나서야, 그 종료 훅이 재시도 상한을
 * 태운 뒤에야 보인다.
 *
 * **돌려보지는 않는다.** 게이트는 몇 분이고 `posttest` 가 marker 를 남긴다 — 검사하려다
 * 저장소에 흔적을 쓰는 것은 스모크가 할 일이 아니다(`exitGates` 와 같은 이유다).
 */
function gateTarget(tree, config) {
  const name = "게이트 — `verify-green` 이 돌릴 것이 있다";
  const script = npmScriptIn(config.gate);

  // npm 이 아닌 게이트는 여기서 답할 수 없다. **없는 것과 모르는 것은 다르다.**
  if (!script) {
    return unknown(
      name,
      `게이트가 \`${config.gate}\` 다 — npm 스크립트가 아니라 여기서는 판정할 수 없다. ` +
        `한 번 직접 돌려봐라.`,
    );
  }

  const path = join(tree, "package.json");
  if (!existsSync(path)) {
    return broken(name, `게이트가 \`${config.gate}\` 인데 \`package.json\` 이 없다.`);
  }

  const command = readJson(path)?.scripts?.[script];
  if (typeof command !== "string" || !command.trim()) {
    return broken(
      name,
      `\`scripts.${script}\` 가 없다 — \`${config.gate}\` 가 그 자리에서 죽는다. ` +
        `\`developer\` 는 종료 게이트를 **통과할 수 없어** 재시도 상한을 태우고 red 로 끝나고, ` +
        `\`${script}\` 가 없으면 \`posttest\` 도 불리지 않아 push 까지 막힌다.`,
    );
  }

  return ok(name, `\`${config.gate}\` → \`scripts.${script}\` = \`${command}\``);
}

/**
 * 게이트 명령이 부르는 npm 스크립트 이름. npm 이 아니면 `null`.
 *
 * 형태를 넓게 받지 않는다 — 못 읽은 것을 `unknown` 으로 넘기는 쪽이, 잘못 읽고 멀쩡한
 * 설정을 red 로 부르는 쪽보다 낫다.
 */
function npmScriptIn(gate) {
  const [runner, verb, target] = `${gate}`.trim().split(/\s+/);
  if (runner !== "npm") return null;
  if (verb === "test" || verb === "t") return "test";
  if (verb === "run" || verb === "run-script") return target ?? null;
  return null;
}

function gateRecord(tree) {
  const name = "게이트 기록 — `pre-push` 가 읽을 것이 남는다";
  const path = join(tree, "package.json");
  if (!existsSync(path)) return unknown(name, "`package.json` 이 없다 — `posttest` 배선을 확인할 수 없다.");

  const parsed = readJson(path);
  const posttest = parsed?.scripts?.posttest ?? "";

  return posttest.includes("mark-verified.mjs")
    ? ok(name, `\`posttest\` = \`${posttest}\``)
    : broken(
        name,
        posttest
          ? `\`posttest\` 에 \`${posttest}\` 만 걸려 있다 — \`mark-verified.mjs\` 를 이어 붙여라.`
          : "`posttest` 가 없다 — 게이트가 green 이어도 기록이 안 남아 push 가 전부 막힌다.",
      );
}

function ignored(tree) {
  const name = "사본이 커밋에 쓸려 들어가지 않는다";
  const path = join(tree, ".gitignore");
  const has =
    existsSync(path) &&
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .some((line) => line.trim() === ".claude/worktrees/");

  return has
    ? ok(name, "`.gitignore` 에 `.claude/worktrees/` 가 있다.")
    : broken(
        name,
        "`.gitignore` 에 `.claude/worktrees/` 가 없다 — `pre-commit` 이 `git add -A` 를 " +
          "강제하므로 커밋이 **에이전트 사본을 통째로 쓸어 담는다.**",
      );
}

/**
 * worktree 사본은 **추적되는 파일만** 본다. 하나라도 빠지면 거기서 그 조각이 사라지는데,
 * 사라지는 자리가 하필 `developer`·`qa` 가 도는 자리다.
 */
function trackedForWorktrees(tree, tracked) {
  const name = "worktree 안에서도 살아남는다 — 필요한 것이 전부 추적된다";
  if (tracked === null) return unknown(name, "git 을 못 써서 추적 여부를 확인하지 못했다.");

  const need = [
    ".claude/CLAUDE.md",
    ".claude/harness.md",
    ".claude/planner-mode.md",
    ".claude/settings.json",
    ".claude/agents/developer.md",
    ".claude/agents/qa.md",
    ".claude/hooks/path-ownership.mjs",
    ".claude/hooks/session-role.mjs",
    ".claude/hooks/verify-green.mjs",
    ".claude/hooks/verify-checklist.mjs",
    ".githooks/pre-commit",
    ".githooks/pre-push",
  ];

  const missing = need.filter((path) => !tracked.has(path));
  return missing.length === 0
    ? ok(name, `${need.length}개가 전부 추적된다.`)
    : broken(name, `추적되지 않는다: \`${missing.join("\` · \`")}\` — 사본에서는 없는 파일이다.`);
}

/* ── 도구 ─────────────────────────────────────────────────────────────────── */

const ok = (name, detail) => ({ name, state: OK, detail });
const broken = (name, detail) => ({ name, state: BROKEN, detail });
const unknown = (name, detail) => ({ name, state: UNKNOWN, detail });

/** `node "${CLAUDE_PROJECT_DIR}/<경로>"` 에서 경로만. */
function hookPathIn(command) {
  const found = /\$\{CLAUDE_PROJECT_DIR\}[/\\]([^"'\s]+)/.exec(command ?? "");
  return found ? found[1] : null;
}

/** 훅을 그 계약대로 부른다 — stdin 에 JSON, stdout 에 JSON. */
function runHook(tree, relPath, input, env = {}) {
  const out = execFileSync(process.execPath, [join(tree, relPath)], {
    cwd: tree,
    env: { ...cleanEnv(), ...env },
    input: JSON.stringify(input),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

/**
 * 그 파일이 **불러와지는가**. 돌리지는 않는다.
 *
 * 설치본의 훅은 한 줄짜리 shim(`import "<pkg>/hooks/<이름>.mjs";`)이라, 파일이 있다는
 * 것만으로는 아무것도 보장되지 않는다 — 패키지가 안 깔렸거나 `exports` 가 그 경로를
 * 안 내주면 **훅은 그 자리에서 죽고, 죽었다는 신호는 없다.**
 */
function loads(tree, relPath) {
  const full = join(tree, relPath);
  if (!existsSync(full)) return { ok: false, why: "파일이 없다." };

  const specifier = /^\s*import\s+["']([^"']+)["']\s*;?\s*$/m.exec(readFileSync(full, "utf8"));
  if (!specifier) return { ok: true }; // shim 이 아니라 본체다.

  try {
    execFileSync(
      process.execPath,
      ["-e", `require.resolve(${JSON.stringify(specifier[1])}, { paths: [${JSON.stringify(tree)}] })`],
      { cwd: tree, env: cleanEnv(), stdio: ["ignore", "ignore", "pipe"] },
    );
    return { ok: true };
  } catch {
    return { ok: false, why: `\`${specifier[1]}\` 이 해석되지 않는다 — 패키지가 안 깔렸는가?` };
  }
}

function frontmatter(text) {
  const found = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return found ? found[1] : "";
}

function safeMatch(pattern, value) {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function trackedSet(tree, git) {
  try {
    return new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
  } catch {
    return null;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const firstLine = (error) => `${error.message}`.split(/\r?\n/)[0];

/* ── 보고 ─────────────────────────────────────────────────────────────────── */

const LABEL = { [OK]: "✓", [BROKEN]: "✗", [UNKNOWN]: "?" };

/** @returns {number} 종료 코드. 끊긴 배선이 하나라도 있으면 1. */
export function report({ checks }, write = (s) => process.stdout.write(s)) {
  const dead = checks.filter((c) => c.state === BROKEN);

  write(
    `\n여기서 판정한 것 — 부르면 도는가:\n\n` +
      checks.map((c) => `  ${LABEL[c.state]}  ${c.name}\n      ${c.detail}\n`).join("") +
      `\n` +
      (dead.length > 0
        ? `끊긴 배선 ${dead.length}개. 그 자리는 **조용히** 없는 것으로 돈다.\n`
        : `배선은 전부 살아 있다.\n`),
  );

  write(
    `\n여기서 판정할 수 없는 것 — 세션에서 사람이 본다:\n\n` +
      `  이 명령이 증명한 것은 "부르면 도는가" 까지다. **Claude Code 가 실제로 부르는가** 는\n` +
      `  세션을 띄워야만 안다(비대화형 \`claude -p\` 는 \`isolation\` 도 frontmatter 훅도 안 건다).\n\n` +
      PROBES.map(
        (p, i) =>
          `  ${i + 1}. ${p.name}\n` +
          `${p.command
            .split("\n")
            .map((line) => `       $ ${line}`)
            .join("\n")}\n` +
          `       → ${p.expect}\n`,
      ).join("\n") +
      `\n`,
  );

  return dead.length > 0 ? 1 : 0;
}

/** 경로 비교는 `reap-worktrees` 와 같은 방식이다. */
function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const tree = process.cwd();
  const git = (args) =>
    execFileSync("git", args, {
      cwd: tree,
      env: cleanEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  try {
    git(["rev-parse", "--git-dir"]);
  } catch {
    process.stderr.write("git 저장소가 아니다. 하네스는 브랜치와 훅 위에 서 있다.\n");
    process.exit(1);
  }

  process.exit(report(inspect(tree, git)));
}
