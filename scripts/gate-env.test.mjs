import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runOne, repoRoot, mergeBase } from "./gate.mjs";

// BACKLOG #9 의 회귀 테스트. 단위 테스트(scrubGitEnv)만으로는 "게이트의 스폰 지점이
// 실제로 그 env 를 쓰는가"를 보장하지 못한다 — 함수만 있고 안 쓰이면 방어가 아니다.
//
// **이 테스트 자체는 git 을 조작하지 않는다.** 사고를 재현하려다 사고를 내는 것을 피한다:
// 환경변수가 자식에게 전달되는지, 그리고 게이트의 git 조회가 cwd 기준으로 도는지만 본다.
// GIT_DIR 에 넣는 값도 실재하지 않는 경로라, 만에 하나 방어가 뚫려도 git 은 실패할 뿐이다.

const BOGUS_GIT_DIR = join(tmpdir(), "gate-env-isolation-nonexistent.git");
const OUT = join(tmpdir(), `gate-env-isolation-${process.pid}.out`);

// 자식이 본 GIT_DIR 을 파일로 남긴다(runOne 은 stdio: "inherit" 이라 반환값으로는 못 본다 —
// gate-pipeline spec 의 결정이므로 테스트를 위해 바꾸지 않는다).
const PROBE = `node -e "console.log(process.env.GIT_DIR ?? 'unset')" > "${OUT}"`;

const probeResult = () => readFileSync(OUT, "utf8").trim();

// GIT_* 오염을 이 콜백 동안에만 적용한다.
function withPollutedEnv(fn) {
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = BOGUS_GIT_DIR;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }
}

afterEach(() => {
  if (existsSync(OUT)) rmSync(OUT, { force: true });
});

describe("게이트가 스폰하는 프로세스의 GIT_* 격리", () => {
  it("runOne 이 스폰한 자식은 GIT_DIR 을 보지 못한다", () => {
    const ok = withPollutedEnv(() => runOne({ dir: ".", cmd: PROBE }, process.cwd()));
    expect(ok).toBe(true);
    expect(probeResult()).toBe("unset");
  });

  // 대조군. 이게 없으면 위 테스트는 '오염이 애초에 없어서' 통과했을 수도 있다 —
  // 즉 방어를 되돌려도 초록으로 남는 테스트가 된다.
  it("(대조군) 스크럽 없이 같은 명령을 돌리면 자식이 GIT_DIR 을 본다", () => {
    withPollutedEnv(() => execSync(PROBE, { cwd: process.cwd(), stdio: "inherit" }));
    expect(probeResult()).toBe(BOGUS_GIT_DIR);
  });

  // 게이트 안의 git 해석은 한 가지여야 한다 — GIT_DIR 이 있을 때와 없을 때
  // --show-toplevel 이 다른 값을 내면, 게이트가 엉뚱한 트리를 대상으로 돈다.
  it("repoRoot 는 오염된 GIT_DIR 이 있어도 cwd 의 저장소 루트를 돌려준다", () => {
    const root = withPollutedEnv(() => repoRoot());
    expect(resolve(root)).toBe(resolve(process.cwd()));
  });

  it("mergeBase 는 오염된 GIT_DIR 이 있어도 커밋을 산출한다", () => {
    // baseBranch 에 의존하지 않도록 HEAD 로 조회한다(merge-base HEAD HEAD = HEAD).
    // 방어가 없으면 git 이 없는 GIT_DIR 을 보고 실패해 null 이 된다.
    const base = withPollutedEnv(() => mergeBase("HEAD", process.cwd()));
    expect(base).toMatch(/^[0-9a-f]{40}$/);
  });
});
