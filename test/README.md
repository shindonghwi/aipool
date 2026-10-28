# 테스트 규칙

목록은 짧습니다. 각 항목이 여기 있는 이유는, 그것을 어겼더니 아무것도 검사하지
않으면서 통과하는 테스트가 만들어졌기 때문입니다.

## 네트워크 성격의 테스트가 프록시에 닿지 못하게 하기

거부, 이름 해석 실패, 연결 리셋, 타임아웃처럼 **연결 수준**의 결과를 기대하는
테스트는 모두 환경에서 물려받는 프록시 설정을 쓰지 않도록 명시해야 합니다.

```js
import { setUpstreamProxy, resolveUpstreamProxy, resetUpstreamProxy } from '../src/upstream-proxy.js';

test.beforeEach(() => setUpstreamProxy(resolveUpstreamProxy({ upstreamProxy: false }, {})));
test.afterEach(() => resetUpstreamProxy());
```

두 부분 모두 필요합니다. `upstreamProxy: false`는 명시적으로 프록시를 끄는
옵트아웃이고, 비어 있는 두 번째 인수는 `resolveUpstreamProxy`가
`process.env`로 폴백하지 못하게 막습니다.

이것이 없으면 `HTTPS_PROXY`나 `ALL_PROXY`를 export해 둔 개발자 환경에서는
(흔한 일이고, 많은 회사 머신에서는 기본값입니다) 요청이 거부되지 않고
터널링됩니다. 프록시가 응답하고, 테스트는 전혀 다른 형태의 오류를 놓고
단언하는데도 그대로 통과합니다. 원래 검사하려던 것을 검사하지 못하는데,
그것도 아무 신호 없이, 일부 머신에서만 그렇습니다.

`NO_PROXY=127.0.0.1`은 방향만 반대인 같은 위험입니다. 모의(mock) 프록시를
*거쳐야 하는* 테스트가 조용히 직접 연결해 버리게 만듭니다. `87a7f78`이
업스트림 프록시 e2e 테스트에서 고친 문제가 바로 이것입니다.

**자식 프로세스를 띄우는 테스트는 이 변수들도 지워야 합니다.** 자식은 셸
환경을 물려받으므로 프로세스 안의 가드가 자식에게까지 미치지 않습니다.
`connect-error-message.test.js`를 참고하세요.

## `finally`에서 정리하기

단언이 실패하더라도 서버가 리스닝 상태로 남아서는 안 됩니다. 새어 나간 핸들은
자식 프로세스의 이벤트 루프를 계속 살려 두어, 핸들을 흘린 파일만이 아니라
`node --test` 실행 전체를 멈추게 합니다. 그래서 테스트 하나가 망가지면 빨간 줄
하나로 끝나지 않고 스위트 전체를 날리게 됩니다. `remote-control-relay.test.js`에
이 패턴이 있으며, 일부러 응답을 끝내지 않는 서버를 위한
`closeAllConnections()`도 함께 들어 있습니다.

## 지나가 버릴 날짜를 고정하지 않기

타임스탬프가 미래라고 단언하는 픽스처는 그 날짜가 지나는 날부터 아무것도
테스트하지 못하며, 실패는 작성한 사람이 아니라 그다음에 우연히 스위트를 돌린
사람에게 떨어집니다. 값을 `Date.now()`에서 계산하거나, 순서 대신 파싱 결과를
단언합니다. #260 이후로 `quota-probe.test.js`와 `scoped-weekly.test.js`에 두
방식이 모두 들어 있습니다.
