/**
 * 레이스 트랙: 🐍 뱀 모양(지그재그 통로) 코스.
 * 통로 k는 짝수면 왼→오, 홀수면 오→왼으로 진행. 바닥은 진행 방향으로 살짝 기울어 있고,
 * 끝의 구멍으로 떨어지면 아래 통로가 시작됨. 바닥 중간의 🎰 지름길 문이 열린 순간 빠지면
 * 아래 통로 한가운데로 떨어져 크게 앞서 나감.
 * 모든 랜덤은 전달받은 시드 RNG만 사용 → 같은 시드면 같은 트랙.
 */
import type { Rng } from '../game/rng';
import type { MapSize } from '../game/size';

export interface Segment { x1: number; y1: number; x2: number; y2: number; /** 컨베이어: x1→x2 방향으로 표면이 움직이는 속도 */ conveyor?: number; kind?: 'floor' | 'ramp' }
export interface Peg { x: number; y: number; r: number; bounce: number }
/** 회전 막대. arms=2면 십자 풍차 */
export interface Spinner { x: number; y: number; half: number; omega: number; phase: number; arms: 1 | 2 }
/** 주기적으로 열리는 문. floor=바닥(지름길), barrier=통로를 막는 세로 문 */
export interface Gate { x1: number; y1: number; x2: number; y2: number; kind: 'floor' | 'barrier'; period: number; openFor: number; phase: number }
/** 들어가면 다른 위치로 순간이동. 앞으로 갈지 뒤로 갈지는 겉보기로 알 수 없음 */
export interface Portal { x: number; y: number; r: number; tx: number; ty: number; forward: boolean }
/** dir: 그 통로의 진행 방향(1=오른쪽). boost는 앞으로 밀고, wind는 앞으로 가는 속도를 깎음 */
export interface Zone { x: number; y: number; w: number; h: number; kind: 'boost' | 'mud' | 'wind'; dir: 1 | -1 }
/** 통로 출구 벽의 얼음 대포. 바닥 기울기를 따라 거꾸로(입구 쪽으로) 얼음을 쏨 */
export interface IceCannon { x: number; y: number; vx: number; vy: number; period: number; phase: number }
export interface SectionLabel { x: number; y: number; text: string }
export interface Corridor { base: number; dir: 1 | -1 }

export interface Track {
  width: number;
  slope: number;
  hole: number;
  corridors: Corridor[];
  finishY: number;
  segments: Segment[];
  pegs: Peg[];
  spinners: Spinner[];
  gates: Gate[];
  portals: Portal[];
  zones: Zone[];
  cannons: IceCannon[];
  labels: SectionLabel[];
}

export const TRACK_SIZE: Record<MapSize, { width: number; corridors: number; clearance: number; hole: number }> = {
  S: { width: 1400, corridors: 6, clearance: 210, hole: 120 },
  M: { width: 1800, corridors: 7, clearance: 240, hole: 150 },
  L: { width: 2200, corridors: 7, clearance: 270, hole: 180 },
};

const SLOPE = 0.13;
const TOP = 320;
const TAU = Math.PI * 2;

// ───────────────────────── 좌표 도우미 ─────────────────────────

export function floorY(t: Track, k: number, x: number): number {
  const c = t.corridors[k];
  return c.base + t.slope * (c.dir > 0 ? x : t.width - x);
}

export function ceilY(t: Track, k: number, x: number): number {
  return k === 0 ? floorY(t, 0, x) - 340 : floorY(t, k - 1, x);
}

/** 원의 위치 → 몇 번째 통로인지 (결승 구역이면 corridors.length) */
export function corridorAt(t: Track, x: number, y: number): number {
  for (let k = 0; k < t.corridors.length; k++) if (y < floorY(t, k, x) + 4) return k;
  return t.corridors.length;
}

/** 코스를 따라 얼마나 왔는지 (통로 번호 × 폭 + 통로 진행 방향 거리) */
export function progressAt(t: Track, x: number, y: number): number {
  const k = corridorAt(t, x, y);
  if (k >= t.corridors.length) return totalProgress(t);
  const u = t.corridors[k].dir > 0 ? x : t.width - x;
  return k * t.width + Math.max(0, Math.min(t.width, u));
}

export function totalProgress(t: Track): number {
  return t.corridors.length * t.width;
}

