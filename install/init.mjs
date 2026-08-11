#!/usr/bin/env node
/**
 * `harness init` — 설치한 프로젝트(이하 **A**)의 트리에 하네스의 실체를 만든다.
 *
 * ## 왜 `npm install` 만으로는 안 되나
 *
 * 실측으로 확정된 것 둘이 이 파일의 설계를 통째로 정한다:
 *
 * - `CLAUDE.md` 의 `@` 임포트는 **프로젝트 루트 밖으로 못 나간다.** worktree 세션에서는
 *   worktree 자신이 루트라, `node_modules` 의 문서가 조용히 안 실린다
 * - `${CLAUDE_PROJECT_DIR}` 는 worktree 안에서 **worktree 루트**를 가리킨다. 거기엔
 *   `node_modules` 가 없으므로 그 경로로 배선한 훅은 전부 ENOENT 로 죽는다
 *
 * 그래서 **worktree 안에서 필요한 것은 전부 git 이 추적하는 파일이어야 한다.** 훅 본체는
 * 패키지에 두고, A 에는 **한 줄짜리 shim** 을 남긴다 — shim 은 추적되므로 사본에도
 * 복사되고, node 의 상향 해석이 `A/node_modules` 까지 올라가 본체를 찾는다(실측).
 *
 * ## `plan` 과 `apply` 를 가른 이유
 *
 * 이 명령은 **남의 저장소를 고친다.** 무엇을 할지 먼저 보여줄 수 있어야 하고, 판단
 * 자체는 파일을 건드리지 않고 검사할 수 있어야 한다. `reap-worktrees.mjs` 와 같은 꼴이다.
 *
 * ## 덮어쓰지 않는다
 *
 * 이미 있는 것과 충돌하면 **고치지 말고 멈춰서 알린다.** `core.hooksPath` 가 husky 를
 * 가리키고 있는데 우리가 빼앗으면 A 의 기존 훅이 통째로 죽는데, 그 사실을 아무도 모른다.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 패키지 루트. 이 파일은 `<pkg>/install/` 에 있다. */
const PKG = fileURLToPath(new URL("..", import.meta.url));

/** 설치될 때 A 가 `import` 할 이름. 패키지 자신의 것을 읽는다 — 여기 적으면 사본이 된다. */
const PKG_NAME = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).name;

/**
 * A 의 `.claude/hooks/` 에 남길 shim.
 *
 * 훅 본체는 임포트되는 순간 판정을 내보내고 끝난다 — 그래서 한 줄이면 된다.
 * **내용이 영원히 바뀌지 않으므로 드리프트가 없다.**
 */
const HOOK_SHIMS = [
  "path-ownership.mjs",
  "session-role.mjs",
  "verify-green.mjs",
  "verify-checklist.mjs",
];

/** `.githooks/` 쪽 shim. 셸 진입점이 `$(dirname "$0")/<이름>.mjs` 를 부른다. */
const GITHOOK_SHIMS = ["pre-commit.mjs", "pre-push.mjs", "mark-verified.mjs"];

/** 그대로 복사할 것. 셸 진입점은 git 이 직접 실행하므로 shim 이 될 수 없다. */
const VERBATIM = [
  { from: ".githooks/pre-commit", to: ".githooks/pre-commit", exec: true },
  { from: ".githooks/pre-push", to: ".githooks/pre-push", exec: true },
  { from: ".claude/agents/developer.md", to: ".claude/agents/developer.md" },
  { from: ".claude/agents/qa.md", to: ".claude/agents/qa.md" },
  { from: ".claude/planner-mode.md", to: ".claude/planner-mode.md" },
  // 규약 본문. A 의 `CLAUDE.md` 가 `@harness.md` 로 끌어온다 — 루트 안이라 worktree 에서도
  // 임포트가 풀린다(밖으로 나가는 것만 막힌다).
  { from: ".claude/CLAUDE.md", to: ".claude/harness.md" },
];

/** A 의 `.claude/CLAUDE.md` 가 반드시 품어야 할 한 줄. */
const IMPORT_LINE = "@harness.md";

