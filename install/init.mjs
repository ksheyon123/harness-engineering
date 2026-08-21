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
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GITHOOK_SHIMS,
  HOOK_SHIMS,
  MANIFEST_PATH,
  VERBATIM,
  hashOf,
  manifestContents,
} from "./managed.mjs";
import { BROKEN, COMMITTED_CHECK, inspect, pointsAtGithooks, report as smokeReport } from "./smoke.mjs";

/** 패키지 루트. 이 파일은 `<pkg>/install/` 에 있다. */
const PKG = fileURLToPath(new URL("..", import.meta.url));

/** 설치될 때 A 가 `import` 할 이름. 패키지 자신의 것을 읽는다 — 여기 적으면 사본이 된다. */
const PKG_NAME = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).name;

/** 패키지 버전. 설치 흔적에 남아 `sync`·`doctor` 가 낡음을 판정하는 근거가 된다. */
const PKG_VERSION = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;

/** A 의 `.claude/CLAUDE.md` 가 반드시 품어야 할 한 줄. */
const IMPORT_LINE = "@harness.md";

/**
 * `.gitignore` 에 없으면 재앙인 줄들 — `pre-commit` 이 `git add -A` 를 강제하므로,
 * 무시되지 않는 것은 **다음 커밋에 반드시 딸려 들어간다.**
 *
 * A 가 `.claude` 를 통째로 무시하면 이 줄들은 군더더기가 된다. 그래도 적는다 — 무시하지
 * **않는** A 가 더 흔하고(이 저장소가 그렇다), 남는 한 줄이 치르는 값은 없다.
 */