/** 진행도 → 그 지점 바닥 바로 위 좌표 */
function pointAt(t: Track, progress: number): { x: number; y: number } {
  const k = Math.max(0, Math.min(t.corridors.length - 1, Math.floor(progress / t.width)));
  const u = progress - k * t.width;
  const x = t.corridors[k].dir > 0 ? u : t.width - u;
  return { x, y: floorY(t, k, x) - 40 };
}

export function gateOpen(g: Gate, t: number): boolean {
  return (t + g.phase) % g.period < g.openFor;
}

// ───────────────────────── 장애물 모듈 ─────────────────────────

interface ModCtx {
  t: Track; k: number; rng: Rng;
  /** 통로 진행 방향 거리 u → x */
  X: (u: number) => number;
  u0: number; len: number;
  pendingPortals: { p: Portal; delta: number }[];
}
interface Module { name: string; len: number; build: (c: ModCtx) => void; /** 바닥을 바꾸는 모듈 (컨베이어·점프대) */ floor?: 'conveyor' | 'ramp' }

const mid = (c: ModCtx, x: number) => (floorY(c.t, c.k, x) + ceilY(c.t, c.k, x)) / 2;
const height = (c: ModCtx, x: number) => floorY(c.t, c.k, x) - ceilY(c.t, c.k, x);

const pegForest: Module = {
  name: '📍 핀 숲', len: 300,
  build: (c) => {
    for (let u = c.u0 + 20; u < c.u0 + c.len; u += 70) {
      const x = c.X(u);
      const f = floorY(c.t, c.k, x);
      const h = height(c, x);
      for (let row = 1; row <= 2; row++) {
        if (c.rng() < 0.2) continue;
        const yy = f - (h * row) / 3 + ((Math.round(u / 55) % 2) * h) / 6;
        c.t.pegs.push({ x, y: yy, r: 8, bounce: 0.5 });
      }
    }
  },
};

const spinners: Module = {
  name: '🌀 회전 막대', len: 280,
  build: (c) => {
    for (let i = 0; i < 2; i++) {
      const x = c.X(c.u0 + 70 + i * 140);
      c.t.spinners.push({
        x, y: mid(c, x), half: Math.min(60, height(c, x) * 0.36),
        omega: (c.rng() < 0.5 ? -1 : 1) * (1.8 + c.rng() * 1.4), phase: c.rng() * TAU, arms: 1,
      });
    }
  },
};

const windmill: Module = {
  name: '🌬️ 풍차', len: 260,
  build: (c) => {
    const x = c.X(c.u0 + c.len / 2);
    c.t.spinners.push({
      x, y: mid(c, x), half: Math.min(110, height(c, x) * 0.42),
      omega: (c.rng() < 0.5 ? -1 : 1) * (0.9 + c.rng() * 0.7), phase: c.rng() * TAU, arms: 2,
    });
  },
};

const bumpers: Module = {
  name: '🎯 범퍼', len: 280,
  build: (c) => {
    for (let i = 0; i < 3; i++) {
      const x = c.X(c.u0 + 40 + i * 100 + c.rng() * 30);
      const f = floorY(c.t, c.k, x);
      const r = 16 + c.rng() * 8;
      // 바닥과의 틈이 원 지름보다 넉넉하게 (끼임 방지)
      c.t.pegs.push({ x, y: f - r - 60 - c.rng() * Math.max(0, height(c, x) - 2 * r - 120) * 0.6, r, bounce: 0.95 });
    }
  },
};

const zoneModule = (name: string, kind: Zone['kind'], len: number): Module => ({
  name, len,
  build: (c) => {
    const xa = c.X(c.u0);
    const xb = c.X(c.u0 + c.len);
    const x = Math.min(xa, xb);
    const top = Math.min(ceilY(c.t, c.k, xa), ceilY(c.t, c.k, xb)) + 10;
    const bottom = Math.max(floorY(c.t, c.k, xa), floorY(c.t, c.k, xb));
    // 진흙·부스터는 바닥 근처만, 역풍은 통로 전체 높이
    const y = kind === 'wind' ? top : bottom - 70;
    c.t.zones.push({ x, y, w: Math.abs(xb - xa), h: bottom - y, kind, dir: c.t.corridors[c.k].dir });
  },
});

const mud = zoneModule('🟫 진흙탕', 'mud', 260);
const booster = zoneModule('⚡ 부스터', 'boost', 220);
const headwind = zoneModule('💨 역풍', 'wind', 300);