/** `.gitignore` 에 없으면 재앙인 줄 — `pre-commit` 이 `git add -A` 를 강제하기 때문이다. */
const IGNORE_LINE = ".claude/worktrees/";

/** 게이트가 green 인 sha 를 기록하는 자리. `pre-push` 가 그 기록을 읽는다. */
const POSTTEST = "node .githooks/mark-verified.mjs";

/** 층 1·세션 훅 배선. A 의 `settings.json` 에 **더한다** — 있는 것을 지우지 않는다. */
function settingsAdditions() {
  const command = (name) => `node "\${CLAUDE_PROJECT_DIR}/.claude/hooks/${name}"`;

  return {
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write", hooks: [{ type: "command", command: command("path-ownership.mjs") }] },
      ],
      SessionStart: [{ hooks: [{ type: "command", command: command("session-role.mjs") }] }],
    },
    // 역할 브랜치가 스폰 시점 브랜치의 직계 자손이 된다. 회수를 머지 하나로 끝내는 근거다.
    worktree: { baseRef: "head" },
  };
}

/**
 * 무엇을 할지 정한다. **파일을 건드리지 않는다.**
 *
 * @param {string} tree A 의 최상단
 * @param {(args: string[]) => string} git `tree` 를 겨냥한 git 러너
 * @returns {{steps: object[], blockers: object[], notes: string[]}}
 */
export function plan(tree, git) {
  const steps = [];
  const blockers = [];
  const notes = [];

  for (const name of HOOK_SHIMS) {
    steps.push(file(tree, `.claude/hooks/${name}`, `import "${PKG_NAME}/hooks/${name}";\n`));
  }
  for (const name of GITHOOK_SHIMS) {
    steps.push(file(tree, `.githooks/${name}`, `import "${PKG_NAME}/githooks/${name}";\n`));
  }
  for (const item of VERBATIM) {
    steps.push({
      ...file(tree, item.to, readFileSync(join(PKG, item.from), "utf8")),
      exec: item.exec ?? false,
    });
  }

  steps.push(claudeMd(tree));
  steps.push(gitignore(tree));
  steps.push(...packageJson(tree));

  const hooksPath = hooksPathStep(tree, git);
  if (hooksPath.state === "conflict") blockers.push(hooksPath);
  else steps.push(hooksPath);

  steps.push(settingsStep(tree));

  // 러너 설정은 프로젝트마다 파일도 형식도 달라서 손댈 수 없다. 빠뜨리면 사본의 테스트가
  // 부모 실행에 다시 잡혀 배로 돈다(이 저장소 실측: 172 → 344).
  notes.push(
    "테스트 러너 설정에 `**/.claude/worktrees/**` 를 제외로 넣어라 — 넣지 않으면 " +
      "에이전트 사본의 테스트가 다시 잡혀 게이트가 배로 돈다.",
  );
  notes.push(
    "`harness.config.json` 은 만들지 않았다 — 없으면 기본값으로 돈다. " +
      "`harness doctor` 가 이 프로젝트에 안 맞는 값을 짚어준다.",
  );

  return { steps, blockers, notes };
}

/** 파일 하나의 상태. 내용이 이미 같으면 건드릴 것이 없다. */
function file(tree, path, contents) {
  const full = join(tree, path);
  let state = "create";
  if (existsSync(full)) {
    state = readFileSync(full, "utf8") === contents ? "same" : "update";
  }
  return { kind: "file", path, contents, state };
}

/**
 * A 의 `CLAUDE.md` 에 임포트 한 줄이 있게 한다.
 *
 * **덮어쓰지 않는다.** A 가 이미 자기 규약을 적어뒀을 수 있으므로, 없으면 만들고 있으면
 * 한 줄만 앞에 붙인다.
 */
