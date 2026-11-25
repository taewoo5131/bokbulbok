/**
 * 레이스 트랙: 장애물 정의 + 무작위 구간 조립.
 * 모든 랜덤은 전달받은 시드 RNG만 사용 → 같은 시드면 같은 트랙.
 */
import type { Rng } from '../game/rng';
import type { MapSize } from '../game/size';

export interface Segment { x1: number; y1: number; x2: number; y2: number; /** 컨베이어: 선분 방향으로 표면이 움직이는 속도 */ conveyor?: number }
export interface Peg { x: number; y: number; r: number; bounce: number }
/** 회전 막대. arms=2면 십자 풍차 */
export interface Spinner { x: number; y: number; half: number; omega: number; phase: number; arms: 1 | 2 }
/** 좌우로 왕복하는 가로 막대 */
export interface Slider { y: number; mid: number; amp: number; half: number; omega: number; phase: number }
/** 주기적으로 열리는 바닥 문. 닫혀 있을 때만 바닥 역할 */
export interface Gate { y: number; x1: number; x2: number; period: number; openFor: number; phase: number }
/** 들어가면 다른 위치로 순간이동. 앞으로 갈지 뒤로 갈지는 겉보기로 알 수 없음 */
export interface Portal { x: number; y: number; r: number; tx: number; ty: number; forward: boolean }
export interface Zone { x: number; y: number; w: number; h: number; kind: 'boost' | 'mud' | 'wind' }
/** 벽에 붙은 얼음 대포. period초마다 가로로 얼음을 쏘고, 맞은 원은 그 자리에서 잠시 얼어붙음 */
export interface IceCannon { y: number; /** 1이면 왼쪽 벽에서 오른쪽으로, -1이면 반대 */ dir: 1 | -1; period: number; phase: number }
export interface SectionLabel { y: number; text: string }

export interface Track {
  width: number;
  /** 출발 줄 아래 첫 장애물 시작 위치 */
  startY: number;
  finishY: number;
  segments: Segment[];
  pegs: Peg[];
  spinners: Spinner[];
  sliders: Slider[];
  gates: Gate[];
  portals: Portal[];
  zones: Zone[];
  labels: SectionLabel[];
  cannons: IceCannon[];
}

export const TRACK_SIZE: Record<MapSize, { width: number; sections: number; funnelScale: number }> = {
  S: { width: 600, sections: 11, funnelScale: 1 },
  M: { width: 900, sections: 13, funnelScale: 1.5 },
  L: { width: 1200, sections: 15, funnelScale: 2 },
};

const TAU = Math.PI * 2;

/** 움직이는 막대의 지붕 높이 (가운데가 이만큼 높음) */
export const SLIDER_ROOF = 26;

export function sliderX(s: Slider, t: number): number {
  return s.mid + s.amp * Math.sin(s.omega * t + s.phase);
}

export function gateOpen(g: Gate, t: number): boolean {
  return (t + g.phase) % g.period < g.openFor;
}

// ───────────────────────── 구간 ─────────────────────────

interface Ctx { t: Track; y: number; rng: Rng; W: number; funnelScale: number; pendingPortals: { p: Portal; dy: number }[] }
type Builder = { name: string; build: (c: Ctx) => number };

const shuffle = <T>(arr: T[], rng: Rng): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const pegField: Builder = {
  name: '📍 핀 밭',
  build: ({ t, y, rng, W }) => {
    const rows = 7;
    const gapX = 70 + rng() * 15;
    const offset = rng() * gapX;
    for (let row = 0; row < rows; row++) {
      const shift = (row % 2) * (gapX / 2) + offset;
      for (let x = 30 + (shift % gapX); x < W - 20; x += gapX) {
        if (rng() < 0.12) continue;
        t.pegs.push({ x, y: y + 40 + row * 60, r: 8, bounce: 0.5 });
      }
    }
    return 40 + rows * 60 + 40;
  },
};

const zigzag: Builder = {
  name: '↘️ 지그재그',
  build: ({ t, y, rng, W }) => {
    const count = 4;
    const gap = 110 + rng() * 40;
    let fromLeft = rng() < 0.5;
    let cy = y + 30;
    for (let i = 0; i < count; i++) {
      const drop = 60 + rng() * 40 + W * 0.04;
      if (fromLeft) t.segments.push({ x1: 0, y1: cy, x2: W - gap, y2: cy + drop });
      else t.segments.push({ x1: W, y1: cy, x2: gap, y2: cy + drop });
      fromLeft = !fromLeft;
      cy += drop + 70;
    }
    return cy - y + 20;
  },
};

