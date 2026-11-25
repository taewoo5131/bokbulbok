/**
 * 🏁 레이스: 원들이 장애물 트랙을 굴러 내려가 결승선에 도착하는 순서로 결과를 정함.
 * 렌더링과 분리되어 있고, 모든 랜덤은 시드 RNG → 같은 (이름, 모드, 시드)면 같은 경기.
 */
import { colorFor } from '../game/colors';
import { collideBalls } from '../game/physics';
import { mulberry32, type Rng } from '../game/rng';
import { sizeFor, type MapSize } from '../game/size';
import type { Effect, Mode } from '../game/types';
import type { Result } from '../shell';
import {
  SLIDER_ROOF, TRACK_SIZE, buildTrack, gateOpen, sliderX,
  type Gate, type Peg, type Portal, type Segment, type Slider, type Spinner, type Track, type Zone,
} from './track';

const START_Y = 30;
const GRAVITY = 520;
const MAX_SPEED = 300;
const WALL_BOUNCE = 0.45;
const SUBSTEPS = 3;
const TIME_LIMIT: Record<MapSize, number> = { S: 150, M: 180, L: 210 };
/** 이 속도 이하로 이 시간 이상 멈춰 있으면 살짝 튕겨줌 (끼임 방지) */
const STUCK_SPEED = 18;
const STUCK_TIME = 1.2;
/** 장애물을 세로 띠로 나눠 가까운 것만 충돌 검사 (100명 성능용) */
const BAND = 100;
const BAND_MARGIN = 40;
/** 얼음 대포 */
const ICE_SPEED = 330;
const ICE_R = 7;
export const FREEZE_TIME = 3;

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
  /** 닫힌 함정문 위에서 기다리는 중 (끼임 판정 제외) */
  waiting: boolean;
  portalCd: number;
  /** 뒤로 보내는 포털은 한 번만 (무한 반복 방지) */
  sentBack: boolean;
  /** 얼어붙은 남은 시간. 0보다 크면 그 자리에 멈춤 */
  frozen: number;
}

export interface IceShot { x: number; y: number; vx: number }

interface Band {
  segments: Segment[];
  pegs: Peg[];
  spinners: Spinner[];
  sliders: Slider[];
  gates: Gate[];
  portals: Portal[];
  zones: Zone[];
}

export class Race {
  balls: RaceBall[] = [];
  effects: Effect[] = [];
  track: Track;
  readonly size: MapSize;
  time = 0;
  result: Result | null = null;
  private rng: Rng;
  private finishedCount = 0;
  private bands: Band[] = [];
  iceShots: IceShot[] = [];
  /** 대포별 마지막으로 쏜 차례 */
  private cannonShots: number[] = [];

