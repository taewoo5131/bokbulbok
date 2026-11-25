/**
 * 🏁 레이스: 원들이 장애물 트랙을 굴러 내려가 결승선에 도착하는 순서로 결과를 정함.
 * 렌더링과 분리되어 있고, 모든 랜덤은 시드 RNG → 같은 (이름, 모드, 시드)면 같은 경기.
 */
import { BALL_COLORS } from '../game/colors';
import { collideBalls } from '../game/physics';
import { mulberry32, type Rng } from '../game/rng';
import type { Effect, Mode } from '../game/types';
import type { Result } from '../shell';

export const TRACK_W = 600;
const START_Y = 40;
const FIRST_SECTION_Y = 140;
const SECTION_COUNT = 7;
const GRAVITY = 520;
const MAX_SPEED = 300;
const WALL_BOUNCE = 0.45;
const SUBSTEPS = 3;
const TIME_LIMIT = 120;
/** 이 속도 이하로 이 시간 이상 멈춰 있으면 살짝 튕겨줌 (끼임 방지) */
const STUCK_SPEED = 18;
const STUCK_TIME = 1.2;
const TAU = Math.PI * 2;

export interface RaceBall {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 도착 순서 (1부터), 아직이면 0 */
  place: number;
  stuck: number;
  /** 부스터 위에 있는지 (연출용) */
  boosted: boolean;
}

export interface Segment { x1: number; y1: number; x2: number; y2: number }
export interface Peg { x: number; y: number; r: number; bounce: number }
export interface Spinner { x: number; y: number; half: number; omega: number; phase: number }
export interface Zone { x: number; y: number; w: number; h: number; kind: 'boost' | 'mud' }

export interface Track {
  segments: Segment[];
  pegs: Peg[];
  spinners: Spinner[];
  zones: Zone[];
  finishY: number;
}

export class Race {
  balls: RaceBall[] = [];
  effects: Effect[] = [];
  track: Track;
  time = 0;
  result: Result | null = null;
  private rng: Rng;
  private finishedCount = 0;

  constructor(
    readonly names: string[],
    readonly mode: Mode,
    readonly seed: number,
  ) {
    this.rng = mulberry32(seed);
    this.track = buildTrack(this.rng);

    const n = names.length;
    const r = Math.max(10, Math.min(17, 220 / (n + 4)));
    // 출발 위치는 무작위로 섞어서 입력 순서가 유불리에 영향 없게
    const slots = names.map((_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const left = 40;
    const span = TRACK_W - 80;
    names.forEach((name, id) => {
      const slot = slots[id];
      this.balls.push({
        id, name, color: BALL_COLORS[id % BALL_COLORS.length],
        x: n === 1 ? TRACK_W / 2 : left + (span * slot) / (n - 1),
        y: START_Y + (slot % 2) * (r * 2 + 4),
        vx: (this.rng() - 0.5) * 80,
        vy: 0,
        r, place: 0, stuck: 0, boosted: false,
      });
    });
  }

  get finished(): boolean {
    return this.result !== null;
  }

  get finishY(): number {
    return this.track.finishY;
  }

  get arrived(): number {
    return this.finishedCount;
  }

  /** 1등 → 꼴등 현재 순위 (도착한 순서, 그다음 많이 내려간 순) */
  standings(): RaceBall[] {
    return [...this.balls].sort((a, b) => {
      if (a.place && b.place) return a.place - b.place;
      if (a.place) return -1;
      if (b.place) return 1;
      return b.y - a.y || a.id - b.id;
    });
  }

  step(dt: number): void {
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < e.life);
    if (this.finished) return;

    this.time += dt;
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h, this.time - dt + h * (s + 1));

    for (const b of this.balls) {
      if (b.place) continue;
      if (b.y >= this.track.finishY) this.arrive(b);
    }
    this.checkEnd();
  }

