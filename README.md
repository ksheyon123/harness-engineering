# @ksheyon123/harness-engineering

역할 기반(기획자 · 개발자 · QA) 문서 주도 개발 하네스. **Claude Code 위에서 돈다.**

## 문서

| 어디 | 무엇 |
|---|---|
| **[docs/usage.md](./docs/usage.md)** | **사용법** — 사람은 언제 무엇을 하나 · 못 하는 것과 그 이유 · 막혔을 때 · 명령 |
| [docs/implementation.md](./docs/implementation.md) | 설치와 운영 — 절차 · 설정(`harness.config.json`) · 갱신 · 막히는 자리 |
| [.claude/harness.md](./.claude/harness.md) | 규약 본문 — 자리 · 모드 · 검증 · 커밋/push · worktree |
| [.claude/planner-mode.md](./.claude/planner-mode.md) | 기획자 모드 — 논의 · 격리 진입 · spec 을 어떻게 쓰는가 |
| [.claude/planner/](./.claude/planner/) | 논의 방식 — 작업 세션이 물고 시작한다. **디렉터리가 곧 스위치다** |
| [.claude/skills/](./.claude/skills/) | `/harness-fix` · `/task` — 사람이 요청의 영역을 명시하는 빠른 길 |

## 설치

요구 사항: Node ≥ 18 · git 저장소 · [Claude Code](https://claude.com/claude-code).

```sh
npm i -D @ksheyon123/harness-engineering
npx harness init            # 끝에서 smoke 를 직접 돈다 — 배선이 깨졌으면 종료 코드 1
```

그 다음 **Claude Code 를 새로 연다** — 훅은 세션이 시작될 때 읽힌다. 거기서부터는 [docs/usage.md](./docs/usage.md) 다.

- **`npm install` 만으로는 아무것도 안 된다.** 배선은 `harness init` 이 저장소에 실체(`.claude/settings.json` · `.githooks/` · 규약)를 만들어야 생긴다.
- **게이트는 `init` 이 만들지 않는다.** 무엇을 검사할지는 저장소가 정한다 — `package.json` 의 `scripts.test` 가 그 단일 출처다.
- **커밋은 선택이다.** worktree 사본에 하네스가 도달하는 길은 둘이고 `init` 이 그중 하나를 세워 둔다 — `core.hooksPath` 와 `post-checkout` 이 서면 사본이 만들어질 때마다 **커밋 없이** 심긴다. 하네스를 팀 규약으로 삼겠다면 커밋한다(`git switch -c chore/harness-install && git add -A && git commit`) — 보호 브랜치 직접 커밋은 층 2 가 막으므로 브랜치를 자른다.
- **`.gitignore` 에 `.claude` 가 있어도 된다.** `init` 은 인덱스를 건드리지 않는다 — 무시해 둔 것은 그것을 개인 설정으로 본 판단이고, 위의 심기가 그 상태로도 돌게 해 준다.

## 무엇을 푸는가

에이전트에게 "이렇게 일해라" 고 적어두는 것만으로는 지켜지지 않는다. 지침은 **컨텍스트일 뿐 강제가 아니다** — 길어지면 묻히고, `/clear` 한 번에 사라지고, 읽었는지 확인할 방법도 없다.

그래서 규율로 지키던 것을 **구조로 옮긴다.** 지키지 못하게 하는 대신 **할 수 없게** 만든다:

- 개발자에게 spec 을 고칠 권한을 주지 않는다 — 훅이 그 경로의 쓰기를 거부한다
- 테스트가 red 인 채로 끝내지 못하게 한다 — 종료 훅이 종료를 막고 실패 로그를 되돌려준다
- 검증 안 된 커밋을 올리지 못하게 한다 — `pre-push` 가 게이트 통과 기록이 없는 sha 를 막는다

## 어떻게 도는가

```
사람과 논의  →  spec.md 확정  ─┬─→  개발자: 구현 + 테스트   →  머지
                (= 사람 승인)   └─→  QA: spec 대조 체크리스트  →  머지
                                                                  │
                                        게이트(green) → push  ←───┘
```

**spec 커밋이 경계다.** 그 전은 논의가 본업이고, 그 뒤로는 묻지 않고 끝까지 간다. 요구사항은 대화가 아니라 **파일로 남는다.**

| 자리 | 형태 | 사람 | 하는 일 |
|---|---|:---:|---|
| **실행자** | 세션 (맨몸 `claude`) | 붙어 있다 | 하네스 자체를 고친다 · 기능 요청은 넘긴다 |
| **작업 세션** | 세션 (`harness spawn`) | 앞쪽만 | spec 을 쓰고 → 스폰 · 머지 · 게이트 · push |
| **개발자** | 서브에이전트 · 격리된 사본 | 없다 | 코드 + 테스트 |
| **QA** | 서브에이전트 · 격리된 사본 | 없다 | spec 인수기준 대 테스트 커버리지 표 |

서브에이전트에는 **셸이 없다.** 게이트도 커밋도 훅이 대신 돈다 — 능력을 주지 않는 것이 규칙을 적어두는 것보다 강하다.

막는 것은 네 겹이다: **도구 화이트리스트**(능력 자체를 뺀다) · **worktree 격리**(각자 자기 사본) · **`PreToolUse` 훅**(경로 소유권) · **git 훅**(보호 브랜치 · 부분 스테이징 · 깨진 spec · 미검증 push). 여기에 **종료 훅** 둘이 더 있다 — 겹이 *못 하게* 막는다면, 종료 훅은 **빈손이거나 깨진 상태로 못 끝내게** 막는다.

## 명령

`spawn` · `reap` · `gate` · `doctor` · `smoke` · `sync` 여섯이고, **표는 [docs/usage.md](./docs/usage.md#매일-쓰는-명령) 한 곳에만 둔다.**

> `smoke` 가 증명하는 것은 *부르면 도는가* 까지다. *Claude Code 가 실제로 부르는가* 는 세션을 띄워야만 안다 — 그래서 사람이 확인할 목록을 같이 찍는다.

## 아직 안 되는 것

- **macOS 의 `spawn` 이 테스트되지 않았다.** 코드는 있고 명령 본문까지는 검사되지만, **실제로 창이 뜨는 것을 아직 아무도 못 봤다**(개발 기계가 Windows다). Linux 판은 아예 없다 — 거기서는 없다고 말하고 멈춘다
- **POSIX 실행권한이 검증되지 않았다.** `.githooks/` 의 실행 비트를 Windows 에서 잴 수 없어 `smoke` 가 `?` 로 찍는다

## 이 저장소에서 개발하려면

```sh
npm install
git config core.hooksPath .githooks   # 층 2 를 붙인다
npm test                              # 게이트
```

하네스를 고치는 것은 **실행자**(맨몸 `claude`)의 일이고, 절차는 `/harness-fix` 에 있다. 무엇이 남았고 무엇을 이미 재봤는지는 [`docs/`](./docs/) 에 있다.

## 라이선스

MIT — 전문은 [LICENSE](./LICENSE) 에 있다.