  constructor(
    readonly names: string[],
    readonly mode: Mode,
    readonly seed: number,
  ) {
    this.rng = mulberry32(seed);
    const n = names.length;
    this.size = sizeFor(n);
    const W = TRACK_SIZE[this.size].width;

    // 출발 그리드: 한 줄에 들어가는 만큼 여러 줄로
    const r = this.size === 'S' ? Math.max(10, Math.min(17, 220 / (n + 4))) : 10;
    const pitch = r * 2 + 8;
    const perRow = Math.max(1, Math.floor((W - 60) / pitch));
    const rows = Math.ceil(n / perRow);
    this.track = buildTrack(this.rng, this.size, START_Y + rows * pitch);
    this.indexTrack();
    this.cannonShots = this.track.cannons.map((c) => Math.floor(c.phase / c.period));

    // 출발 위치는 무작위로 섞어서 입력 순서가 유불리에 영향 없게
    const slots = names.map((_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    names.forEach((name, id) => {
      const slot = slots[id];
      const row = Math.floor(slot / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      const col = slot % perRow;
      const span = (inRow - 1) * pitch;
      this.balls.push({
        id, name, color: colorFor(id),
        x: W / 2 - span / 2 + col * pitch,
        y: START_Y + row * pitch,
        vx: (this.rng() - 0.5) * 80,
        vy: 0,
        r, place: 0, stuck: 0, boosted: false, waiting: false, portalCd: 0, sentBack: false, frozen: 0,
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
    this.fireCannons();
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h, this.time - dt + h * (s + 1));

    for (const b of this.balls) {
      if (b.place) continue;
      if (b.y >= this.track.finishY) this.arrive(b);
    }
    this.checkEnd();
  }

  // ───────────────────────── 물리 ─────────────────────────

  private indexTrack(): void {
    const t = this.track;
    const count = Math.ceil((t.finishY + 400) / BAND) + 1;
    this.bands = Array.from({ length: count }, () => ({ segments: [], pegs: [], spinners: [], sliders: [], gates: [], portals: [], zones: [] }));
    const add = <K extends keyof Band>(key: K, item: Band[K][number], y0: number, y1: number) => {
      const a = Math.max(0, Math.floor((y0 - BAND_MARGIN) / BAND));
      const b = Math.min(count - 1, Math.floor((y1 + BAND_MARGIN) / BAND));
      for (let i = a; i <= b; i++) (this.bands[i][key] as Band[K][number][]).push(item);
    };
    for (const s of t.segments) add('segments', s, Math.min(s.y1, s.y2), Math.max(s.y1, s.y2));
    for (const p of t.pegs) add('pegs', p, p.y - p.r, p.y + p.r);
    for (const s of t.spinners) add('spinners', s, s.y - s.half, s.y + s.half);
    for (const s of t.sliders) add('sliders', s, s.y, s.y + SLIDER_ROOF);
    for (const g of t.gates) add('gates', g, g.y, g.y);
    for (const p of t.portals) add('portals', p, p.y - p.r, p.y + p.r);
    for (const z of t.zones) add('zones', z, z.y, z.y + z.h);
  }

  private bandAt(y: number): Band | null {
    const i = Math.floor(y / BAND);
    return i >= 0 && i < this.bands.length ? this.bands[i] : null;
  }

  private substep(h: number, t: number): void {
    const racing = this.balls.filter((b) => !b.place);
    const W = this.track.width;

    for (const b of racing) {
      if (b.frozen > 0) {
        b.frozen = Math.max(0, b.frozen - h);
        b.vx = 0;
        b.vy = 0;
        if (b.frozen === 0) this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: b.r * 2, color: '#bae6fd', t: 0, life: 0.4 });
        continue;
      }
      b.vy += GRAVITY * h;
      b.boosted = false;
      b.waiting = false;
      b.portalCd = Math.max(0, b.portalCd - h);
      const band = this.bandAt(b.y);
      if (band) {
        for (const z of band.zones) {
          if (b.x < z.x || b.x > z.x + z.w || b.y < z.y || b.y > z.y + z.h) continue;
          if (z.kind === 'boost') {
            b.vy += 1400 * h;
            b.boosted = true;
          } else if (z.kind === 'mud') {
            const k = Math.max(0, 1 - 4 * h);
            b.vx *= k;
            b.vy *= k;
          } else {
            // 역풍: 중력을 대부분 상쇄 + 아래로 가는 속도를 깎음
            b.vy -= 430 * h;
            if (b.vy > 60) b.vy *= Math.max(0, 1 - 2.5 * h);
          }
        }
      }
      const max = b.boosted ? MAX_SPEED * 1.6 : MAX_SPEED;
      const s = Math.hypot(b.vx, b.vy);
      if (s > max) {
        b.vx *= max / s;
        b.vy *= max / s;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
    }

    // 원끼리 충돌: 세로로 정렬해서 가까운 것만
    racing.sort((a, b) => a.y - b.y);
    for (let i = 0; i < racing.length; i++) {
      const a = racing[i];
      for (let j = i + 1; j < racing.length; j++) {
        const b = racing[j];
        if (b.y - a.y > a.r + b.r) break;
        if (a.frozen > 0 && b.frozen > 0) continue;
        // 얼어붙은 원은 움직이지 않는 장애물처럼
        if (a.frozen > 0) collidePeg(b, { x: a.x, y: a.y, r: a.r, bounce: 0.3 });
        else if (b.frozen > 0) collidePeg(a, { x: b.x, y: b.y, r: b.r, bounce: 0.3 });
        else collideBalls(a, b);
      }
    }

    this.moveIceShots(h, racing);

    for (const b of racing) {
      if (b.frozen > 0) continue;
      const band = this.bandAt(b.y);
      if (band) {
        for (const sg of band.segments) {
          const len = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
          const cv = sg.conveyor ?? 0;
          collideSegment(b, sg.x1, sg.y1, sg.x2, sg.y2, WALL_BOUNCE,
            ((sg.x2 - sg.x1) / len) * cv, ((sg.y2 - sg.y1) / len) * cv, 0, 0, 0, cv ? 0.25 : 0);
        }
        for (const p of band.pegs) collidePeg(b, p);
        for (const sp of band.spinners) {
          const a0 = sp.phase + sp.omega * t;
          for (let arm = 0; arm < sp.arms; arm++) {
            const a = a0 + (arm * Math.PI) / 2;
            const dx = Math.cos(a) * sp.half;
            const dy = Math.sin(a) * sp.half;
            collideSegment(b, sp.x - dx, sp.y - dy, sp.x + dx, sp.y + dy, 0.6, 0, 0, sp.x, sp.y, sp.omega, 0);
          }
        }
        for (const sl of band.sliders) {
          // 지붕(∧) 모양이라 위에 올라탄 원은 양옆으로 미끄러져 내려감
          const cx = sliderX(sl, t);
          const vx = sl.amp * sl.omega * Math.cos(sl.omega * t + sl.phase);
          collideSegment(b, cx - sl.half, sl.y + SLIDER_ROOF, cx, sl.y, 0.4, vx, 0, 0, 0, 0, 0);
          collideSegment(b, cx, sl.y, cx + sl.half, sl.y + SLIDER_ROOF, 0.4, vx, 0, 0, 0, 0, 0);
        }
        for (const g of band.gates) {
          if (gateOpen(g, t)) continue;
          const before = b.vy;
          collideSegment(b, g.x1, g.y, g.x2, g.y, 0.2, 0, 0, 0, 0, 0, 0);
          if (b.y < g.y && b.x >= g.x1 && b.x <= g.x2 && Math.abs(b.y + b.r - g.y) < 2 && before >= 0) b.waiting = true;
        }
        for (const p of band.portals) {
          if (b.portalCd > 0 || Math.hypot(b.x - p.x, b.y - p.y) > p.r) continue;
          if (!p.forward && b.sentBack) continue;
          this.teleport(b, p);
        }
      }
      // 좌우 벽
      if (b.x < b.r) {
        b.x = b.r;
        if (b.vx < 0) b.vx = -b.vx * WALL_BOUNCE;
      } else if (b.x > W - b.r) {
        b.x = W - b.r;
        if (b.vx > 0) b.vx = -b.vx * WALL_BOUNCE;
      }

      // 끼임 방지 (함정문 대기는 제외)
      if (!b.waiting && Math.hypot(b.vx, b.vy) < STUCK_SPEED) {
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

  // ───────────────────────── 얼음 대포 ─────────────────────────

  private fireCannons(): void {
    const W = this.track.width;
    this.track.cannons.forEach((c, i) => {
      const k = Math.floor((this.time + c.phase) / c.period);
      if (k <= this.cannonShots[i]) return;
      this.cannonShots[i] = k;
      this.iceShots.push({ x: c.dir > 0 ? 14 : W - 14, y: c.y, vx: c.dir * ICE_SPEED });
    });
  }

  private moveIceShots(h: number, racing: RaceBall[]): void {
    const W = this.track.width;
    this.iceShots = this.iceShots.filter((s) => {
      s.x += s.vx * h;
      if (s.x < -10 || s.x > W + 10) return false;
      for (const b of racing) {
        if (b.frozen > 0 || Math.abs(b.y - s.y) > b.r + ICE_R || Math.hypot(b.x - s.x, b.y - s.y) > b.r + ICE_R) continue;
        b.frozen = FREEZE_TIME;
        b.vx = 0;
        b.vy = 0;
        b.stuck = 0;
        this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: b.r * 2.4, color: '#7dd3fc', t: 0, life: 0.5 });
        this.effects.push({ kind: 'text', x: b.x, y: b.y - b.r - 16, text: `🧊 ${b.name} 얼음!`, color: '#bae6fd', t: 0, life: 1.2 });
        return false;
      }
      return true;
    });
  }

  private teleport(b: RaceBall, p: Portal): void {
    this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: 40, color: '#c084fc', t: 0, life: 0.5 });
    b.x = p.tx;
    b.y = p.ty;
    b.vx *= 0.3;
    b.vy = 40;
    b.portalCd = 1;
    if (!p.forward) b.sentBack = true;
    this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: 40, color: '#c084fc', t: 0, life: 0.5 });
    this.effects.push({
      kind: 'text', x: b.x, y: b.y - 26,
      text: p.forward ? `⏩ ${b.name} 워프!` : `⏪ ${b.name} 되돌아감!`,
      color: p.forward ? '#4ade80' : '#f87171', t: 0, life: 1.3,
    });
  }

  private arrive(b: RaceBall): void {
    this.finishedCount++;
    b.place = this.finishedCount;
    b.y = this.track.finishY + b.r + 4;
    if (b.place <= 3 || this.balls.length <= 16) {
      const medal = ['🥇', '🥈', '🥉'][b.place - 1] ?? `${b.place}위`;
      this.effects.push({ kind: 'text', x: b.x, y: b.y - 30, text: `${medal} ${b.name}`, color: '#f8fafc', t: 0, life: 1.6 });
    }
    this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: b.r * 2.5, color: b.color, t: 0, life: 0.6 });
    if (b.place === 1) this.effects.push({ kind: 'banner', text: `🏁 ${b.name} 1등 도착!`, color: '#fbbf24', t: 0, life: 1.8 });
  }

