# PolicyTwin Codex Goal Pack 사용 방법

이 묶음은 Codex가 PolicyTwin을 빈 저장소에서 시작해 구현, 검증, 배포, 제출 자료 작성까지 이어가도록 구성되어 있습니다.

## 먼저 알아둘 점

공식 명령은 `/goals`가 아니라 **`/goal`**입니다.

긴 요구사항을 `/goal` 본문에 전부 넣으면 관리가 어렵습니다. 이 묶음은 역할을 나눴습니다.

- `AGENTS.md`: Codex가 매 세션 자동으로 읽는 작업 규칙
- `PLAN.md`: 제품 전체 설계와 M0~M10 완료 기준
- `PROGRESS.md`: 세션이 끊겨도 이어갈 수 있는 진행 기록
- `DECISIONS.md`: 기술·제품 결정 기록
- `SUBMISSION.md`: 배포, 영상, 저장소, 제출 확인 기준
- `GOAL_PROMPT.md`: 그대로 붙여 넣는 `/goal` 명령
- `START_HERE.md`: 상세 영문 사용 안내

## 실행 순서

1. 새 저장소 또는 작업할 저장소의 루트에 이 파일들을 모두 복사합니다.
2. Git 저장소가 아니라면 초기화하고 현재 브랜치에 기준 커밋을 만듭니다. 소유자가 명시적으로 지침을 바꾸기 전에는 새 브랜치나 작업 트리를 만들지 않습니다.
3. Codex를 저장소 루트에서 실행합니다.
4. 외부 네트워크 작업 범위를 먼저 명시적으로 승인한 뒤 GPT-5.6 API용 `OPENAI_API_KEY`와 필요한 Codex 인증을 환경 변수 또는 안전한 로그인 방식으로 설정합니다. 키를 파일에 적지 않습니다.
5. Codex에서 다음 문장을 먼저 실행합니다.

```text
Summarize the active repository instructions and confirm that you loaded AGENTS.md, PLAN.md, PROGRESS.md, DECISIONS.md, and SUBMISSION.md. Do not implement anything yet.
```

6. `GOAL_PROMPT.md`의 **Main command** 전체를 붙여 넣습니다.
7. 진행 확인은 같은 작업 안에서 `/goal` 또는 아래 문장을 사용합니다.

```text
Give me a compact status recap: current milestone, verified evidence, next action, blockers, and the latest commit.
```

## 검증 명령 구분

- `pnpm verify`: 네트워크, 인증 정보, 새 모델 응답이 필요 없는 결정론적 오프라인 검사
- `pnpm verify:live`: 승인된 네트워크 범위에서 실제 GPT-5.6과 Codex를 새로 실행하고 증거를 만드는 통합 검사
- 두 명령이 모두 통과해야 엔지니어링 및 제출 완료로 인정하며, 기록된 증거는 `pnpm verify:live`를 대신할 수 없습니다.

## `/goal`이 보이지 않을 때

```bash
codex features enable goals
```

또는 `~/.codex/config.toml`에 추가합니다.

```toml
[features]
goals = true
```

설정 후 Codex를 다시 시작합니다.

## 중간에 멈췄을 때

일반적인 구현 문제라면 Codex가 계속 해결하도록 설계되어 있습니다. 계정 로그인, CAPTCHA, 약관 동의, 결제, 외부 서비스의 소유자 확인처럼 사용자만 할 수 있는 작업이 생기면 Codex는 다른 작업을 모두 마친 뒤 한 가지 행동만 요청하고 멈추도록 되어 있습니다.

행동을 완료한 뒤:

```text
/goal resume
```

```text
The requested owner action is complete. Verify it rather than assuming success, update PROGRESS.md, and continue the existing goal from the next unmet acceptance gate.
```

## 완료 판정

다음 둘 중 하나만 최종 상태로 인정합니다.

- `SUBMITTED`: 라이브 URL, 저장소, 데모 영상, 챌린지 제출 확인까지 검증됨
- `READY_FOR_OWNER_ACTION`: 개발·검증·배포·영상·제출문구가 모두 끝났고 CAPTCHA나 최종 제출 클릭 같은 소유자 전용 행동 하나만 남음

테스트 일부 통과, MVP 구현, 배포 준비, 제출 초안 작성만으로는 완료가 아닙니다.