function claudeMd(tree) {
  const path = ".claude/CLAUDE.md";
  const full = join(tree, path);

  if (!existsSync(full)) {
    return { kind: "file", path, contents: `${IMPORT_LINE}\n`, state: "create" };
  }

  const current = readFileSync(full, "utf8");
  if (current.split(/\r?\n/).some((line) => line.trim() === IMPORT_LINE)) {
    return { kind: "file", path, contents: current, state: "same" };
  }

  return {
    kind: "file",
    path,
    contents: `${IMPORT_LINE}\n\n${current}`,
    state: "update",
    detail: "하네스 규약을 끌어오는 한 줄을 맨 앞에 붙인다. 기존 내용은 그대로 둔다.",
  };
}

function gitignore(tree) {
  const path = ".gitignore";
  const full = join(tree, path);
  const current = existsSync(full) ? readFileSync(full, "utf8") : "";

  if (current.split(/\r?\n/).some((line) => line.trim() === IGNORE_LINE)) {
    return { kind: "file", path, contents: current, state: "same" };
  }

  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  return {
    kind: "file",
    path,
    contents:
      `${current}${prefix}\n# 에이전트 사본. 추적되면 커밋이 통째로 쓸어 담는다.\n${IGNORE_LINE}\n`,
    state: current ? "update" : "create",
  };
}

/** `posttest` 배선. 이미 다른 것이 걸려 있으면 빼앗지 않는다. */
function packageJson(tree) {
  const path = "package.json";
  const full = join(tree, path);
  if (!existsSync(full)) return [];

  const raw = readFileSync(full, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [{ kind: "manual", path, detail: "`package.json` 을 읽지 못해 `posttest` 를 배선하지 못했다." }];
  }

  const existing = parsed.scripts?.posttest;
  if (existing === POSTTEST) return [{ kind: "file", path, contents: raw, state: "same" }];
  if (existing) {
    return [
      {
        kind: "manual",
        path,
        detail:
          `\`posttest\` 에 이미 \`${existing}\` 이 걸려 있다. ` +
          `\`${POSTTEST}\` 를 이어 붙여라 — 없으면 게이트 통과 기록이 안 남고 push 가 막힌다.`,
      },
    ];
  }

  const next = { ...parsed, scripts: { ...parsed.scripts, posttest: POSTTEST } };
  return [{ kind: "file", path, contents: `${JSON.stringify(next, null, 2)}\n`, state: "update" }];
}

/**
 * `core.hooksPath` 를 `.githooks` 로. **이미 다른 곳을 가리키면 멈춘다.**
 *
 * husky·lefthook 이 같은 설정을 차지한다. 빼앗으면 A 의 기존 훅이 통째로 죽는데
 * 아무 신호도 없다.
 */
function hooksPathStep(tree, git) {
  const want = ".githooks";
  let current = null;
  try {
    current = git(["config", "--local", "--get", "core.hooksPath"]).trim();
  } catch {
    current = null; // 설정되지 않았다.
  }

  if (!current) return { kind: "config", key: "core.hooksPath", value: want, state: "set" };
  if (current === want) return { kind: "config", key: "core.hooksPath", value: want, state: "same" };

  return {
    kind: "config",
    key: "core.hooksPath",
    value: want,
    state: "conflict",
    detail:
      `\`core.hooksPath\` 가 이미 \`${current}\` 를 가리킨다(husky·lefthook 을 쓰고 있을 것이다). ` +
      `빼앗으면 그쪽 훅이 통째로 죽는다 — 사람이 정해야 한다.`,
  };
}

/** `settings.json` 병합. **A 의 항목을 지우지 않고 없는 것만 더한다.** */
function settingsStep(tree) {
  const path = ".claude/settings.json";
  const full = join(tree, path);
  const additions = settingsAdditions();

  if (!existsSync(full)) {
    return { kind: "file", path, contents: `${JSON.stringify(additions, null, 2)}\n`, state: "create" };
  }

  const raw = readFileSync(full, "utf8");
  let current;
  try {
    current = JSON.parse(raw);
  } catch {
    return { kind: "manual", path, detail: "`settings.json` 이 JSON 이 아니라 병합하지 못했다." };
  }

  const merged = structuredClone(current);
  merged.hooks ??= {};

  for (const [event, entries] of Object.entries(additions.hooks)) {
    merged.hooks[event] ??= [];
    for (const entry of entries) {
      const command = entry.hooks[0].command;
      const already = merged.hooks[event].some((e) =>
        (e.hooks ?? []).some((h) => h.command === command),
      );
      if (!already) merged.hooks[event].push(entry);
    }
  }

  const baseRef = merged.worktree?.baseRef;
  if (baseRef && baseRef !== "head") {
    return {
      kind: "manual",
      path,
      detail:
        `\`worktree.baseRef\` 가 \`${baseRef}\` 다. 회수는 역할 브랜치가 스폰 시점의 직계 ` +
        `자손임을 전제하므로 \`"head"\` 여야 한다 — 사람이 정해야 한다.`,
    };
  }
  merged.worktree = { ...merged.worktree, baseRef: "head" };

  const contents = `${JSON.stringify(merged, null, 2)}\n`;
  return { kind: "file", path, contents, state: contents === raw ? "same" : "update" };
}

