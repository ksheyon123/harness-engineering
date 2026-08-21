#!/usr/bin/env node
/**
 * 게이트가 green 으로 끝난 커밋을 기록한다. `package.json` 의 `posttest` 가 부른다 —
 * npm 은 `test` 가 **성공했을 때만** `posttest` 를 돌리므로, 이 파일이 불렸다는 것 자체가
 * 곧 "이 sha 에서 게이트가 통과했다" 는 뜻이다.
 *
 * `pre-push` 가 그 기록을 읽는다. 둘을 나눈 이유는 **게이트 정의의 단일 출처를 지키기**
 * 위해서다 — 무엇을 돌릴지는 `scripts.test` 가 정하고, 여기는 그 결과를 적기만 한다.
 *
 * ## **`init` 은 더 이상 이것을 배선하지 않는다**
 *
 * `posttest` 는 A 의 `package.json` 에 사는데 그 파일은 언제나 추적된다. 그래서 그 한 줄이
 * **커밋을 타고 팀 전체에 전파되고**, 하네스를 설치한 적 없는 사람의 `npm test` 까지
 * 하네스를 실행시킨다 — 하네스의 나머지는 로컬 설정으로 옵트인하는데 이것만 그 경계를
 * 깬다. 자세한 것과 실측은 `scripts/gate.mjs` 머리주석에 있다.
 *
 * 그래서 지금 기록을 남기는 자리는 **`harness gate`** 다. 이 파일은 **A 가 스스로 `posttest`
 * 에 걸었을 때**를 위해 남아 있다 — 그건 A 의 결정이고, 하네스가 대신 정하지 않는다.
 *
 * **적는 방법은 `recordVerified` 하나뿐이다.** 사본이 둘이면 한쪽이 형식을 바꿀 때 다른
 * 쪽이 남긴 기록을 `pre-push` 가 조용히 못 읽는다.
 */

import { recordVerified } from "./verified-marker.mjs";

recordVerified();
