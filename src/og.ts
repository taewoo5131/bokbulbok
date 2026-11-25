/**
 * 공유 썸네일(og:image) 제작용. tools/og.html?game=battle|race 를 헤드리스 크롬으로 캡처해서
 * public/og-*.png 로 저장함. 배포 빌드에는 포함되지 않음.
 */
import './style.css';
import { Game } from './game/game';
import { Race } from './race/race';
import { Renderer } from './render/canvas';
import { RaceRenderer } from './render/race-canvas';

const names = ['돈까스', '국밥', '냉면', '짜장면', '김치찌개', '초밥', '마라탕', '치킨'];
const game = new URLSearchParams(location.search).get('game') ?? 'battle';
const canvas = document.getElementById('og-canvas') as HTMLCanvasElement;
const $ = (id: string) => document.getElementById(id)!;

const tag = (text: string, hl = false) => {
  const s = document.createElement('span');
  s.textContent = text;
  if (hl) s.className = 'hl';
  return s;
};

if (game === 'race') {
  $('og-title').textContent = '🏁 레이스';
  $('og-sub').textContent = '지그재그 장애물 코스를 달려 도착 순서로 정해요';
  $('og-tags').append(tag('🎰 지름길', true), tag('❄️ 얼음 대포'), tag('🔥 추격 부스트'), tag('최대 100명'));
  canvas.style.width = '600px';
  canvas.style.height = '450px';
  canvas.style.borderRadius = '16px';
  const race = new Race(names, 'winner', 4242);
  const r = new RaceRenderer(canvas);
  while (race.time < Number(new URLSearchParams(location.search).get('t') ?? 18)) {
    race.step(1 / 60);
    r.draw(race);
  }
} else {
  $('og-title').textContent = '⚔️ 배틀';
  $('og-sub').textContent = '후보를 넣으면 원들이 무기를 주워 싸워서 정해줘요';
  $('og-tags').append(tag('🏆 1등 뽑기', true), tag('💀 꼴등 뽑기', true), tag('☄️ 운석'), tag('최대 100명'));
  canvas.style.width = '600px';
  canvas.style.height = '600px';
  const g = new Game(names, 'winner', 20261125);
  const r = new Renderer(canvas);
  while (g.time < 14) g.step(1 / 60);
  r.draw(g);
}
document.title = 'ready';