/** 판정대로 만든다. `plan` 이 막았으면(`blockers`) 아무것도 하지 않는다. */
export function apply(tree, git) {
  const result = plan(tree, git);
  if (result.blockers.length > 0) return { ...result, applied: [] };

  const applied = [];

  for (const step of result.steps) {
    if (step.state === "same" || step.kind === "manual") continue;

    if (step.kind === "file") {
      const full = join(tree, step.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, step.contents);
      // Windows 는 실행권한이 없어 조용히 무시된다. POSIX 에서는 이게 없으면 git 이
      // 훅을 **에러 없이 건너뛴다** — 층 2 가 통째로 사라지는데 아무도 모른다.
      if (step.exec) makeExecutable(full);
      applied.push(step);
    } else if (step.kind === "config") {
      git(["config", "--local", step.key, step.value]);
      applied.push(step);
    }
  }

  return { ...result, applied };
}

function makeExecutable(path) {
  try {
    chmodSync(path, 0o755);
  } catch {
    /* 권한을 못 바꿔도 파일은 만들어졌다. 판정을 뒤집지 않는다. */
  }
}

/** 경로 비교는 `reap-worktrees` 와 같은 방식이다. */
function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  main();
}

function main() {
  const tree = process.cwd();
  const dryRun = process.argv.includes("--dry-run");
  const git = (args) =>
    execFileSync("git", args, {
      cwd: tree,
      env: cleanGitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  try {
    git(["rev-parse", "--git-dir"]);
  } catch {
    process.stderr.write("git 저장소가 아니다. 하네스는 브랜치와 훅 위에 서 있다.\n");
    process.exit(1);
  }

  const result = dryRun ? plan(tree, git) : apply(tree, git);
  process.exit(report(result, dryRun));
}

/** `GIT_DIR` 이 상속돼 있으면 `cwd` 를 겨냥한 명령이 다른 저장소를 건드린다. */
function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return env;
}

export function report({ steps, blockers, notes, applied }, dryRun, write = (s) => process.stdout.write(s)) {
  if (blockers.length > 0) {
    write(
      `\n설치를 멈췄다 — 덮어쓰면 안 되는 것이 있다.\n\n` +
        blockers.map((b) => `  ✗ ${b.detail}`).join("\n") +
        `\n\n아무것도 바꾸지 않았다.\n\n`,
    );
    return 1;
  }

  const changed = (applied ?? steps.filter((s) => s.state && s.state !== "same"))
    .filter((s) => s.kind !== "manual");
  const manual = steps.filter((s) => s.kind === "manual");

  write(
    `\n${dryRun ? "설치하면 이렇게 된다" : "설치했다"}:\n\n` +
      (changed.length === 0
        ? "  · 바꿀 것이 없다 — 이미 설치돼 있다.\n"
        : changed.map((s) => `  ${s.state === "create" ? "+" : "~"} ${s.path ?? s.key}\n`).join("")) +
      (manual.length > 0
        ? `\n손이 필요한 것:\n\n${manual.map((s) => `  ! ${s.detail}`).join("\n")}\n`
        : "") +
      `\n확인할 것:\n\n${notes.map((n) => `  · ${n}`).join("\n")}\n\n`,
  );

  return 0;
}
