# ⚔️ 원 배틀 룰렛

항목(점심 메뉴 등)을 입력하면 원들이 경기장 안에서 무기를 주워 싸우고, 1등 또는 꼴등을 뽑아주는 웹 게임.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 에 정적 파일 생성
```

## 규칙
- 각 원 HP 10, 경기장 안을 튕기며 이동
- 무기가 무작위로 생성 → 습득 1초 후 무작위 상대 1명의 (발사 순간) 위치를 향해 사용 — 유도 없음
- ❤️ 회복 아이템(15% 확률, 동시에 1개까지): 닿으면 즉시 HP +3 (최대 10), 무기 소지 중에도 습득
- 👥 환각(10% 확률, 동시에 1개까지): 닿으면 즉시 분신 2개가 5초간 생김. 상대의 조준 후보에 분신이 포함되고, 분신은 공격에 닿으면 사라짐
- ☄️ 운석(희귀, 한 판 최대 2회): 발사 순간 상대 위치에 1.5초 뒤 낙하, 반경 안 모든 원(시전자 포함) 8 피해
- 30초 후 서든데스: 경기장이 줄고 벽에 닿으면 피해 1
- 입력: 쉼표로 여러 개, `이름*n`으로 같은 이름 n개 (최대 100개, 같은 이름은 색으로 구분)
- 맵 크기는 인원으로 자동 결정: Small ≤16, Medium ≤50, Large ≤100 (`src/game/size.ts`). 배틀은 `BATTLE_SIZE`(game.ts), 레이스는 `TRACK_SIZE`(race/track.ts)에서 크기별 수치 조정
- 1등 모드 = 마지막 생존자 / 꼴등 모드 = 첫 탈락자
- 같은 `?items=...&mode=...&seed=...` 링크는 항상 같은 경기를 재생
- 👥 같이 보기: `&start=<epoch ms>`가 붙은 링크는 각자의 시계로 시작 시각부터 지난 만큼 계산해서 모두 같은 장면을 봄 (서버 없음, `src/shell.ts`)

## 구조
| 파일 | 역할 |
|---|---|
| `src/game/game.ts` | 게임 규칙 (스폰, 발사, 피해, 탈락, 종료) — 렌더링과 분리 |
| `src/game/weapons.ts` | 무기 데미지·가중치 (밸런스는 여기서 조정) |
| `src/game/physics.ts` | 원 충돌, 경기장 벽 반사 |
| `src/game/rng.ts` | 시드 난수 |
| `src/render/canvas.ts` | Canvas 그리기 |
| `src/shell.ts` | 게임 공통 화면: 입력, 경기 루프, 결과, 공유 링크 (각 게임은 `GameDef`만 구현) |
| `src/main.ts` | 배틀 페이지 진입점 |
| `src/race/race.ts` | 레이스 물리, 진행도·순위, 추격 부스트, 얼음, 도착 판정 |
| `src/race/track.ts` | 🐍 지그재그 통로 코스 생성: 장애물 모듈 11종, 지름길 문, 얼음 대포, 포털 |
| `src/render/race-canvas.ts` | 레이스 그리기 (따라가는 카메라, 미니맵) |
| `src/race-main.ts` | 레이스 페이지 진입점 |

## 페이지
| 파일 | 내용 |
|---|---|
| `index.html` | ⚔️ 배틀 |
| `race.html` | 🏁 레이스 |
| `about.html` | 소개 |
| `contact.html` | 문의 |
| `privacy.html` | 개인정보처리방침 |

- 새 페이지를 추가하면 `vite.config.ts`의 `input`에도 등록해야 빌드에 포함됩니다.
- 문의 이메일은 `vite.config.ts`의 `CONTACT_EMAIL` 한 곳에서 관리합니다 (비우면 "준비 중" 표시).

## 배포 (Cloudflare)
- Framework preset: **Vite** / Build command: `npm run build` / Output: `dist`

## 공유 썸네일 (카카오톡·SNS 미리보기)
- 각 페이지 `<head>`의 `og:image`가 `public/og-battle.png`, `public/og-race.png`(1200×630)를 가리킴.
- 다시 만들 때: `npm run dev` 실행 후 아래 명령 (`tools/og.html`은 배포에 포함되지 않는 제작용 페이지)
  ```bash
  for g in battle race; do "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=8000 --screenshot="$PWD/public/og-$g.png" "http://localhost:5173/tools/og.html?game=$g"; done
  ```
- 카카오톡은 미리보기를 캐시하므로, 바꾼 뒤에는 [카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing)에서 주소를 넣고 캐시 초기화.