const conveyor: Module = { name: '⬅️ 역주행 컨베이어', len: 200, floor: 'conveyor', build: () => {} };
const jumpRamp: Module = { name: '🛹 점프대', len: 160, floor: 'ramp', build: () => {} };

const portals: Module = {
  name: '❓ 미스터리 포털', len: 220,
  build: (c) => {
    const forward = c.rng() < 0.5;
    const x1 = c.X(c.u0 + 60);
    const x2 = c.X(c.u0 + 160);
    // 두 개 중 하나는 앞으로, 하나는 뒤로 (겉보기로는 구분 불가)
    const p1: Portal = { x: x1, y: floorY(c.t, c.k, x1) - 30, r: 22, tx: 0, ty: 0, forward };
    const p2: Portal = { x: x2, y: floorY(c.t, c.k, x2) - 30, r: 22, tx: 0, ty: 0, forward: !forward };
    for (const p of [p1, p2]) {
      c.t.portals.push(p);
      c.pendingPortals.push({ p, delta: p.forward ? c.t.width * 0.8 : -c.t.width * 0.7 });
    }
  },
};

const barrier: Module = {
  name: '🚧 차단문', len: 120,
  build: (c) => {
    const x = c.X(c.u0 + 60);
    c.t.gates.push({
      x1: x, y1: floorY(c.t, c.k, x) + 2, x2: x, y2: ceilY(c.t, c.k, x),
      kind: 'barrier', period: 2.4 + c.rng() * 0.8, openFor: 1 + c.rng() * 0.4, phase: c.rng() * 3,
    });
  },
};

const MODULES: Module[] = [pegForest, spinners, windmill, bumpers, mud, booster, headwind, conveyor, jumpRamp, portals, barrier];

// ───────────────────────── 조립 ─────────────────────────

const shuffle = <T>(arr: T[], rng: Rng): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/** 통로 입구에서 이만큼은 비워 둠 (떨어진 원이 착지할 자리) */
const ENTRY = 170;
const SHORTCUT_CHANCE = 0.65;
const CANNON_CHANCE = 0.4;

