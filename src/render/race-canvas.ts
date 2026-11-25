import type { Effect } from '../game/types';
import { FREEZE_TIME, type Race, type RaceBall } from '../race/race';
import { SLIDER_ROOF, gateOpen, sliderX } from '../race/track';

const TAU = Math.PI * 2;
const MARGIN = 10;
const MINIMAP_W = 10;
/** 트랙이 이보다 넓으면 가로도 따라가며 확대해서 보여줌 */
const MAX_VIEW_W = 680;
/** 이름을 다 그리기엔 많을 때, 주목할 원 몇 개만 이름 표시 */
const NAMED_WHEN_CROWDED = 6;

/** 레이스 그리기: 긴 트랙을 카메라가 따라가며 보여주고, 오른쪽에 전체 진행 미니맵 */
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

  draw(race: Race): void {
    this.fit();
    const { ctx } = this;
    const W = race.track.width;
    const viewW = Math.min(W, MAX_VIEW_W);
    const scale = (this.w * this.dpr) / (viewW + MARGIN * 2 + MINIMAP_W + 6);
    this.scale = scale;
    const viewH = (this.h * this.dpr) / scale;

    // 카메라: 1등 뽑기는 선두, 꼴등 뽑기는 꼴찌를 따라감
    const racing = race.balls.filter((b) => !b.place);
    const pool = racing.length ? racing : race.balls;
    const focus = pool.reduce((best, b) => (race.mode === 'winner' ? (b.y > best.y ? b : best) : b.y < best.y ? b : best));
    const targetY = Math.max(-40, Math.min(race.finishY + 140 - viewH, focus.y - viewH * 0.45));
    const targetX = Math.max(0, Math.min(W - viewW, focus.x - viewW / 2));
    if (race.seed !== this.lastSeed || race.time < 0.05) {
      this.camY = targetY;
      this.camX = targetX;
      this.lastSeed = race.seed;
    }
    this.camY += (targetY - this.camY) * 0.08;
    this.camX += (targetX - this.camX) * 0.06;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, (MARGIN - this.camX) * scale, -this.camY * scale);

    const top = this.camY - 60;
    const bottom = this.camY + viewH + 60;
    this.drawTrack(race, top, bottom);

    // 이름: 많으면 주목할 원 몇 개만
    const crowded = race.balls.length > 16;
    const named = new Set<number>();
    if (crowded) {
      const order = race.standings().filter((b) => !b.place || race.mode === 'winner');
      const pick = race.mode === 'winner' ? order.slice(0, NAMED_WHEN_CROWDED) : order.slice(-NAMED_WHEN_CROWDED);
      for (const b of pick) named.add(b.id);
    }
    for (const b of race.balls) {
      if (b.y < top - 30 || b.y > bottom + 30) continue;
      this.drawBall(b, !crowded || named.has(b.id));
    }
    for (const e of race.effects) if (e.kind !== 'banner') this.drawEffect(e);

    // 화면 고정 요소
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.drawMinimap(race, viewW, viewH);
    for (const e of race.effects) if (e.kind === 'banner') this.drawBanner(e.text, e.color, e.t / e.life, viewW, viewH);
  }

  /** 화면에서 size px로 보이도록 하는 월드 단위 크기 */
  private px(size: number): number {
    return (size * this.dpr) / this.scale;
  }

  private drawTrack(race: Race, top: number, bottom: number): void {
    const { ctx } = this;
    const { track } = race;
    const W = track.width;
    const t = race.time;
    const y0 = Math.max(top, -80);
    const y1 = Math.min(bottom, track.finishY + 220);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, y0, W, y1 - y0);

    // 출발선
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.fillRect(0, track.startY - 30, W, 3);

    // 구간 이름
    for (const l of track.labels) {
      if (l.y < top - 20 || l.y > bottom) continue;
      ctx.fillStyle = 'rgba(148,163,184,0.12)';
      ctx.fillRect(0, l.y - 1, W, 2);
      this.label(l.text, 14, l.y + 14, 'rgba(203,213,225,0.75)', 'left', 12);
    }

    // 구역
    for (const z of track.zones) {
      if (z.y > bottom || z.y + z.h < top) continue;
      if (z.kind === 'boost') {
        ctx.fillStyle = 'rgba(34,197,94,0.16)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        this.chevrons(z.x + z.w / 2, z.y, z.h, (t * 120) % 40, 1, 'rgba(74,222,128,0.6)');
        this.label('⚡ 부스터', z.x + z.w / 2, z.y - 10, '#4ade80');
      } else if (z.kind === 'mud') {
        ctx.fillStyle = 'rgba(120,72,32,0.45)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.fillStyle = 'rgba(80,48,20,0.8)';
        for (let i = 0; i < 18; i++) {
          ctx.beginPath();
          ctx.arc(z.x + ((i * 53) % z.w), z.y + ((i * 97) % z.h), 4 + (i % 3), 0, TAU);
          ctx.fill();
        }
        this.label('🟫 진흙', z.x + z.w / 2, z.y - 10, '#d6a36b');
      } else {
        ctx.fillStyle = 'rgba(56,189,248,0.12)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        this.chevrons(z.x + z.w / 2, z.y, z.h, 40 - ((t * 90) % 40), -1, 'rgba(125,211,252,0.55)');
        this.label('💨 역풍', z.x + z.w / 2, z.y - 10, '#7dd3fc');
      }
    }

    // 벽/경사로/컨베이어
    ctx.lineCap = 'round';
    for (const s of track.segments) {
      if (Math.max(s.y1, s.y2) < top || Math.min(s.y1, s.y2) > bottom) continue;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = s.conveyor ? '#0e7490' : '#94a3b8';
      ctx.lineWidth = s.conveyor ? 9 : 7;
      ctx.stroke();
      if (s.conveyor) {
        // 움직이는 방향 표시
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
      if (p.y < top - 40 || p.y > bottom + 40) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      if (p.bounce > 1) {
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
      if (sp.y < top - 120 || sp.y > bottom + 120) continue;
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

    // 움직이는 막대 (지붕 모양)
    for (const sl of track.sliders) {
      if (sl.y < top - 30 || sl.y > bottom + 30) continue;
      const cx = sliderX(sl, t);
      ctx.beginPath();
      ctx.moveTo(cx - sl.half, sl.y + SLIDER_ROOF);
      ctx.lineTo(cx, sl.y);
      ctx.lineTo(cx + sl.half, sl.y + SLIDER_ROOF);
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 8;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 함정문
    for (const g of track.gates) {
      if (g.y < top - 20 || g.y > bottom + 20) continue;
      const open = gateOpen(g, t);
      const cycle = (t + g.phase) % g.period;
      ctx.lineWidth = 7;
      if (open) {
        // 아래로 열린 두 짝
        ctx.strokeStyle = '#f87171';
        const mid = (g.x1 + g.x2) / 2;
        ctx.beginPath();
        ctx.moveTo(g.x1 + 4, g.y);
        ctx.lineTo(g.x1 + 4, g.y + 34);
        ctx.moveTo(g.x2 - 4, g.y);
        ctx.lineTo(g.x2 - 4, g.y + 34);
        ctx.stroke();
        this.label('열림!', mid, g.y + 14, '#fca5a5', 'center', 12);
      } else {
        ctx.strokeStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(g.x1 + 4, g.y);
        ctx.lineTo(g.x2 - 4, g.y);
        ctx.stroke();
        // 열리기까지 남은 시간 표시줄
        const k = (cycle - g.openFor) / (g.period - g.openFor);
        ctx.fillStyle = 'rgba(251,191,36,0.35)';
        ctx.fillRect(g.x1 + 4, g.y + 6, (g.x2 - g.x1 - 8) * Math.max(0, Math.min(1, k)), 4);
      }
    }

    // 미스터리 포털
    for (const p of track.portals) {
      if (p.y < top - 40 || p.y > bottom + 40) continue;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r - i * 6, t * (2 + i) + i, t * (2 + i) + i + Math.PI * 1.4);
        ctx.strokeStyle = ['#c084fc', '#818cf8', '#e879f9'][i];
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      this.label('❓', p.x, p.y + 1, '#f5f3ff', 'center', 16);
    }

    // 좌우 벽
    ctx.fillStyle = '#475569';
    ctx.fillRect(-6, y0, 6, y1 - y0);
    ctx.fillRect(W, y0, 6, y1 - y0);

    // 얼음 대포: 발사 직전에 포구가 밝아짐
    for (const c of track.cannons) {
      if (c.y < top - 30 || c.y > bottom + 30) continue;
      const charge = ((t + c.phase) % c.period) / c.period;
      const x = c.dir > 0 ? 0 : W;
      ctx.save();
      ctx.translate(x, c.y);
      ctx.scale(c.dir, 1);
      ctx.fillStyle = '#1e3a5f';
      ctx.beginPath();
      ctx.roundRect(-4, -13, 20, 26, 5);
      ctx.fill();
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(12, -6, 14, 12);
      ctx.beginPath();
      ctx.arc(26, 0, 4 + charge * 4, 0, TAU);
      ctx.fillStyle = `rgba(186,230,253,${0.2 + charge * 0.8})`;
      ctx.fill();
      ctx.restore();
    }
    // 날아가는 얼음
    for (const s of race.iceShots) {
      if (s.y < top || s.y > bottom) continue;
      const dir = Math.sign(s.vx);
      ctx.beginPath();
      ctx.moveTo(s.x - dir * 28, s.y);
      ctx.lineTo(s.x, s.y);
      ctx.strokeStyle = 'rgba(125,211,252,0.45)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x + dir * 9, s.y);
      ctx.lineTo(s.x, s.y - 6);
      ctx.lineTo(s.x - dir * 6, s.y);
      ctx.lineTo(s.x, s.y + 6);
      ctx.closePath();
      ctx.fillStyle = '#e0f2fe';
      ctx.fill();
    }

    // 결승선 (체크무늬)
    const fy = track.finishY;
    if (fy > top - 20 && fy < bottom + 20) {
      const sq = 15;
      for (let i = 0; i * sq < W; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#f8fafc' : '#0f172a';
          ctx.fillRect(i * sq, fy - sq + j * sq, sq, sq);
        }
      }
      this.label('🏁 FINISH', W / 2, fy - sq - 14, '#f8fafc');
    }
  }

  private chevrons(cx: number, y: number, h: number, offset: number, dir: 1 | -1, color: string): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    for (let yy = y + offset; yy < y + h - 10; yy += 40) {
      ctx.beginPath();
      ctx.moveTo(cx - 16, yy);
      ctx.lineTo(cx, yy + 12 * dir);
      ctx.lineTo(cx + 16, yy);
      ctx.stroke();
    }
  }

  private drawBall(b: RaceBall, showName: boolean): void {
    const { ctx } = this;
    ctx.save();
    if (b.place) ctx.globalAlpha = 0.7;
    if (b.boosted) {
      ctx.beginPath();
      ctx.arc(b.x, b.y - b.r * 0.8, b.r * 0.9, 0, TAU);
      ctx.fillStyle = 'rgba(74,222,128,0.35)';
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

  /** 오른쪽 미니맵: 트랙 전체에서 각 원의 위치 */
  private drawMinimap(race: Race, viewW: number, viewH: number): void {
    const { ctx } = this;
    const x = viewW + MARGIN * 2 + 2;
    const y0 = 16;
    const hh = viewH - 32;
    const total = race.finishY;
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(x, y0, MINIMAP_W, hh);
    const vy = y0 + (Math.max(0, this.camY) / total) * hh;
    const vh = Math.min(hh, (viewH / total) * hh);
    ctx.fillStyle = 'rgba(148,163,184,0.25)';
    ctx.fillRect(x, vy, MINIMAP_W, vh);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x - 2, y0 + hh - 2, MINIMAP_W + 4, 3);
    const dot = race.balls.length > 30 ? 2.5 : 4;
    for (const b of race.balls) {
      const p = Math.max(0, Math.min(1, b.y / total));
      ctx.beginPath();
      ctx.arc(x + MINIMAP_W / 2, y0 + p * hh, dot, 0, TAU);
      ctx.fillStyle = b.color;
      ctx.fill();
    }
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
    ctx.translate(viewW / 2 + MARGIN, viewH * 0.18);
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