const funnel: Builder = {
  name: '🔻 깔때기',
  build: ({ t, y, rng, W, funnelScale }) => {
    const gap = (90 + rng() * 30) * funnelScale;
    const cx = W / 2 + (rng() - 0.5) * W * 0.2;
    t.segments.push({ x1: 0, y1: y + 20, x2: cx - gap / 2, y2: y + 240 });
    t.segments.push({ x1: W, y1: y + 20, x2: cx + gap / 2, y2: y + 240 });
    t.pegs.push({ x: cx, y: y + 320, r: 22, bounce: 1.1 });
    return 380;
  },
};

const spinners: Builder = {
  name: '🌀 회전 막대',
  build: ({ t, y, rng, W }) => {
    const rows = 3;
    for (let row = 0; row < rows; row++) {
      const count = Math.max(2, Math.round(W / 220)) + (row % 2 ? -1 : 0);
      for (let i = 0; i < count; i++) {
        t.spinners.push({
          x: (W * (i + 0.5)) / count,
          y: y + 80 + row * 160,
          half: 50 + rng() * 16,
          omega: (rng() < 0.5 ? -1 : 1) * (1.8 + rng() * 1.6),
          phase: rng() * TAU,
          arms: 1,
        });
      }
    }
    return 80 + rows * 160;
  },
};

const lanes: Builder = {
  name: '🛤️ 갈림길',
  build: ({ t, y, rng, W }) => {
    const top = y + 70;
    const h = 280;
    const laneCount = W >= 900 ? 4 : 3;
    const all: (Zone['kind'] | null)[] = ['boost', 'mud', laneCount === 4 ? 'wind' : null, null];
    const kinds = shuffle(all.slice(0, laneCount), rng);
    const laneW = W / laneCount;
    for (let i = 1; i < laneCount; i++) {
      t.pegs.push({ x: laneW * i, y: y + 30, r: 10, bounce: 0.6 });
      t.segments.push({ x1: laneW * i, y1: top, x2: laneW * i, y2: top + h });
    }
    kinds.forEach((kind, i) => {
      if (kind) t.zones.push({ x: laneW * i + 6, y: top + 30, w: laneW - 12, h: h - 60, kind });
    });
    return 70 + h + 40;
  },
};

const bumpers: Builder = {
  name: '🎯 범퍼',
  build: ({ t, y, rng, W }) => {
    const count = Math.round(W / 110);
    for (let i = 0; i < count; i++) {
      t.pegs.push({ x: 60 + rng() * (W - 120), y: y + 50 + (i * 320) / count + rng() * 30, r: 18 + rng() * 10, bounce: 1.15 });
    }
    return 400;
  },
};

/** 좌우로 움직이는 막대 사이를 빠져나가기 */
const sliders: Builder = {
  name: '↔️ 움직이는 막대',
  build: ({ t, y, rng, W }) => {
    const rows = 4;
    for (let row = 0; row < rows; row++) {
      const half = W * (0.18 + rng() * 0.08);
      t.sliders.push({
        y: y + 60 + row * 95,
        mid: W / 2,
        amp: W / 2 - half - 10,
        half,
        omega: 0.9 + rng() * 1.1,
        phase: rng() * TAU,
      });
    }
    return 60 + rows * 95 + 30;
  },
};

/** 바닥 문: 닫혀 있는 동안 원들이 쌓였다가 열리면 한꺼번에 쏟아짐 */
const trapdoors: Builder = {
  name: '🚪 함정문',
  build: ({ t, y, rng, W }) => {
    const doors = W >= 900 ? 4 : 3;
    const dw = W / doors;
    const fy = y + 160;
    // 위에서 문 쪽으로 모이도록 가벼운 핀
    for (let i = 0; i < doors * 2; i++) t.pegs.push({ x: (W * (i + 0.5)) / (doors * 2), y: y + 60 + (i % 2) * 30, r: 8, bounce: 0.5 });
    for (let i = 0; i < doors; i++) {
      t.gates.push({ y: fy, x1: dw * i, x2: dw * (i + 1), period: 2.2 + rng() * 0.8, openFor: 0.8 + rng() * 0.3, phase: rng() * 3 });
    }
    return 240;
  },
};