  private checkEnd(): void {
    const n = this.balls.length;
    const done =
      this.time >= TIME_LIMIT[this.size] ||
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
 * 원 vs 선분.
 * - (lvx, lvy): 선분 표면의 직선 속도 (컨베이어, 움직이는 막대)
 * - (cx, cy, omega): 회전 중심/각속도 (회전 막대)
 * - grip: 닿아 있는 동안 표면 속도에 끌려가는 정도 (0~1)
 */
function collideSegment(
  b: RaceBall, ax: number, ay: number, bx: number, by: number, bounce: number,
  lvx: number, lvy: number, cx: number, cy: number, omega: number, grip: number,
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
  const svx = lvx + (omega ? -omega * (py - cy) : 0);
  const svy = lvy + (omega ? omega * (px - cx) : 0);
  let rvx = b.vx - svx;
  let rvy = b.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    rvx -= (1 + bounce) * vn * nx;
    rvy -= (1 + bounce) * vn * ny;
  }
  if (grip) {
    // 접선 방향 상대 속도를 줄여 표면에 실려 가게
    const vt = rvx * -ny + rvy * nx;
    rvx -= vt * grip * -ny;
    rvy -= vt * grip * nx;
  }
  b.vx = rvx + svx;
  b.vy = rvy + svy;
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
