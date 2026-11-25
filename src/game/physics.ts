import type { Ball } from './types';

/** 같은 질량의 원끼리 탄성 충돌 + 겹침 해소 */
export function collideBalls(a: Ball, b: Ball): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  const minDist = a.r + b.r;
  if (dist >= minDist) return;
  if (dist === 0) {
    dx = 1;
    dy = 0;
    dist = 1;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = (minDist - dist) / 2;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel < 0) {
    a.vx += rel * nx;
    a.vy += rel * ny;
    b.vx -= rel * nx;
    b.vy -= rel * ny;
  }
}

/** 원형 경기장 벽 반사. 벽에 닿았으면 true */
export function collideArena(b: Ball, arenaR: number): boolean {
  const d = Math.hypot(b.x, b.y);
  const limit = arenaR - b.r;
  if (d <= limit || d === 0) return false;
  const nx = b.x / d;
  const ny = b.y / d;
  b.x = nx * limit;
  b.y = ny * limit;
  const vn = b.vx * nx + b.vy * ny;
  if (vn > 0) {
    b.vx -= 2 * vn * nx;
    b.vy -= 2 * vn * ny;
  }
  return true;
}

/** 점 p에서 방향 d(단위벡터)로 나아갈 때 반지름 R 원의 경계까지 거리 */
export function rayToCircleEdge(px: number, py: number, dx: number, dy: number, R: number): number {
  const pd = px * dx + py * dy;
  const c = px * px + py * py - R * R;
  return -pd + Math.sqrt(Math.max(0, pd * pd - c));
}
