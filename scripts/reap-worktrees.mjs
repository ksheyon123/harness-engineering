#!/usr/bin/env node
/**
 * 오케스트레이터가 push 를 마친 뒤 부른다 — **내 task 에 회수된 서브에이전트 사본만** 거둔다.
 *
 * `developer`·`qa` 는 `isolation: worktree` 로 돌고, 종료 훅이 그 자리에서 인계 커밋을
 * 찍는다. 커밋이 찍히면 그 사본은 Claude Code 의 자동 정리 대상('변경 없이 끝난 것')에서
 * 벗어나 **영원히 남는다.** task 를 몇 번 돌리면 `.claude/worktrees/` 가 죽은 사본으로 찬다.
 *
 * ## 훅이 아니라 오케스트레이터가 부른다
 *
 * 한때 이것이 `SessionEnd` 훅이었고, **그게 사고를 냈다.** `SessionEnd` 는 Ctrl+C 에도
 * 돌고 그 세션이 무엇을 하던 중이었는지 묻지 않는다. 거기에 회수 판정까지 저장소 전역으로
 * 넓혀놨더니, 세션 하나가 죽으면서 **병렬로 돌던 다른 세션들의 사본까지 전부 쓸어갔다.**
 *
 * 그래서 두 가지를 같이 되돌린다:
 *
 * - **부르는 자리** — 세션의 끝이 아니라 **한 task 의 끝**(push 직후). 그 지점에서만
 *   "이 task 의 에이전트는 전부 회수됐다" 가 참이다.
 * - **판정 범위** — `--merged HEAD`. 내 task 브랜치에 들어온 것만 본다.
 *
 * 둘 중 하나만 고쳐도 그 사고는 안 났겠지만, 둘 다 자기 몫의 이유로 틀렸었다.
 *
 * ## 지우는 것은 서브에이전트 것뿐이다
 *
 * **작업 세션의 worktree(`.claude/worktrees/<task>/`)는 대상이 아니다.** 그 브랜치는
 * 정의상 `main` 에 머지되지 않은 채 push 되고, 지우면 살아 있는 PR 이 죽는다. 그래서
 * 대상 판정을 이름 두 곳에 건다 — 브랜치는 `worktree-agent-*`, 디렉터리는
 * `<...>/worktrees/agent-<hex>`. 둘 다 Claude Code 가 짓는 이름이라 task 이름과 섞이지 않는다.
 *
 * 여기에 자기 자신도 명시적으로 뺀다. 실측상 **자기가 서 있는 worktree 는 애초에 지워지지
 * 않지만**(Windows 가 cwd 를 잡고 있어 `Permission denied`), 그것은 우연한 보호막이라
 * 판정으로 남기지 않는다.
 *
 * ## 안전은 git 이 대부분 강제한다 — `--force` 를 쓰지 않는 이유
 *
 * 실측으로 확인한 것:
 *
 * | 위험 | 무엇이 막나 |
 * |---|---|
 * | 인계 커밋이 실패해 산출물이 워킹트리에만 있다 | `git worktree remove` 가 dirty 트리를 **거부** |
 * | 아직 회수(머지)되지 않았다 | `--merged HEAD` 로 안 잡히고, `git branch -d` 도 **거부** |
 * | 다른 세션이 그 사본에서 살아 있다 | locked 라 `remove` 가 **거부** |
 *
 * 그래서 `--force`·`-D` 를 쓰지 않는 한, 지워질 수 있는 것은 '인계됐고 · 회수됐고 · 아무도
 * 안 쓰는' 사본뿐이다. **강제 옵션을 더하는 순간 이 세 보호막이 한꺼번에 사라진다.**
 *
 * 그리고 지워도 잃는 것이 없다: 커밋 객체는 `<main>/.git/objects`, 브랜치 ref 는
 * `<main>/.git/refs/heads/` 에 있고 `git worktree remove` 는 둘 다 건드리지 않는다.
 * 실측으로 **사본을 지운 뒤에도 그 브랜치는 그대로 머지된다.**
 *
 * ## 실패해도 push 를 되돌리지 않는다
 *
 * 이 스크립트는 파이프라인의 **끝**에 있다. 여기서 무엇이 실패해도 이미 커밋·push 된 것은
 * 그대로 유효하다. 그러니 실패로 종료하지 않되, **무엇을 왜 건너뛰었는지는 남긴다** —
 * 정리되지 않은 사본이 쌓이는 것을 사람이 알아야 한다.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";

/** Claude Code 가 서브에이전트 worktree 에 붙이는 브랜치 접두어. */
const AGENT_BRANCH = /^worktree-agent-[0-9a-f]+$/i;

/** 같은 사본의 디렉터리 이름. 브랜치와 **양쪽** 이 맞아야 대상이 된다. */
const AGENT_DIR = /^agent-[0-9a-f]{6,}$/i;

/** 경로 비교용 정규화 — Windows 는 구분자도 대소문자도 흔들린다. */
function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

/**
 * `git worktree list --porcelain` 을 읽는다.
 *
 * 레코드는 빈 줄로 갈리고, 첫 줄이 `worktree <경로>` 다. `locked` 는 이유가 붙기도 하고
 * 맨몸으로 오기도 한다 — 있으면 잠긴 것이다.
 */
