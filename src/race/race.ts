/**
 * 🏁 레이스: 원들이 🐍 지그재그 통로 코스를 굴러가 결승에 도착하는 순서로 결과를 정함.
 * 렌더링과 분리되어 있고, 모든 랜덤은 시드 RNG → 같은 (이름, 모드, 시드)면 같은 경기.
 */
import { colorFor } from '../game/colors';
import { collideBalls } from '../game/physics';
import { mulberry32, type Rng } from '../game/rng';
import { sizeFor, type MapSize } from '../game/size';
import type { Effect, Mode } from '../game/types';
import type { Result } from '../shell';
import {
  buildTrack, floorY, gateOpen, progressAt, totalProgress,
  type Gate, type Peg, type Portal, type Segment, type Spinner, type Track, type Zone,
} from './track';

const GRAVITY = 520;
const MAX_SPEED = 300;
const WALL_BOUNCE = 0.45;
const SUBSTEPS = 3;
const TIME_LIMIT: Record<MapSize, number> = { S: 180, M: 210, L: 240 };
/** 이 속도 이하로 이 시간 이상 멈춰 있으면 살짝 튕겨줌 (끼임 방지) */
const STUCK_SPEED = 18;
const STUCK_TIME = 1.2;
/** 앞으로 거의 못 나가고 같은 곳을 맴돌면(컨베이어·역풍 등) 앞으로 밀어줌 */
const STALL_TIME = 4;
const STALL_GAIN = 40;
/** 장애물을 세로 띠로 나눠 가까운 것만 충돌 검사 (100명 성능용) */
const BAND = 100;
const BAND_MARGIN = 40;
const ICE_R = 7;
/**
 * 🔥 추격 부스트: 선두와 멀리 떨어진 원일수록 진행 방향으로 더 세게 밀어줌.
 * 선두와의 거리가 CHASE_START(코스 폭 비율)를 넘으면 시작해서 CHASE_FULL에서 최대.
 */
const CHASE_START = 0.15;
const CHASE_FULL = 1;
const CHASE_ACCEL = 520;
const CHASE_SPEED_BONUS = 0.6;
export const FREEZE_TIME = 3;
/** 얼음이 날아가는 최대 거리 */
const ICE_RANGE = 520;
/** 녹은 직후 다시 얼지 않는 시간 */
const ICE_IMMUNE = 3;

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
  /** 코스 진행도 (클수록 앞) */
  progress: number;
  stuck: number;
  stall: number;
  /** 같은 자리에서 연달아 멈춘 횟수 */
  stallCount: number;
  best: number;
  /** 부스터 위에 있는지 (연출용) */
  boosted: boolean;
  /** 닫힌 문 앞에서 기다리는 중 (끼임 판정 제외) */
  waiting: boolean;
  portalCd: number;
  /** 뒤로 보내는 포털은 한 번만 (무한 반복 방지) */
  sentBack: boolean;
  /** 얼어붙은 남은 시간. 0보다 크면 그 자리에 멈춤 */
  frozen: number;
  /** 녹은 뒤 얼음 면역 남은 시간 */
  iceImmune: number;
  /** 추격 부스트 세기 0~1 (연출용) */
  chase: number;
}

export interface IceShot { x: number; y: number; vx: number; vy: number; dist: number }

interface Band {
  segments: Segment[];
  pegs: Peg[];
  spinners: Spinner[];
  gates: Gate[];
  portals: Portal[];
  zones: Zone[];
}

export class Race {
  balls: RaceBall[] = [];
  effects: Effect[] = [];
  iceShots: IceShot[] = [];
  track: Track;
  readonly size: MapSize;
  readonly total: number;
  time = 0;
  result: Result | null = null;
  private rng: Rng;
  private finishedCount = 0;
  private bands: Band[] = [];
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
    this.track = buildTrack(this.rng, this.size);
    this.total = totalProgress(this.track);
    this.indexTrack();
    this.cannonShots = this.track.cannons.map((c) => Math.floor(c.phase / c.period));