export function buildTrack(rng: Rng, size: MapSize): Track {
  const cfg = TRACK_SIZE[size];
  const W = cfg.width;
  const t: Track = {
    width: W, slope: SLOPE, hole: cfg.hole, corridors: [], finishY: 0,
    segments: [], pegs: [], spinners: [], gates: [], portals: [], zones: [], cannons: [], labels: [],
  };
  for (let k = 0; k < cfg.corridors; k++) {
    const base = k === 0 ? TOP : t.corridors[k - 1].base + SLOPE * W + cfg.clearance;
    t.corridors.push({ base, dir: k % 2 === 0 ? 1 : -1 });
  }
  const last = t.corridors.length - 1;
  t.finishY = floorY(t, last, t.corridors[last].dir > 0 ? W : 0) + 90;

  const pendingPortals: ModCtx['pendingPortals'] = [];
  let pool = shuffle([...MODULES], rng);

  for (let k = 0; k <= last; k++) {
    const d = t.corridors[k].dir;
    const X = (u: number) => (d > 0 ? u : W - u);
    const usableEnd = W - cfg.hole - 90;

    // 지름길 문 (마지막 통로 제외: 아래가 결승이라)
    let shortcut: [number, number] | null = null;
    if (k < last && rng() < SHORTCUT_CHANCE) {
      const gw = cfg.hole * 0.85;
      const us = W * (0.35 + rng() * 0.25);
      shortcut = [us, us + gw];
    }

    // 모듈 2~3개를 통로를 따라 배치 (지름길 문 위는 피해서)
    const count = 2 + (rng() < 0.5 ? 1 : 0);
    const mods: { m: Module; u0: number }[] = [];
    let u = ENTRY;
    for (let i = 0; i < count; i++) {
      if (pool.length === 0) pool = shuffle([...MODULES], rng);
      const m = pool.pop()!;
      const room = (usableEnd - u) / (count - i);
      let u0 = u + Math.max(0, room - m.len) * rng();
      if (shortcut && u0 < shortcut[1] + 30 && u0 + m.len > shortcut[0] - 30) u0 = shortcut[1] + 30;
      if (u0 + m.len > usableEnd) break;
      mods.push({ m, u0 });
      u = u0 + m.len + 40;
    }

    // 바닥: 컨베이어·점프대·지름길 자리를 잘라가며 이어 붙임
    const cuts: { a: number; b: number; kind: 'gap' | 'conveyor' | 'ramp' }[] = [];
    if (shortcut) cuts.push({ a: shortcut[0], b: shortcut[1], kind: 'gap' });
    for (const { m, u0 } of mods) if (m.floor) cuts.push({ a: u0 + 20, b: u0 + m.len - 20, kind: m.floor });
    cuts.sort((p, q) => p.a - q.a);
    const floorEnd = W - cfg.hole;
    let from = 0;
    const seg = (ua: number, ub: number) => {
      const xa = X(ua);
      const xb = X(ub);
      t.segments.push({ x1: xa, y1: floorY(t, k, xa), x2: xb, y2: floorY(t, k, xb), kind: 'floor' });
    };
    for (const c of cuts) {
      if (c.a > from) seg(from, c.a);
      if (c.kind === 'conveyor') {
        // 뒤로 실어 나르는 바닥 (빠르게 굴러오면 넘어감)
        const xa = X(c.a);
        const xb = X(c.b);
        t.segments.push({ x1: xb, y1: floorY(t, k, xb), x2: xa, y2: floorY(t, k, xa), conveyor: 60 + rng() * 30, kind: 'floor' });
      } else if (c.kind === 'ramp') {
        seg(c.a, c.b);
        // 바닥 위에 비스듬히 솟은 발판: 올라탄 원이 위로 튀어 오름
        const xa = X(c.a + 20);
        const xb = X(c.a + 90);
        const top = floorY(t, k, xb) - 34;
        t.segments.push({ x1: xa, y1: floorY(t, k, xa), x2: xb, y2: top, kind: 'ramp' });
        t.segments.push({ x1: xb, y1: top, x2: xb, y2: floorY(t, k, xb), kind: 'ramp' });
      } else {
        const xa = X(c.a);
        const xb = X(c.b);
        t.gates.push({
          x1: xa, y1: floorY(t, k, xa), x2: xb, y2: floorY(t, k, xb),
          kind: 'floor', period: 2.6 + rng() * 1.2, openFor: 0.9 + rng() * 0.4, phase: rng() * 4,
        });
        t.labels.push({ x: (xa + xb) / 2, y: floorY(t, k, (xa + xb) / 2) - 70, text: '🎰 지름길' });
      }
      from = c.b;
    }
    if (from < floorEnd) seg(from, floorEnd);

    for (const { m, u0 } of mods) {
      m.build({ t, k, rng, X, u0, len: m.len, pendingPortals });
      const x = X(u0 + m.len / 2);
      t.labels.push({ x, y: ceilY(t, k, x) + 18, text: m.name });
    }

    // 출구 벽의 얼음 대포
    if (rng() < CANNON_CHANCE) {
      const x = X(W - cfg.hole - 14);
      const vx = -d * 330;
      t.cannons.push({ x, y: floorY(t, k, x) - 16, vx, vy: d * SLOPE * vx, period: 1.8 + rng() * 0.8, phase: rng() * 2 });
    }
  }

  // 포털 도착 지점: 진행도 기준으로 앞/뒤, 장애물과 겹치지 않는 곳
  const total = totalProgress(t);
  for (const { p, delta } of pendingPortals) {
    const here = progressAt(t, p.x, p.y);
    let target = Math.max(ENTRY / 2, Math.min(total - W * 0.4, here + delta));
    for (let attempt = 0; attempt < 30; attempt++) {
      const pt = pointAt(t, target);
      if (isClear(t, pt.x, pt.y, 26)) break;
      target += 37;
    }
    const pt = pointAt(t, target);
    p.tx = pt.x;
    p.ty = pt.y;
  }
  return t;
}

function isClear(t: Track, x: number, y: number, r: number): boolean {
  for (const p of t.pegs) if (Math.hypot(p.x - x, p.y - y) < p.r + r) return false;
  for (const s of t.segments) if (distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) < r + 4) return false;
  for (const s of t.spinners) if (Math.hypot(s.x - x, s.y - y) < s.half + r) return false;
  for (const g of t.gates) if (distToSegment(x, y, g.x1, g.y1, g.x2, g.y2) < r + 6) return false;
  for (const p of t.portals) if (Math.hypot(p.x - x, p.y - y) < p.r + r + 10) return false;
  return true;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