/** 미스터리 포털: 들어가면 앞으로 워프하거나 뒤로 되돌아감 */
const portals: Builder = {
  name: '❓ 미스터리 포털',
  build: ({ t, y, rng, W, pendingPortals }) => {
    const count = W >= 900 ? 4 : 3;
    // 앞/뒤 포털 섞기 (최소 하나씩)
    const dirs = shuffle([true, false, ...Array.from({ length: count - 2 }, () => rng() < 0.5)], rng);
    for (let i = 0; i < count; i++) {
      const p: Portal = { x: (W * (i + 0.5)) / count + (rng() - 0.5) * 40, y: y + 110 + (i % 2) * 70, r: 22, tx: 0, ty: 0, forward: dirs[i] };
      t.pegs.push({ x: p.x - 45, y: p.y - 50, r: 8, bounce: 0.5 });
      t.pegs.push({ x: p.x + 45, y: p.y - 50, r: 8, bounce: 0.5 });
      pendingPortals.push({ p, dy: dirs[i] ? 700 : -600 });
      t.portals.push(p);
    }
    return 280;
  },
};

/** 컨베이어 선반: 한쪽으로 실어 나른 뒤 떨어뜨림 */
const conveyors: Builder = {
  name: '➡️ 컨베이어',
  build: ({ t, y, rng, W }) => {
    const rows = 4;
    let dir = rng() < 0.5 ? 1 : -1;
    for (let row = 0; row < rows; row++) {
      const len = W * (0.55 + rng() * 0.15);
      const cy = y + 50 + row * 90;
      // 벽에서 시작해 열린 끝 쪽으로 살짝 기울어진 선반. 표면이 열린 끝 방향으로 움직임
      const sx = dir > 0 ? 0 : W;
      const ex = dir > 0 ? len : W - len;
      t.segments.push({ x1: sx, y1: cy, x2: ex, y2: cy + 12, conveyor: 160 + rng() * 80 });
      dir = -dir;
    }
    return 50 + rows * 90 + 40;
  },
};

/** 큰 십자 풍차 */
const windmills: Builder = {
  name: '🌬️ 풍차',
  build: ({ t, y, rng, W }) => {
    const count = Math.max(1, Math.round(W / 300));
    for (let i = 0; i < count; i++) {
      t.spinners.push({
        x: (W * (i + 0.5)) / count,
        y: y + 150,
        half: Math.min(110, W / count / 2 - 25),
        omega: (rng() < 0.5 ? -1 : 1) * (1 + rng() * 0.8),
        phase: rng() * TAU,
        arms: 2,
      });
    }
    return 320;
  },
};

/** 역풍 구역: 위로 밀어 올려 속도를 늦춤. 군데군데 빈 틈으로 빠져나가야 빠름 */
const headwind: Builder = {
  name: '💨 역풍',
  build: ({ t, y, rng, W }) => {
    const cols = W >= 900 ? 5 : 3;
    const cw = W / cols;
    const calm = Math.floor(rng() * cols);
    for (let i = 0; i < cols; i++) {
      if (i === calm) continue;
      t.zones.push({ x: cw * i + 4, y: y + 40, w: cw - 8, h: 260, kind: 'wind' });
    }
    t.pegs.push({ x: W / 2, y: y + 20, r: 12, bounce: 0.8 });
    return 340;
  },
};

/** 계단 미로: 층마다 다른 위치의 구멍으로 빠져나감 */
const maze: Builder = {
  name: '🧩 계단 미로',
  build: ({ t, y, rng, W }) => {
    const rows = 5;
    const gap = 80 + rng() * 20;
    for (let row = 0; row < rows; row++) {
      const cy = y + 50 + row * 85;
      const gx = 40 + rng() * (W - 80 - gap);
      // 양쪽에서 구멍 쪽으로 기울어진 바닥
      t.segments.push({ x1: 0, y1: cy, x2: gx, y2: cy + 30 });
      t.segments.push({ x1: W, y1: cy, x2: gx + gap, y2: cy + 30 });
    }
    return 50 + rows * 85 + 30;
  },
};

