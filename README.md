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
- 30초 후 서든데스: 경기장이 줄고 벽에 닿으면 피해 1
- 1등 모드 = 마지막 생존자 / 꼴등 모드 = 첫 탈락자
- 같은 `?items=...&mode=...&seed=...` 링크는 항상 같은 경기를 재생

## 구조
| 파일 | 역할 |
|---|---|
| `src/game/game.ts` | 게임 규칙 (스폰, 발사, 피해, 탈락, 종료) — 렌더링과 분리 |
| `src/game/weapons.ts` | 무기 데미지·가중치 (밸런스는 여기서 조정) |
| `src/game/physics.ts` | 원 충돌, 경기장 벽 반사 |
| `src/game/rng.ts` | 시드 난수 |
| `src/render/canvas.ts` | Canvas 그리기 |
| `src/main.ts` | 화면 전환, 입력, 결과, 공유 링크 |

## 배포 (Cloudflare Pages)
- Framework preset: **Vite** / Build command: `npm run build` / Output: `dist`