  private substep(h: number, t: number): void {
    const racing = this.balls.filter((b) => !b.place);
    const { segments, pegs, spinners, zones } = this.track;

    for (const b of racing) {
      b.vy += GRAVITY * h;
      b.boosted = false;
      for (const z of zones) {
        if (b.x < z.x || b.x > z.x + z.w || b.y < z.y || b.y > z.y + z.h) continue;
        if (z.kind === 'boost') {
          b.vy += 1400 * h;
          b.boosted = true;
        } else {
          const k = Math.max(0, 1 - 4 * h);
          b.vx *= k;
          b.vy *= k;
        }
      }
      // 속도 제한 (부스터 위에서는 조금 더 빠르게)
      const max = b.boosted ? MAX_SPEED * 1.6 : MAX_SPEED;
      const s = Math.hypot(b.vx, b.vy);
      if (s > max) {
        b.vx *= max / s;
        b.vy *= max / s;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
    }

    for (let i = 0; i < racing.length; i++) {
      for (let j = i + 1; j < racing.length; j++) collideBalls(racing[i], racing[j]);
    }

    for (const b of racing) {
      for (const sg of segments) collideSegment(b, sg.x1, sg.y1, sg.x2, sg.y2, WALL_BOUNCE, 0, 0, 0);
      for (const p of pegs) collidePeg(b, p);
      for (const sp of spinners) {
        const a = sp.phase + sp.omega * t;
        const dx = Math.cos(a) * sp.half;
        const dy = Math.sin(a) * sp.half;
        collideSegment(b, sp.x - dx, sp.y - dy, sp.x + dx, sp.y + dy, 0.6, sp.x, sp.y, sp.omega);
      }
      // 좌우 벽
      if (b.x < b.r) {
        b.x = b.r;
        if (b.vx < 0) b.vx = -b.vx * WALL_BOUNCE;
      } else if (b.x > TRACK_W - b.r) {
        b.x = TRACK_W - b.r;
        if (b.vx > 0) b.vx = -b.vx * WALL_BOUNCE;
      }

      // 끼임 방지
      if (Math.hypot(b.vx, b.vy) < STUCK_SPEED) {
        b.stuck += h;
        if (b.stuck > STUCK_TIME) {
          const a = -Math.PI / 2 + (this.rng() - 0.5) * 2.4;
          b.vx = Math.cos(a) * 220;
          b.vy = Math.sin(a) * 220;
          b.stuck = 0;
        }
      } else {
        b.stuck = 0;
      }
    }
  }

  private arrive(b: RaceBall): void {
    this.finishedCount++;
    b.place = this.finishedCount;
    b.y = this.track.finishY + b.r + 4;
    const medal = ['🥇', '🥈', '🥉'][b.place - 1] ?? `${b.place}위`;
    this.effects.push({ kind: 'text', x: b.x, y: b.y - 30, text: `${medal} ${b.name}`, color: '#f8fafc', t: 0, life: 1.6 });
    this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: b.r * 2.5, color: b.color, t: 0, life: 0.6 });
    if (b.place === 1) this.effects.push({ kind: 'banner', text: `🏁 ${b.name} 1등 도착!`, color: '#fbbf24', t: 0, life: 1.8 });
  }

  private checkEnd(): void {
    const n = this.balls.length;
    const done =
      this.time >= TIME_LIMIT ||
      (this.mode === 'winner' && this.finishedCount >= 1) ||
      (this.mode === 'loser' && this.finishedCount >= n - 1);
    if (!done) return;
    const ranking = this.standings();
    const picked = this.mode === 'winner' ? ranking[0] : ranking[ranking.length - 1];
    if (this.mode === 'loser' && !picked.place) {
      this.effects.push({ kind: 'banner', text: `🐢 ${picked.name} 꼴등 확정!`, color: '#f87171', t: 0, life: 1.8 });
    }
    this.result = { mode: this.mode, picked, ranking };
  }
}

// ───────────────────────── 충돌 ─────────────────────────

/**
 * 원 vs 선분. (cx, cy, omega)가 있으면 그 점을 중심으로 회전하는 선분으로 보고 표면 속도를 반영.
 */
function collideSegment(
  b: RaceBall, ax: number, ay: number, bx: number, by: number,
  bounce: number, cx: number, cy: number, omega: number,
): void {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = Math.max(0, Math.min(1, ((b.x - ax) * abx + (b.y - ay) * aby) / len2));
  const px = ax + abx * t;
  const py = ay + aby * t;
  let nx = b.x - px;
  let ny = b.y - py;
  let d = Math.hypot(nx, ny);
  if (d >= b.r) return;
  if (d === 0) {
    nx = -aby;
    ny = abx;
    d = Math.hypot(nx, ny);
  }
  nx /= d;
  ny /= d;
  b.x = px + nx * b.r;
  b.y = py + ny * b.r;
  // 회전 선분의 접점 속도
  const svx = omega ? -omega * (py - cy) : 0;
  const svy = omega ? omega * (px - cx) : 0;
  const rvx = b.vx - svx;
  const rvy = b.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    b.vx = rvx - (1 + bounce) * vn * nx + svx;
    b.vy = rvy - (1 + bounce) * vn * ny + svy;
  }
}

function collidePeg(b: RaceBall, p: Peg): void {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const d = Math.hypot(dx, dy);
  const min = b.r + p.r;
  if (d >= min || d === 0) return;
  const nx = dx / d;
  const ny = dy / d;
  b.x = p.x + nx * min;
  b.y = p.y + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + p.bounce) * vn * nx;
    b.vy -= (1 + p.bounce) * vn * ny;
  }
}

// ───────────────────────── 트랙 생성 ─────────────────────────

type SectionBuilder = (t: Track, y: number, rng: Rng) => number;