    // 출발: 첫 통로 입구 바닥 위에 격자로 (자리는 무작위로 섞어 입력 순서와 무관하게)
    const r = this.size === 'S' ? Math.max(10, Math.min(17, 220 / (n + 4))) : 10;
    const pitch = r * 2 + 6;
    const perRow = Math.max(1, Math.floor(Math.min(460, this.track.width * 0.33) / pitch));
    const slots = names.map((_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    names.forEach((name, id) => {
      const slot = slots[id];
      const x = 20 + r + (slot % perRow) * pitch;
      const y = floorY(this.track, 0, x) - r - 2 - Math.floor(slot / perRow) * pitch;
      this.balls.push({
        id, name, color: colorFor(id), x, y,
        vx: (this.rng() - 0.5) * 40, vy: 0, r,
        place: 0, progress: 0, stuck: 0, stall: 0, stallCount: 0, best: 0,
        boosted: false, waiting: false, portalCd: 0, sentBack: false, frozen: 0, iceImmune: 0, chase: 0,
      });
    });
    for (const b of this.balls) b.best = b.progress = progressAt(this.track, b.x, b.y);
  }

  get finished(): boolean {
    return this.result !== null;
  }

  get arrived(): number {
    return this.finishedCount;
  }

  /** 1등 → 꼴등 현재 순위 (도착한 순서, 그다음 코스를 많이 간 순) */
  standings(): RaceBall[] {
    return [...this.balls].sort((a, b) => {
      if (a.place && b.place) return a.place - b.place;
      if (a.place) return -1;
      if (b.place) return 1;
      return b.progress - a.progress || a.id - b.id;
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
      if (b.y >= this.track.finishY) {
        this.arrive(b);
        continue;
      }
      b.progress = progressAt(this.track, b.x, b.y);
      this.checkStall(b, dt);
    }
    this.checkEnd();
  }

  // ───────────────────────── 물리 ─────────────────────────

  private indexTrack(): void {
    const t = this.track;
    const count = Math.ceil((t.finishY + 400) / BAND) + 1;
    this.bands = Array.from({ length: count }, () => ({ segments: [], pegs: [], spinners: [], gates: [], portals: [], zones: [] }));
    const add = <K extends keyof Band>(key: K, item: Band[K][number], y0: number, y1: number) => {
      const a = Math.max(0, Math.floor((y0 - BAND_MARGIN) / BAND));
      const b = Math.min(count - 1, Math.floor((y1 + BAND_MARGIN) / BAND));
      for (let i = a; i <= b; i++) (this.bands[i][key] as Band[K][number][]).push(item);
    };
    for (const s of t.segments) add('segments', s, Math.min(s.y1, s.y2), Math.max(s.y1, s.y2));
    for (const p of t.pegs) add('pegs', p, p.y - p.r, p.y + p.r);
    for (const s of t.spinners) add('spinners', s, s.y - s.half, s.y + s.half);
    for (const g of t.gates) add('gates', g, Math.min(g.y1, g.y2), Math.max(g.y1, g.y2));
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
    const lead = racing.reduce((m, b) => Math.max(m, b.progress), 0);

    for (const b of racing) {
      if (b.frozen > 0) {
        b.frozen = Math.max(0, b.frozen - h);
        b.vx = 0;
        b.vy = 0;
        if (b.frozen === 0) b.iceImmune = ICE_IMMUNE;
        if (b.frozen === 0) this.effects.push({ kind: 'ring', x: b.x, y: b.y, radius: b.r * 2, color: '#bae6fd', t: 0, life: 0.4 });
        continue;
      }
      b.iceImmune = Math.max(0, b.iceImmune - h);
      b.vy += GRAVITY * h;
      b.boosted = false;
      b.waiting = false;
      b.portalCd = Math.max(0, b.portalCd - h);
      const band = this.bandAt(b.y);
      if (band) {
        for (const z of band.zones) {
          if (b.x < z.x || b.x > z.x + z.w || b.y < z.y || b.y > z.y + z.h) continue;
          if (z.kind === 'boost') {
            b.vx += z.dir * 900 * h;
            b.boosted = true;
          } else if (z.kind === 'mud') {
            // 진흙: 빠를수록 많이 느려지지만 기어가는 속도 아래로는 안 떨어뜨림
            if (Math.hypot(b.vx, b.vy) > 80) {
              const k = Math.max(0, 1 - 1.6 * h);
              b.vx *= k;
              b.vy *= k;
            }
          } else if (b.vx * z.dir > 100) {
            // 역풍: 앞으로 가는 속도를 깎지만 뒤로 밀지는 않음
            b.vx -= z.dir * 450 * h;
          }
        }
      }
      // 추격 부스트
      b.chase = Math.max(0, Math.min(1, ((lead - b.progress) / W - CHASE_START) / (CHASE_FULL - CHASE_START)));
      if (b.chase > 0) {
        const k = Math.min(this.track.corridors.length - 1, Math.floor(b.progress / W));
        b.vx += this.track.corridors[k].dir * CHASE_ACCEL * b.chase * h;
      }
      const max = (b.boosted ? MAX_SPEED * 1.6 : MAX_SPEED) * (1 + CHASE_SPEED_BONUS * b.chase);
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
          const cv = sg.conveyor ?? 0;
          if (cv) {
            const len = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
            collideSegment(b, sg.x1, sg.y1, sg.x2, sg.y2, WALL_BOUNCE, ((sg.x2 - sg.x1) / len) * cv, ((sg.y2 - sg.y1) / len) * cv, 0, 0, 0, 0.2);
          } else {
            collideSegment(b, sg.x1, sg.y1, sg.x2, sg.y2, sg.kind === 'ramp' ? 0.2 : WALL_BOUNCE, 0, 0, 0, 0, 0, 0);
          }
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
        for (const g of band.gates) {
          if (gateOpen(g, t)) continue;
          if (collideSegment(b, g.x1, g.y1, g.x2, g.y2, 0.2, 0, 0, 0, 0, 0, 0)) b.waiting = true;
        }
        for (const p of band.portals) {
          if (b.portalCd > 0 || Math.hypot(b.x - p.x, b.y - p.y) > p.r) continue;
          if (!p.forward && b.sentBack) continue;
          this.teleport(b, p);
        }
      }
      // 바깥 벽
      if (b.x < b.r) {
        b.x = b.r;
        if (b.vx < 0) b.vx = -b.vx * WALL_BOUNCE;
      } else if (b.x > W - b.r) {
        b.x = W - b.r;
        if (b.vx > 0) b.vx = -b.vx * WALL_BOUNCE;
      }

      // 끼임 방지 (문 앞 대기는 제외)
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

  /** 오래 앞으로 못 나가면(문 앞 대기·얼음 제외) 진행 방향으로 밀어줌 */
  private checkStall(b: RaceBall, dt: number): void {
    if (b.progress > b.best + STALL_GAIN) {
      b.best = b.progress;
      b.stall = 0;
      b.stallCount = 0;
      return;
    }
    if (b.waiting || b.frozen > 0) return;
    b.stall += dt;
    if (b.stall < STALL_TIME) return;
    const k = Math.min(this.track.corridors.length - 1, Math.floor(b.progress / this.track.width));
    const dir = this.track.corridors[k].dir;
    b.stallCount++;
    if (b.stallCount >= 3) {
      // 그래도 못 빠져나가면 바닥을 따라 조금 앞으로 옮겨줌 (최후의 안전장치)
      b.x = Math.max(b.r, Math.min(this.track.width - b.r, b.x + dir * 70));
      b.y = floorY(this.track, k, b.x) - b.r - 2;
      b.stallCount = 0;
    }
    b.vx = dir * 260;
    b.vy = -160;
    b.stall = 0;
    b.best = b.progress;
  }

  // ───────────────────────── 얼음 대포 ─────────────────────────

  private fireCannons(): void {
    this.track.cannons.forEach((c, i) => {
      const k = Math.floor((this.time + c.phase) / c.period);
      if (k <= this.cannonShots[i]) return;
      this.cannonShots[i] = k;
      this.iceShots.push({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, dist: 0 });
    });
  }

  private moveIceShots(h: number, racing: RaceBall[]): void {
    const W = this.track.width;
    this.iceShots = this.iceShots.filter((s) => {
      s.x += s.vx * h;
      s.y += s.vy * h;
      s.dist += Math.hypot(s.vx, s.vy) * h;
      if (s.x < -10 || s.x > W + 10 || s.dist > ICE_RANGE) return false;
      for (const b of racing) {
        if (b.frozen > 0 || b.iceImmune > 0 || Math.abs(b.y - s.y) > b.r + ICE_R || Math.hypot(b.x - s.x, b.y - s.y) > b.r + ICE_R) continue;
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
    b.progress = this.total;
    b.frozen = 0;
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
 * 원 vs 선분. 닿았으면 true.
 * - (lvx, lvy): 선분 표면의 직선 속도 (컨베이어)
 * - (cx, cy, omega): 회전 중심/각속도 (회전 막대)
 * - grip: 닿아 있는 동안 표면 속도에 끌려가는 정도 (0~1)
 */
function collideSegment(
  b: RaceBall, ax: number, ay: number, bx: number, by: number, bounce: number,
  lvx: number, lvy: number, cx: number, cy: number, omega: number, grip: number,
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = Math.max(0, Math.min(1, ((b.x - ax) * abx + (b.y - ay) * aby) / len2));
  const px = ax + abx * t;
  const py = ay + aby * t;
  let nx = b.x - px;
  let ny = b.y - py;
  let d = Math.hypot(nx, ny);
  if (d >= b.r) return false;
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
  return true;
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