function listWorktrees(run) {
  const out = run(["worktree", "list", "--porcelain"]);
  const trees = [];

  for (const block of out.split(/\r?\n\r?\n/)) {
    const record = {};
    for (const line of block.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const at = line.indexOf(" ");
      const key = at === -1 ? line : line.slice(0, at);
      const value = at === -1 ? "" : line.slice(at + 1);
      record[key] = value;
    }
    if (!record.worktree) continue;

    trees.push({
      path: record.worktree,
      branch: record.branch ? record.branch.replace(/^refs\/heads\//, "") : null,
      locked: "locked" in record,
    });
  }

  return trees;
}

/**
 * **내 브랜치에** 회수(머지)된 에이전트 브랜치.
 *
 * `--merged HEAD` 로 묻는 것이 이 함수의 전부이고, 그 한 번의 질의가 두 가지를 동시에
 * 답한다: 이 브랜치는 **회수됐고**(머지됐다), 그리고 **내 것이다**(다른 작업 세션의
 * 에이전트 브랜치는 그 세션의 브랜치에서 잘렸으므로 내 HEAD 에 들어와 있을 수 없다).
 *
 * **넓히면 안 된다.** "자기 말고 아무 브랜치나 품고 있으면 회수된 것" 으로 물으면 판정이
 * 저장소 전역이 되어, 이 스크립트를 부른 세션이 **다른 세션의 사본까지 쓸어간다.** 병렬로
 * 도는 세션들이 `.claude/worktrees/` 를 공유하기 때문이다 — 실제로 그렇게 깨졌다.
 * 소유의 근거는 이름이 아니라 **머지 대상**이다. 좁게 물어라.
 */
function recovered(run) {
  return new Set(
    run(["branch", "--list", "worktree-agent-*", "--merged", "HEAD", "--format=%(refname:short)"])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((name) => AGENT_BRANCH.test(name)),
  );
}

/** 거둘 것을 고른다. **판정만 한다 — 지우지 않는다.** */
export function plan({ run, cwd }) {
  const merged = recovered(run);

  // 자기가 서 있는 브랜치는 무슨 이름이든 대상에서 뺀다.
  const current = run(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  merged.delete(current);

  const here = normalize(safe(run, ["rev-parse", "--show-toplevel"]) ?? cwd);

  const reap = [];
  const skip = [];

  for (const tree of listWorktrees(run)) {
    if (!tree.branch || !merged.has(tree.branch)) continue;

    // 사본을 봤다는 사실만으로 후보에서 뺀다 — **판정 결과와 무관하게.** 남기기로 한
    // 브랜치가 집합에 남아 있으면 아래 '사본 없는 브랜치' 루프로 흘러들어가, 지키기로
    // 판정한 사본의 ref 를 도로 지우려 든다. 남긴다는 것은 브랜치까지 남긴다는 뜻이다.
    merged.delete(tree.branch);

    // 브랜치가 맞아도 디렉터리 이름이 다르면 손대지 않는다. 이름 하나가 흔들렸을 때
    // 작업 세션의 사본으로 번지는 것을 막는 두 번째 자물쇠다.
    const dir = basename(tree.path);
    if (!AGENT_DIR.test(dir) || basename(dirname(tree.path)) !== "worktrees") {
      skip.push({ branch: tree.branch, path: tree.path, reason: "서브에이전트 사본이 아니다" });
      continue;
    }

    if (normalize(tree.path) === here) {
      skip.push({ branch: tree.branch, path: tree.path, reason: "지금 서 있는 트리다" });
      continue;
    }

    if (tree.locked) {
      skip.push({ branch: tree.branch, path: tree.path, reason: "locked — 쓰는 쪽이 있다" });
      continue;
    }

    reap.push({ branch: tree.branch, path: tree.path });
  }

  // 사본이 **한 번도 보이지 않은** 브랜치만 남는다. 회수까지 끝났으니 ref 도 접는다.
  for (const branch of merged) reap.push({ branch, path: null });

  return { reap, skip };
}

/** 판정대로 거둔다. `--force`·`-D` 를 쓰지 않는다 — 위 표의 보호막이 거기 걸려 있다. */
export function reap({ run, cwd }) {
  const { reap: targets, skip } = plan({ run, cwd });
  const done = [];

  for (const target of targets) {
    if (target.path && existsSync(target.path)) {
      try {
        run(["worktree", "remove", target.path]);
      } catch (error) {
        skip.push({ ...target, reason: detail(error) });
        continue;
      }
    }

    try {
      run(["branch", "-d", target.branch]);
    } catch (error) {
      // 사본은 거뒀는데 ref 만 남는다. 손실은 아니라서 계속 간다.
      skip.push({ ...target, reason: `사본은 거뒀지만 브랜치가 남았다 — ${detail(error)}` });
    }

    done.push(target);
  }

  return { reaped: done, skipped: skip };
}

function detail(error) {
  const text = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error);
  return text.split(/\r?\n/)[0].slice(0, 200);
}

function safe(run, args) {
  try {
    return run(args);
  } catch {
    return null;
  }
}

/** 직접 실행됐을 때만 동작한다(테스트는 위 함수를 직접 부른다). */
if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  main();
}

function main() {
  const env = cleanEnv();
  const cwd = process.cwd();
  const run = (args) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  let result;
  try {
    result = reap({ run, cwd });
  } catch (error) {
    // 파이프라인의 끝이라 여기서 실패해도 커밋·push 는 그대로 유효하다. 다만 조용히
    // 넘어가지는 않는다 — 부른 쪽이 '정리됐다' 고 오해하면 사본이 소리 없이 쌓인다.
    console.log(`정리하지 못했다 — ${detail(error)}`);
    process.exit(0);
  }

  for (const target of result.reaped) {
    console.log(`정리: ${target.branch}${target.path ? ` (${target.path})` : " (사본 없음)"}`);
  }
  for (const target of result.skipped) {
    console.log(`남김: ${target.branch} — ${target.reason}`);
  }
  if (result.reaped.length === 0 && result.skipped.length === 0) {
    console.log("거둘 것이 없다 — 이 브랜치에 회수된 에이전트 사본이 없다.");
  }

  process.exit(0);
}
