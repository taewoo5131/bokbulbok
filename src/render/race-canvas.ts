import type { Effect } from '../game/types';
import { FREEZE_TIME, type Race, type RaceBall } from '../race/race';
import { ceilY, floorY, gateOpen } from '../race/track';

const TAU = Math.PI * 2;
/** 한 화면에 보이는 코스 폭 (월드 단위) */
const VIEW_W = 720;
/** 이름을 다 그리기엔 많을 때, 주목할 원 몇 개만 이름 표시 */
const NAMED_WHEN_CROWDED = 6;

/** 레이스 그리기: 지그재그 코스를 카메라가 가로·세로로 따라가며 보여주고, 구석에 전체 지도 */
export class RaceRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private camX = 0;
  private camY = 0;
  private lastSeed = -1;
  private scale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D를 지원하지 않는 브라우저입니다.');
    this.ctx = ctx;
  }

  private fit(): void {
    const w = Math.floor(this.canvas.clientWidth);
    const h = Math.floor(this.canvas.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
  }

  /** 화면에서 size px로 보이도록 하는 월드 단위 크기 */
  private px(size: number): number {
    return (size * this.dpr) / this.scale;
  }

  draw(race: Race): void {
    this.fit();
    const { ctx } = this;
    const { track } = race;
    const W = track.width;
    const viewW = Math.min(W + 40, VIEW_W);
    const scale = (this.w * this.dpr) / viewW;
    this.scale = scale;
    const viewH = (this.h * this.dpr) / scale;

    // 카메라: 1등 뽑기는 선두, 꼴등 뽑기는 꼴찌를 따라감
    const racing = race.balls.filter((b) => !b.place);
    const pool = racing.length ? racing : race.balls;
    const focus = pool.reduce((best, b) =>
      race.mode === 'winner' ? (b.progress > best.progress ? b : best) : b.progress < best.progress ? b : best,
    );
    const targetX = Math.max(-20, Math.min(W + 20 - viewW, focus.x - viewW / 2));
    const targetY = Math.max(-40, Math.min(track.finishY + 160 - viewH, focus.y - viewH * 0.55));
    if (race.seed !== this.lastSeed || race.time < 0.05) {
      this.camX = targetX;
      this.camY = targetY;
      this.lastSeed = race.seed;
    }
    this.camX += (targetX - this.camX) * 0.07;
    this.camY += (targetY - this.camY) * 0.07;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1222';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -this.camX * scale, -this.camY * scale);

    const view = { x0: this.camX - 60, x1: this.camX + viewW + 60, y0: this.camY - 80, y1: this.camY + viewH + 80 };
    this.drawTrack(race, view);

    // 이름: 많으면 주목할 원 몇 개만
    const crowded = race.balls.length > 16;
    const named = new Set<number>();
    if (crowded) {
      const order = race.standings().filter((b) => !b.place || race.mode === 'winner');
      const pick = race.mode === 'winner' ? order.slice(0, NAMED_WHEN_CROWDED) : order.slice(-NAMED_WHEN_CROWDED);
      for (const b of pick) named.add(b.id);
    }
    for (const b of race.balls) {
      if (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
      this.drawBall(b, !crowded || named.has(b.id));
    }
    for (const e of race.effects) if (e.kind !== 'banner') this.drawEffect(e);

    // 화면 고정 요소
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.drawMinimap(race, viewW, viewH);
    for (const e of race.effects) if (e.kind === 'banner') this.drawBanner(e.text, e.color, e.t / e.life, viewW, viewH);
  }

  private drawTrack(race: Race, v: { x0: number; x1: number; y0: number; y1: number }): void {
    const { ctx } = this;
    const { track } = race;
    const W = track.width;
    const t = race.time;
    const inView = (x: number, y: number, m = 0) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;

    // 통로 바닥색 (통로마다 살짝 다르게) + 진행 방향 화살표
    track.corridors.forEach((c, k) => {
      const top = Math.min(ceilY(track, k, 0), ceilY(track, k, W));
      const bottom = Math.max(floorY(track, k, 0), floorY(track, k, W));
      if (bottom < v.y0 || top > v.y1) return;
      ctx.beginPath();
      ctx.moveTo(0, ceilY(track, k, 0));
      ctx.lineTo(W, ceilY(track, k, W));
      ctx.lineTo(W, floorY(track, k, W));
      ctx.lineTo(0, floorY(track, k, 0));
      ctx.closePath();
      ctx.fillStyle = k % 2 ? '#1b2438' : '#1e293b';
      ctx.fill();
      ctx.fillStyle = 'rgba(148,163,184,0.07)';
      ctx.font = `900 ${this.px(46)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let x = 200; x < W; x += 420) {
        const yMid = (ceilY(track, k, x) + floorY(track, k, x)) / 2;
        ctx.fillText(c.dir > 0 ? '▶' : '◀', x, yMid);
      }
    });

    // 결승 구역
    const fy = track.finishY;
    const lastDir = track.corridors[track.corridors.length - 1].dir;
    const fx0 = lastDir > 0 ? W - track.hole - 20 : 0;
    const fx1 = lastDir > 0 ? W : track.hole + 20;
    if (inView((fx0 + fx1) / 2, fy, 200)) {
      const sq = 15;
      for (let x = fx0, i = 0; x < fx1; x += sq, i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#f8fafc' : '#0f172a';
          ctx.fillRect(x, fy - sq + j * sq, sq, sq);
        }
      }
      this.label('🏁 FINISH', (fx0 + fx1) / 2, fy - 30, '#f8fafc', 'center', 14);
    }

    // 구역
    for (const z of track.zones) {
      if (!inView(z.x + z.w / 2, z.y + z.h / 2, z.w)) continue;
      if (z.kind === 'boost') {
        ctx.fillStyle = 'rgba(34,197,94,0.18)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        this.chevronsH(z.x, z.y + z.h / 2, z.w, (t * 140) % 40, z.dir, 'rgba(74,222,128,0.7)');
      } else if (z.kind === 'mud') {
        ctx.fillStyle = 'rgba(120,72,32,0.5)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.fillStyle = 'rgba(80,48,20,0.85)';
        for (let i = 0; i < 16; i++) {
          ctx.beginPath();
          ctx.arc(z.x + ((i * 53) % z.w), z.y + ((i * 37) % z.h), 4 + (i % 3), 0, TAU);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(56,189,248,0.1)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        this.chevronsH(z.x, z.y + z.h / 2, z.w, (t * 100) % 40, z.dir > 0 ? -1 : 1, 'rgba(125,211,252,0.5)');
      }
    }

    // 바닥·점프대·컨베이어
    ctx.lineCap = 'round';
    for (const s of track.segments) {
      if (!inView((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2 + 40)) continue;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = s.conveyor ? '#0e7490' : s.kind === 'ramp' ? '#fb923c' : '#94a3b8';
      ctx.lineWidth = s.conveyor ? 9 : 7;
      ctx.stroke();
      if (s.conveyor) {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        const ux = (s.x2 - s.x1) / len;
        const uy = (s.y2 - s.y1) / len;
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 2;
        for (let d = (t * s.conveyor * 0.5) % 30; d < len - 6; d += 30) {
          const x = s.x1 + ux * d;
          const y = s.y1 + uy * d;
          ctx.beginPath();
          ctx.moveTo(x - ux * 5 - uy * 3, y - uy * 5 + ux * 3);
          ctx.lineTo(x, y);
          ctx.lineTo(x - ux * 5 + uy * 3, y - uy * 5 - ux * 3);
          ctx.stroke();
        }
      }
    }

    // 핀/범퍼
    for (const p of track.pegs) {
      if (!inView(p.x, p.y, 40)) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      if (p.r > 12) {
        ctx.fillStyle = '#be185d';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#f9a8d4';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#64748b';
        ctx.fill();
      }
    }

    // 회전 막대 / 풍차
    for (const sp of track.spinners) {
      if (!inView(sp.x, sp.y, sp.half + 20)) continue;
      const a0 = sp.phase + sp.omega * t;
      ctx.strokeStyle = sp.arms === 2 ? '#38bdf8' : '#f59e0b';
      ctx.lineWidth = 8;
      for (let arm = 0; arm < sp.arms; arm++) {
        const a = a0 + (arm * Math.PI) / 2;
        const dx = Math.cos(a) * sp.half;
        const dy = Math.sin(a) * sp.half;
        ctx.beginPath();
        ctx.moveTo(sp.x - dx, sp.y - dy);
        ctx.lineTo(sp.x + dx, sp.y + dy);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 6, 0, TAU);
      ctx.fillStyle = '#fde68a';
      ctx.fill();
    }

    // 문: 바닥 지름길 문 / 세로 차단문
    for (const g of track.gates) {
      if (!inView((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2, 200)) continue;
      const open = gateOpen(g, t);
      const cycle = (t + g.phase) % g.period;
      if (g.kind === 'floor') {
        if (open) {
          ctx.fillStyle = 'rgba(250,204,21,0.25)';
          ctx.fillRect(Math.min(g.x1, g.x2), Math.min(g.y1, g.y2) - 2, Math.abs(g.x2 - g.x1), 40);
          this.label('열림!', (g.x1 + g.x2) / 2, Math.max(g.y1, g.y2) + 18, '#fde047', 'center', 12);
        } else {
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 7;
          ctx.setLineDash([12, 6]);
          ctx.beginPath();
          ctx.moveTo(g.x1, g.y1);
          ctx.lineTo(g.x2, g.y2);
          ctx.stroke();
          ctx.setLineDash([]);
          // 열리기까지 남은 시간
          const k = (cycle - g.openFor) / (g.period - g.openFor);
          ctx.fillStyle = 'rgba(250,204,21,0.5)';
          ctx.fillRect(Math.min(g.x1, g.x2), Math.max(g.y1, g.y2) + 8, Math.abs(g.x2 - g.x1) * Math.max(0, Math.min(1, k)), 4);
        }
      } else {
        // 차단문: 열리면 위로 올라감
        const lift = open ? (g.y1 - g.y2) * 0.85 : 0;
        ctx.strokeStyle = open ? 'rgba(248,113,113,0.35)' : '#ef4444';
        ctx.lineWidth = open ? 4 : 9;
        ctx.beginPath();
        ctx.moveTo(g.x1, g.y1 - lift);
        ctx.lineTo(g.x2, g.y2);
        ctx.stroke();
      }
    }

    // 미스터리 포털
    for (const p of track.portals) {
      if (!inView(p.x, p.y, 40)) continue;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r - i * 6, t * (2 + i) + i, t * (2 + i) + i + Math.PI * 1.4);
        ctx.strokeStyle = ['#c084fc', '#818cf8', '#e879f9'][i];
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      this.label('❓', p.x, p.y + 1, '#f5f3ff', 'center', 15);
    }

    // 얼음 대포 (출구 벽): 발사 직전에 포구가 밝아짐
    for (const c of track.cannons) {
      if (!inView(c.x, c.y, 60)) continue;
      const charge = ((t + c.phase) % c.period) / c.period;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.atan2(c.vy, c.vx));
      ctx.fillStyle = '#1e3a5f';
      ctx.beginPath();
      ctx.roundRect(-16, -12, 20, 24, 5);
      ctx.fill();
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(0, -6, 14, 12);
      ctx.beginPath();
      ctx.arc(14, 0, 4 + charge * 4, 0, TAU);
      ctx.fillStyle = `rgba(186,230,253,${0.2 + charge * 0.8})`;
      ctx.fill();
      ctx.restore();
    }
    for (const s of race.iceShots) {
      if (!inView(s.x, s.y, 30)) continue;
      const len = Math.hypot(s.vx, s.vy);
      const ux = s.vx / len;
      const uy = s.vy / len;
      ctx.beginPath();
      ctx.moveTo(s.x - ux * 28, s.y - uy * 28);
      ctx.lineTo(s.x, s.y);
      ctx.strokeStyle = 'rgba(125,211,252,0.45)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, TAU);
      ctx.fillStyle = '#e0f2fe';
      ctx.fill();
    }

    // 구간 이름
    for (const l of track.labels) {
      if (!inView(l.x, l.y, 100)) continue;
      this.label(l.text, l.x, l.y, l.text.includes('지름길') ? '#fde047' : 'rgba(203,213,225,0.8)', 'center', 12);
    }

    // 바깥 벽
    ctx.fillStyle = '#475569';
    ctx.fillRect(-8, v.y0, 8, v.y1 - v.y0);
    ctx.fillRect(W, v.y0, 8, v.y1 - v.y0);
  }

  /** 가로 방향 화살표 줄 */
  private chevronsH(x: number, cy: number, w: number, offset: number, dir: 1 | -1, color: string): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    for (let xx = x + offset; xx < x + w - 10; xx += 40) {
      ctx.beginPath();
      ctx.moveTo(xx, cy - 12);
      ctx.lineTo(xx + 10 * dir, cy);
      ctx.lineTo(xx, cy + 12);
      ctx.stroke();
    }
  }

  private drawBall(b: RaceBall, showName: boolean): void {
    const { ctx } = this;
    ctx.save();
    if (b.place) ctx.globalAlpha = 0.7;
    // 🔥 추격 부스트 불꽃 꼬리
    if (b.chase > 0.15 && !b.frozen && !b.place) {
      const s = Math.hypot(b.vx, b.vy) || 1;
      const tx = b.x - (b.vx / s) * b.r * 1.6;
      const ty = b.y - (b.vy / s) * b.r * 1.6;
      const rr = b.r * (1.2 + b.chase);
      const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, rr);
      g.addColorStop(0, `rgba(251,146,60,${0.5 + 0.4 * b.chase})`);
      g.addColorStop(1, 'rgba(239,68,68,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tx, ty, rr, 0, TAU);
      ctx.fill();
    }
    if (b.boosted) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.5, 0, TAU);
      ctx.fillStyle = 'rgba(74,222,128,0.3)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = showName ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.35)';
    ctx.stroke();

    if (showName) {
      ctx.font = `700 ${this.px(12)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = this.px(3);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(b.name, b.x, b.y - b.r - 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(b.name, b.x, b.y - b.r - 2);
    }

    // 얼어붙은 원: 얼음 덩어리 + 남은 시간
    if (b.frozen > 0) {
      const s = b.r * 1.45;
      ctx.fillStyle = 'rgba(186,230,253,0.55)';
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(b.x - s, b.y - s, s * 2, s * 2, 4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, s + 3, -Math.PI / 2, -Math.PI / 2 + TAU * (b.frozen / FREEZE_TIME));
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (b.place && b.r * this.scale >= 8 * this.dpr) {
      ctx.font = `800 ${Math.min(b.r * 1.1, this.px(12))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(String(b.place), b.x, b.y + 1);
    }
    ctx.restore();
  }

  /** 오른쪽 위 작은 전체 지도: 통로 바닥선, 지름길, 원 위치, 지금 보는 영역 */
  private drawMinimap(race: Race, viewW: number, viewH: number): void {
    const { ctx } = this;
    const { track } = race;
    const W = track.width;
    const H = track.finishY + 60;
    // 화면 폭의 15%, 높이의 40%를 넘지 않게
    const k = Math.min((viewW * 0.15) / W, (viewH * 0.4) / H);
    const mw = W * k;
    const mh = H * k;
    const x0 = viewW - mw - 10;
    const y0 = 10;
    ctx.save();
    ctx.fillStyle = 'rgba(2,6,23,0.75)';
    ctx.beginPath();
    ctx.roundRect(x0 - 6, y0 - 6, mw + 12, mh + 12, 6);
    ctx.fill();
    ctx.translate(x0, y0);
    ctx.scale(k, k);
    ctx.lineWidth = 2 / k;
    ctx.strokeStyle = 'rgba(148,163,184,0.7)';
    for (const s of track.segments) {
      if (s.kind !== 'floor') continue;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(250,204,21,0.9)';
    for (const g of track.gates) {
      if (g.kind !== 'floor') continue;
      ctx.beginPath();
      ctx.moveTo(g.x1, g.y1);
      ctx.lineTo(g.x2, g.y2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(248,250,252,0.6)';
    ctx.lineWidth = 1.5 / k;
    ctx.strokeRect(this.camX, this.camY, viewW, viewH);
    const dot = (race.balls.length > 30 ? 2 : 3) / k;
    for (const b of race.balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, dot, 0, TAU);
      ctx.fillStyle = b.color;
      ctx.fill();
    }
    ctx.restore();
  }

  private drawEffect(e: Effect): void {
    const { ctx } = this;
    const k = e.t / e.life;
    ctx.globalAlpha = 1 - k;
    if (e.kind === 'text') {
      ctx.font = `800 ${this.px(14)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = this.px(3);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(e.text, e.x, e.y - k * 30);
      ctx.fillStyle = e.color;
      ctx.fillText(e.text, e.x, e.y - k * 30);
    } else if (e.kind === 'ring') {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * (0.3 + 0.7 * k), 0, TAU);
      ctx.lineWidth = 3;
      ctx.strokeStyle = e.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawBanner(text: string, color: string, k: number, viewW: number, viewH: number): void {
    const { ctx } = this;
    const appear = Math.min(1, k * 8);
    const fit = viewW / 600;
    ctx.save();
    ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    ctx.translate(viewW / 2, viewH * 0.2);
    ctx.scale((0.6 + 0.4 * appear) * fit, (0.6 + 0.4 * appear) * fit);
    ctx.font = '900 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
    ctx.beginPath();
    ctx.roundRect(-w / 2 - 18, -26, w + 36, 52, 14);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 2);
    ctx.restore();
  }

  private label(text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'center', size = 13): void {
    const { ctx } = this;
    ctx.font = `700 ${this.px(size)}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}