const W = TRACK_W;

/** 핀 밭: 엇갈린 핀 사이로 튕기며 내려감 */
const pegField: SectionBuilder = (t, y, rng) => {
  const rows = 6;
  const gapX = 75;
  const offset = rng() * gapX;
  for (let row = 0; row < rows; row++) {
    const shift = (row % 2) * (gapX / 2) + offset;
    for (let x = 30 + (shift % gapX); x < W - 20; x += gapX) {
      if (rng() < 0.12) continue; // 군데군데 빈자리
      t.pegs.push({ x, y: y + 40 + row * 62, r: 8, bounce: 0.5 });
    }
  }
  return 40 + rows * 62 + 40;
};

/** 지그재그 경사로: 좌우로 굴러 내려감 */
const zigzag: SectionBuilder = (t, y, rng) => {
  const count = 3;
  const gap = 110 + rng() * 30;
  let fromLeft = rng() < 0.5;
  let cy = y + 30;
  for (let i = 0; i < count; i++) {
    const drop = 70 + rng() * 30;
    if (fromLeft) t.segments.push({ x1: 0, y1: cy, x2: W - gap, y2: cy + drop });
    else t.segments.push({ x1: W, y1: cy, x2: gap, y2: cy + drop });
    fromLeft = !fromLeft;
    cy += drop + 70;
  }
  return cy - y + 20;
};

/** 깔때기: 가운데 좁은 입구로 몰림 (병목에서 순위가 뒤바뀜) */
const funnel: SectionBuilder = (t, y, rng) => {
  const gap = 90 + rng() * 30;
  const cx = W / 2 + (rng() - 0.5) * 120;
  t.segments.push({ x1: 0, y1: y + 20, x2: cx - gap / 2, y2: y + 220 });
  t.segments.push({ x1: W, y1: y + 20, x2: cx + gap / 2, y2: y + 220 });
  // 출구 아래 범퍼로 다시 흩어짐
  t.pegs.push({ x: cx, y: y + 300, r: 22, bounce: 1.1 });
  return 360;
};

/** 회전 막대: 돌아가는 막대에 맞으면 튕겨 나감 */
const spinners: SectionBuilder = (t, y, rng) => {
  const rows = 2;
  for (let row = 0; row < rows; row++) {
    const xs = row % 2 === 0 ? [W * 0.2, W * 0.5, W * 0.8] : [W * 0.35, W * 0.65];
    for (const x of xs) {
      t.spinners.push({
        x, y: y + 80 + row * 170,
        half: 52 + rng() * 14,
        omega: (rng() < 0.5 ? -1 : 1) * (1.8 + rng() * 1.4),
        phase: rng() * TAU,
      });
    }
  }
  return 80 + rows * 170 + 20;
};

/** 갈림길: 세 갈래 중 부스터·진흙·일반 길이 무작위로 배치 */
const lanes: SectionBuilder = (t, y, rng) => {
  const top = y + 70;
  const h = 260;
  const kinds: ('boost' | 'mud' | null)[] = ['boost', 'mud', null];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const laneW = W / 3;
  t.pegs.push({ x: laneW, y: y + 30, r: 10, bounce: 0.6 });
  t.pegs.push({ x: laneW * 2, y: y + 30, r: 10, bounce: 0.6 });
  t.segments.push({ x1: laneW, y1: top, x2: laneW, y2: top + h });
  t.segments.push({ x1: laneW * 2, y1: top, x2: laneW * 2, y2: top + h });
  kinds.forEach((kind, i) => {
    if (kind) t.zones.push({ x: laneW * i + 6, y: top + 30, w: laneW - 12, h: h - 60, kind });
  });
  return 70 + h + 40;
};

/** 범퍼: 크게 튕겨내는 둥근 범퍼 */
const bumpers: SectionBuilder = (t, y, rng) => {
  const count = 5;
  for (let i = 0; i < count; i++) {
    t.pegs.push({
      x: 70 + rng() * (W - 140),
      y: y + 50 + (i * 300) / count + rng() * 30,
      r: 18 + rng() * 10,
      bounce: 1.15,
    });
  }
  return 380;
};

const BUILDERS = [pegField, zigzag, funnel, spinners, lanes, bumpers];

function buildTrack(rng: Rng): Track {
  const t: Track = { segments: [], pegs: [], spinners: [], zones: [], finishY: 0 };
  // 6종을 한 번씩 섞어 쓰고 모자라면 다시 무작위
  const order = [...BUILDERS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  while (order.length < SECTION_COUNT) order.push(BUILDERS[Math.floor(rng() * BUILDERS.length)]);

  let y = FIRST_SECTION_Y;
  for (const build of order.slice(0, SECTION_COUNT)) y += build(t, y, rng);
  t.finishY = y + 80;
  return t;
}