const IGNORE_LINES = [
  { line: ".claude/worktrees/", why: "에이전트 사본. 추적되면 커밋이 통째로 쓸어 담는다." },
  {
    line: ".claude/post-checkout-trace.log",
    why: "post-checkout 이 남기는 발동 흔적. 사본이 만들어질 때마다 자라는 로컬 기록이다.",
  },
];

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

  // 하네스가 통째로 소유하는 것들의 해시를 남긴다. 아래 병합 파일은 A 의 것이라 안 남긴다.
  const owned = Object.fromEntries(
    steps.filter((s) => s.kind === "file").map((s) => [s.path, hashOf(s.contents)]),
  );
  steps.push(file(tree, MANIFEST_PATH, manifestContents({ version: PKG_VERSION, files: owned })));

  steps.push(claudeMd(tree));
  steps.push(gitignore(tree));
  steps.push(...packageJson(tree));

  const hooksPath = hooksPathStep(tree, git);
  if (hooksPath.state === "conflict") blockers.push(hooksPath);
  else steps.push(hooksPath);

  steps.push(settingsStep(tree));

  // 여기 적힌 순서가 곧 해야 할 순서다. 앞의 둘은 **안 하면 하네스가 안 도는 것**이고,
  // 이 명령이 끝나는 시점 말고는 말해줄 자리가 없다 — 방금 그 파일들을 쓴 것이 우리다.

  // 사본에 도달하는 길이 둘이라, 어느 쪽으로 갈지는 **A 가 정한다.** 설치 도구가 커밋을
  // 만들지도(남의 히스토리다) 무시 규칙을 뚫지도(`git add -f`) 않는 이유가 같다.
  // 다만 **둘 중 하나는 반드시 참이어야 하고**, 아니면 사본에서 하네스가 통째로 사라진다.
  notes.push(
    "**사본에 도달할 길을 하나 고르라.** 하네스를 팀 규약으로 본다면 커밋해라 — " +
      "`git switch -c chore/harness-install` · `git add -A` · `git commit` " +
      "(보호 브랜치 직접 커밋은 `pre-commit` 이 막는다). 개인 도구로 본다면 커밋하지 " +
      "말고 `.gitignore` 에 둬라 — 방금 배선한 `post-checkout` 이 사본이 만들어질 때마다 " +
      "심는다. **둘 다 아니면** 규약도 층 1 도 에이전트 정의도 사본에서 사라진다. " +
      "`harness smoke` 가 어느 쪽으로 도달하는지 판정한다.",
  );

  // 게이트를 여기서 만들지 않는 것도 같은 이유다 — 무엇을 검사할지는 A 가 정한다.
  // 다만 없으면 `developer` 는 종료 게이트를 통과할 방법이 없고, 그 사실은 스폰하고
  // 재시도 상한을 태운 뒤에야 드러난다.
  notes.push(
    "**게이트가 도는지 확인해라.** 테스트 러너도 `scripts.test` 도 만들지 않았다 — " +
      "무엇을 검사할지는 이 프로젝트가 정한다. 게이트가 안 돌면 `developer` 는 종료 " +
      "게이트를 통과할 수 없다. `harness smoke` 가 이것을 묻는다.",
  );

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
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));

  // **없는 것만 더한다.** 하나가 이미 있다고 나머지를 건너뛰면, 줄이 늘어날 때마다
  // 먼저 설치한 저장소가 그 줄을 영원히 못 받는다.
  const missing = IGNORE_LINES.filter((entry) => !present.has(entry.line));
  if (missing.length === 0) return { kind: "file", path, contents: current, state: "same" };

  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  return {
    kind: "file",
    path,
    contents:
      current + prefix + missing.map((entry) => `\n# ${entry.why}\n${entry.line}\n`).join(""),
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
 * `core.hooksPath` 를 **절대경로**로. **이미 다른 곳을 가리키면 멈춘다.**
 *
 * 충돌의 기준은 **표기가 아니라 가리키는 곳**이다 — 판정은 `smoke` 의 `pointsAtGithooks`
 * 하나가 내린다. A 가 `<A>/.githooks` 를 절대경로로 적어뒀다면 그것은 우리 자신을 가리키는
 * 것이라 충돌이 아니다.
 *
 * ## 왜 상대값(`.githooks`)을 쓰지 않는가 — 실측으로 뒤집혔다
 *
 * 한때 여기서 `.githooks` 를 심었고, A 가 절대경로를 골라 뒀으면 "둘 다 성립하니 A 의
 * 표기를 뒤집지 않는다" 고 두었다. **둘 다 성립하지 않는다.**
 *
 * git 은 `core.hooksPath` 를 **각 워킹트리 최상단 기준**으로 푼다. 그래서 상대값은 갓
 * 만들어진 사본 안에서 **그 사본의** `.githooks/` 를 가리키는데, 커밋되지 않은 저장소에는
 * 거기 아무것도 없다 — 훅이 실패하는 게 아니라 **아예 안 불린다.** 그러면 `post-checkout`
 * 의 심기가 돌지 않고, 심기가 돌지 않으니 사본에 `.githooks/` 가 생기지도 않는다. 순환이다.
 *
 * **절대경로가 그 순환을 끊는다** — 어느 사본에서 불려도 본체의 훅이 잡힌다(실측).
 * `.githooks/` 를 커밋하는 저장소라면 상대값도 돌지만, 절대값은 **양쪽 다** 돈다.
 */
function hooksPathStep(tree, git) {
  const want = join(tree, ".githooks");
  let current = null;
  try {
    current = git(["config", "--local", "--get", "core.hooksPath"]).trim();
  } catch {
    current = null; // 설정되지 않았다.
  }

  if (!current) return { kind: "config", key: "core.hooksPath", value: want, state: "set" };

  // 이미 절대경로로 우리를 가리킨다 — 건드릴 것이 없다.
  // `state: "same"` 인 step 은 `apply` 가 건너뛴다.
  if (pointsAtGithooks(tree, current) && isAbsolute(current)) {
    return { kind: "config", key: "core.hooksPath", value: want, state: "same" };
  }

  // 우리를 가리키긴 하는데 상대값이다. 본체에서는 멀쩡히 돌아서 **사본에서만** 죽는다.
  if (pointsAtGithooks(tree, current)) {
    return {
      kind: "config",
      key: "core.hooksPath",
      value: want,
      state: "set",
      detail:
        `\`${current}\` 는 우리 자리를 가리키지만 **상대값이라 사본 안에서 사본의 \`.githooks/\` 를 ` +
        `찾는다.** 절대경로로 다시 쓴다.`,
    };
  }

  return {
    kind: "config",
    key: "core.hooksPath",
    value: want,
    state: "conflict",
    // **절대경로를 문구에 넣지 않는다.** 이 메시지가 말하려는 것은 "우리 자리" 지 특정
    // 문자열이 아니고, 넣으면 같은 상황의 메시지가 저장소마다 달라진다.
    detail:
      `\`core.hooksPath\` 가 \`${current}\` 를 가리킨다 — \`.githooks\` 가 아니라 그쪽 훅이 불린다. ` +
      `husky·lefthook 처럼 같은 설정을 쓰는 것이 있을 수 있다. 빼앗으면 그쪽 훅이 통째로 죽는데 ` +
      `아무 신호도 없다 — 그쪽 훅에서 하네스의 \`.githooks/\` 훅을 직접 이어 붙이거나, 그쪽을 ` +
      `걷어내고 \`git config --local --unset core.hooksPath\` 한 뒤 \`harness init\` 을 다시 돌려라.`,
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

  // **인덱스를 건드리지 않는다.** 한때 여기서 무시되는 경로를 `git add -f` 로 뚫어 담았다.
  // 그때는 사본에 도달하는 길이 커밋 하나뿐이었기 때문이고, 지금은 `post-checkout` 이
  // 커밋 없이 심는다. A 가 `.claude/` 를 무시한 것은 그것을 **개인 설정**으로 본 판단이라
  // (개발자마다 다른 하네스를 쓴다) 설치 도구가 뒤집을 일이 아니었다.
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
  const code = report(result, dryRun);
  if (dryRun || code !== 0) process.exit(code);

  process.exit(verify(tree, git));
}

/**
 * 설치가 **자기 성공을 자기가 한 동작으로 판정하지 않게** 한다.
 *
 * 예전에는 파일을 썼으면 종료 코드 0 이었다. 그런데 하네스가 실제로 서려면 그 밖에도
 * 참이어야 하는 것들이 있었고(게이트가 도는가, 러너가 사본을 제외하는가, 훅에 실행권한이
 * 있는가), 그것들은 전부 **note** 로만 있었다 — 하나도 안 해도 0 이었다. 그래서 마지막에
 * `smoke` 를 직접 돌린다.
 *
 * ## 도달만은 종료 코드에 넣지 않는다
 *
 * `init` 은 남의 저장소에 커밋을 만들지 않는다(그건 설치 도구의 몫이 아니다). 그래서 갓
 * 설치한 직후에 커밋이 없는 것은 **정상**이고, 그것으로 1 을 내면 종료 코드가 *항상* 1 이
 * 된다. 항상 같은 값은 아무 정보도 아니다 — 아무도 안 읽는 note 와 똑같아진다.
 *
 * 그래서 가른다:
 *
 * | 무엇 | 종료 코드 |
 * |---|---|
 * | 배선이 깨졌다 — **`init` 이 만든 상태가 잘못됐다** | 1 |
 * | 도달만 남았다 — `init` 이 할 수 있는 것은 다 했다 | 0, 대신 남은 것을 찍는다 |
 *
 * **심기가 배선되면 이 자리는 대개 초록이다.** `post-checkout` 이 커밋 없이 사본에
 * 넣어 주므로, 커밋을 안 하기로 한 저장소도 정상 경로가 된다. 빨간불이 남는 것은
 * 도달할 길이 **둘 다 없을 때**뿐이다.
 */
function verify(tree, git) {
  process.stdout.write("― 여기까지가 설치다. 아래는 그것이 실제로 서 있는지 묻는다 ―\n");

  const result = inspect(tree, git);
  smokeReport(result);

  const dead = result.checks.filter((c) => c.state === BROKEN && c.id !== COMMITTED_CHECK);
  if (dead.length > 0) return 1;

  if (result.checks.some((c) => c.state === BROKEN && c.id === COMMITTED_CHECK)) {
    process.stdout.write(
      "설치는 끝났다. **남은 것은 사본에 도달할 길 하나다.**\n\n" +
        "  (가) 커밋한다 — 하네스를 팀 규약으로 본다면\n" +
        "      git switch -c chore/harness-install\n" +
        "      git add -A\n" +
        "      git commit\n\n" +
        "  (나) 심기를 세운다 — 개인 도구로 본다면 커밋하지 않고 `.gitignore` 에 둔다.\n" +
        "      `core.hooksPath` 와 `.githooks/post-checkout` 이 서 있으면 사본이\n" +
        "      만들어질 때마다 심긴다. 위 판정에 무엇이 빠졌는지 적혀 있다.\n\n" +
        "둘 다 없으면 worktree 사본에 이 파일들이 없고, 하필 거기가 `developer`·`qa` 가\n" +
        "도는 자리다. 없으면 막히는 게 아니라 **그냥 통과한다.**\n\n",
    );
  }

  return 0;
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