/** 얼음 대포 구간: 양쪽 벽의 대포가 번갈아 쏘는 사이로 핀을 튕기며 내려감 */
const iceCannons: Builder = {
  name: '❄️ 얼음 대포',
  build: ({ t, y, rng, W }) => {
    const rows = 5;
    for (let row = 0; row < rows; row++) {
      const cy = y + 50 + row * 70;
      t.cannons.push({ y: cy, dir: row % 2 ? -1 : 1, period: 1.6 + rng() * 0.8, phase: rng() * 2 });
      // 대포 줄 사이에 듬성듬성 핀
      for (let x = 80 + rng() * 60; x < W - 60; x += 140 + rng() * 40) t.pegs.push({ x, y: cy + 35, r: 8, bounce: 0.5 });
    }
    return 50 + rows * 70 + 30;
  },
};

const BUILDERS: Builder[] = [pegField, zigzag, funnel, spinners, lanes, bumpers, sliders, trapdoors, portals, conveyors, windmills, headwind, maze, iceCannons];

/** 다른 구간에도 가끔 얼음 대포 하나를 덧붙임 (함정문·포털·얼음 대포 구간 제외) */
const EXTRA_CANNON_CHANCE = 0.3;

export function buildTrack(rng: Rng, size: MapSize, startRowsBottom: number): Track {
  const cfg = TRACK_SIZE[size];
  const W = cfg.width;
  const t: Track = {
    width: W, startY: startRowsBottom + 50, finishY: 0,
    segments: [], pegs: [], spinners: [], sliders: [], gates: [], portals: [], zones: [], labels: [], cannons: [],
  };
  const order = shuffle([...BUILDERS], rng);
  while (order.length < cfg.sections) {
    // 부족하면 포털/함정문 같은 큰 변수는 중복되지 않게 나머지에서 뽑기
    const pool = BUILDERS.filter((b) => b !== portals && b !== order[order.length - 1]);
    order.push(pool[Math.floor(rng() * pool.length)]);
  }
  // 첫 구간은 포털이 아니게 (뒤로 보낼 곳이 없음)
  if (order[0] === portals) [order[0], order[1]] = [order[1], order[0]];

  const pendingPortals: Ctx['pendingPortals'] = [];
  let y = t.startY;
  for (const b of order.slice(0, cfg.sections)) {
    t.labels.push({ y, text: b.name });
    const h = b.build({ t, y, rng, W, funnelScale: cfg.funnelScale, pendingPortals });
    if (b !== trapdoors && b !== portals && b !== iceCannons && rng() < EXTRA_CANNON_CHANCE) {
      t.cannons.push({ y: y + h * (0.3 + rng() * 0.4), dir: rng() < 0.5 ? 1 : -1, period: 2 + rng(), phase: rng() * 2 });
    }
    y += h;
  }
  t.finishY = y + 80;

  // 포털 도착 지점: 장애물과 겹치지 않는 곳으로
  for (const { p, dy } of pendingPortals) {
    const ty = Math.max(t.startY + 20, Math.min(t.finishY - 250, p.y + dy));
    let tx = W / 2;
    for (let attempt = 0; attempt < 30; attempt++) {
      const cx = 40 + rng() * (W - 80);
      const cy = ty + (rng() - 0.5) * 120;
      if (isClear(t, cx, cy, 30)) {
        tx = cx;
        p.ty = cy;
        break;
      }
      p.ty = cy;
    }
    p.tx = tx;
  }
  return t;
}

function isClear(t: Track, x: number, y: number, r: number): boolean {
  for (const p of t.pegs) if (Math.hypot(p.x - x, p.y - y) < p.r + r) return false;
  for (const s of t.segments) if (distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) < r + 4) return false;
  for (const s of t.spinners) if (Math.hypot(s.x - x, s.y - y) < s.half + r) return false;
  for (const s of t.sliders) if (Math.abs(s.y - y) < r + 6) return false;
  for (const g of t.gates) if (Math.abs(g.y - y) < r + 6) return false;
  for (const p of t.portals) if (Math.hypot(p.x - x, p.y - y) < p.r + r + 10) return false;
  return true;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
