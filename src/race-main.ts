/** 🏁 레이스 페이지 진입점 */
import './style.css';
import { Race } from './race/race';
import { RaceRenderer } from './render/race-canvas';
import { runShell } from './shell';

let renderer: RaceRenderer | null = null;

runShell<Race>({
  create: (names, mode, seed) => new Race(names, mode, seed),
  draw: (race, canvas) => {
    renderer ??= new RaceRenderer(canvas);
    renderer.draw(race);
  },
  entrants: (race) => race.balls,
  hud: (race) => {
    const t = Math.floor(race.time);
    const n = race.balls.length;
    const goal = race.mode === 'winner' ? '먼저 도착하면 1등' : `꼴등 결정까지 ${Math.max(0, n - 1 - race.arrived)}명`;
    return `⏱ ${t}s · 도착 ${race.arrived}/${n} · ${goal}`;
  },
  roster: (race) => {
    const rank = new Map(race.standings().map((b, i) => [b.id, i + 1]));
    return race.balls.map((b) => {
      const r = rank.get(b.id)!;
      return {
        bar: b.place ? 1 : Math.max(0, b.y) / race.finishY,
        barColor: b.place ? '#fbbf24' : '#38bdf8',
        icon: b.place ? (['🥇', '🥈', '🥉'][b.place - 1] ?? `${b.place}위`) : `${r}위`,
        out: false,
      };
    });
  },
});
