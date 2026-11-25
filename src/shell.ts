/**
 * 게임 공통 화면: 입력 → 경기 → 결과/공유.
 * 각 게임(배틀, 레이스 …)은 GameDef만 구현하면 이 화면을 그대로 씁니다.
 * 입력값은 localStorage를 공유하므로 게임을 바꿔도 그대로 유지됩니다.
 */
import { colorFor } from './game/colors';
import { MAX_ENTRANTS, SIZE_INFO, sizeFor } from './game/size';
import { randomSeed } from './game/rng';
import type { Mode } from './game/types';


export interface Entrant {
  id: number;
  name: string;
  color: string;
}

export interface Result {
  mode: Mode;
  picked: Entrant;
  /** 1등 → 꼴등 순서 */
  ranking: Entrant[];
}

export interface PlayableGame {
  readonly seed: number;
  readonly finished: boolean;
  readonly result: Result | null;
  step(dt: number): void;
}

export interface RosterRow {
  /** 0~1 막대 길이 (배틀: 체력, 레이스: 진행도) */
  bar: number;
  barColor: string;
  /** 오른쪽 작은 표시 (무기 이모지, 순위 등) */
  icon: string;
  /** 탈락/도착 등으로 흐리게 표시 */
  out: boolean;
}

export interface GameDef<G extends PlayableGame> {
  create(names: string[], mode: Mode, seed: number): G;
  draw(game: G, canvas: HTMLCanvasElement): void;
  entrants(game: G): Entrant[];
  /** 상단 상태 표시 (HTML) */
  hud(game: G): string;
  roster(game: G): RosterRow[];
}

const MIN_ITEMS = 2;
const MAX_ITEMS = MAX_ENTRANTS;
const MAX_NAME_LEN = 12;
const STEP = 1 / 60;
/** 같이 보기: 링크를 만든 뒤 경기 시작까지 기다리는 시간 */
const WATCH_DELAY_MS = 15_000;
const STORAGE_KEY = 'bokbulbok:last';
/** 프로젝트 이름을 바꾸기 전에 쓰던 키 (기존 방문자 입력값을 옮겨 오기 위해) */
const OLD_STORAGE_KEY = 'circle-battle:last';

const PRESETS: Record<string, string[]> = {
  lunch: ['돈까스', '국밥', '냉면', '짜장면', '김치찌개', '초밥'],
  dinner: ['삼겹살', '치킨', '피자', '마라탕', '족발', '회'],
  numbers: ['1', '2', '3', '4', '5', '6'],
};

/** "이름*3" → 같은 이름 3개. 곱하기 기호는 * 또는 × (영문 x는 "box2" 같은 이름과 헷갈려서 제외) */
const REPEAT_RE = /^(.+?)\s*[*×]\s*(\d+)$/;

export function runShell<G extends PlayableGame>(def: GameDef<G>): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const el = {
    screenInput: $('screen-input'),
    screenGame: $('screen-game'),
    form: $<HTMLFormElement>('add-form'),
    input: $<HTMLInputElement>('item-input'),
    chips: $('chips'),
    hint: $('hint'),
    start: $<HTMLButtonElement>('start-btn'),
    clear: $('clear-btn'),
    canvas: $<HTMLCanvasElement>('canvas'),
    hud: $('hud'),
    roster: $('roster'),
    speed: $('speed-btn'),
    back: $('back-btn'),
    result: $('result'),
    resultLabel: $('result-label'),
    resultName: $('result-name'),
    resultRanking: $('result-ranking'),
    again: $('again-btn'),
    replay: $('replay-btn'),
    share: $('share-btn'),
    edit: $('edit-btn'),
    watch: $<HTMLButtonElement>('watch-btn'),
    watchAgain: $('watch-again-btn'),
    countdown: $('countdown'),
    countdownNum: $('countdown-num'),
    countdownMsg: $('countdown-msg'),
    countdownShare: $('countdown-share'),
  };

  let items: string[] = [];
  let mode: Mode = 'winner';
  let game: G | null = null;
  let speed = 1;
  let rafId = 0;
  let resultShown = false;
  /** 같이 보기 중이면 경기 시작 시각(epoch ms). 모두 이 시각 기준으로 같은 장면을 계산함 */
  let watchStart: number | null = null;

  // ───────────────────────── 입력 화면 ─────────────────────────

  function addItems(raw: string): void {
    for (const token of raw.split(',')) {
      const t = token.trim();
      if (!t) continue;
      const m = t.match(REPEAT_RE);
      const name = (m ? m[1] : t).trim().slice(0, MAX_NAME_LEN);
      const count = m ? Number(m[2]) : 1;
      if (!name) continue;
      // 같은 이름도 여러 개 허용 (색으로 구분)
      for (let i = 0; i < count && items.length < MAX_ITEMS; i++) items.push(name);
    }
    renderChips();
  }

  function renderChips(): void {
    el.chips.replaceChildren(
      ...items.map((name, i) => {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colorFor(i);
        const label = document.createElement('span');
        label.textContent = name;
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '✕';
        del.setAttribute('aria-label', `${name} 삭제`);
        del.onclick = () => {
          items.splice(i, 1);
          renderChips();
        };
        li.append(dot, label, del);
        return li;
      }),
    );
    const n = items.length;
    el.start.disabled = n < MIN_ITEMS;
    el.watch.disabled = n < MIN_ITEMS;
    const size = sizeFor(n);
    el.hint.textContent =
      n < MIN_ITEMS
        ? `항목을 ${MIN_ITEMS}개 이상 입력하세요 (최대 ${MAX_ITEMS}개)`
        : `${n} / ${MAX_ITEMS}개 · 맵 ${SIZE_INFO[size].label} (${SIZE_INFO[size].max}명까지)`;
    saveLast();
  }

  function setMode(m: Mode): void {
    mode = m;
    document.querySelectorAll<HTMLButtonElement>('.mode button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === m);
      b.setAttribute('aria-checked', String(b.dataset.mode === m));
    });
    saveLast();
  }

  function saveLast(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, mode }));
    } catch {
      /* 저장 불가 환경은 무시 */
    }
  }

  function loadLast(): void {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        raw = localStorage.getItem(OLD_STORAGE_KEY);
        if (raw !== null) {
          localStorage.setItem(STORAGE_KEY, raw);
          localStorage.removeItem(OLD_STORAGE_KEY);
        }
      }
      const data = JSON.parse(raw ?? 'null');
      if (Array.isArray(data?.items)) items = data.items.filter((s: unknown) => typeof s === 'string').slice(0, MAX_ITEMS);
      if (data?.mode === 'winner' || data?.mode === 'loser') mode = data.mode;
    } catch {
      /* 무시 */
    }
  }

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    addItems(el.input.value);
    el.input.value = '';
    el.input.focus();
  });

  document.querySelectorAll<HTMLButtonElement>('.mode button').forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode as Mode);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
    b.onclick = () => {
      items = [...PRESETS[b.dataset.preset!]];
      renderChips();
    };
  });

  el.clear.onclick = () => {
    items = [];
    renderChips();
  };

  el.start.onclick = () => startGame(randomSeed());

  // ───────────────────────── 경기 ─────────────────────────

  /**
   * startAt(epoch ms)을 주면 같이 보기 모드: 각자의 시계로 시작 시각부터 지난 시간만큼 경기를 계산해서,
   * 링크를 연 모든 사람이 같은 순간에 같은 장면을 봄 (늦게 들어오면 지금 장면부터).
   */
  function startGame(seed: number, startAt: number | null = null): void {
    if (items.length < MIN_ITEMS) return;
    game = def.create([...items], mode, seed);
    watchStart = startAt;
    resultShown = false;
    el.result.classList.add('hidden');
    el.screenInput.classList.add('hidden');
    el.screenGame.classList.remove('hidden');
    document.body.classList.add('playing');
    document.body.classList.toggle('watching', startAt !== null);
    if (startAt !== null) {
      speed = 1;
      el.speed.textContent = '1x';
      history.replaceState(null, '', shareUrl(startAt));
    }
    // 늦게 들어온 경우 첫 화면에서 안내 (이미 끝난 경기인지 진행 중인지)
    let lateNotice = startAt !== null && Date.now() > startAt + 1000;
    buildRoster();
    cancelAnimationFrame(rafId);
    let last = performance.now();
    let acc = 0;
    let steps = 0;

    const frame = (now: number) => {
      if (!game) return;
      if (watchStart !== null) {
        const elapsed = (Date.now() - watchStart) / 1000;
        showCountdown(elapsed);
        // 시작 시각 기준으로 지금까지 진행됐어야 할 만큼 계산 (탭을 내렸다 와도 다시 맞춰짐)
        const target = Math.floor(Math.max(0, elapsed) / STEP);
        while (steps < target && !(game.finished && resultShown)) {
          game.step(STEP);
          steps++;
        }
      } else {
        // 탭 전환 등으로 오래 멈췄을 때 한 번에 몰아서 계산하지 않도록 제한
        acc += Math.min(0.1, (now - last) / 1000) * speed;
        last = now;
        while (acc >= STEP) {
          game.step(STEP);
          acc -= STEP;
        }
      }
      if (lateNotice) {
        lateNotice = false;
        toast(game.finished ? '이미 끝난 경기예요. 결과를 보여드릴게요!' : '진행 중인 경기에 들어왔어요. 지금 장면부터 함께 봐요!');
      }
      def.draw(game, el.canvas);
      updateHud();
      if (game.finished && !resultShown) {
        resultShown = true;
        setTimeout(showResult, 1200);
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
  }

  function showCountdown(elapsed: number): void {
    const left = Math.ceil(-elapsed);
    if (left <= 0) {
      el.countdown.classList.add('hidden');
      return;
    }
    el.countdown.classList.remove('hidden');
    const text = String(left);
    if (el.countdownNum.textContent !== text) el.countdownNum.textContent = text;
  }

  /** 같이 보기 링크를 만들어 공유하고, 나도 그 경기를 같은 시각에 시작 */
  async function createWatch(): Promise<void> {
    if (items.length < MIN_ITEMS) return;
    const seed = randomSeed();
    const startAt = Date.now() + WATCH_DELAY_MS;
    startGame(seed, startAt);
    el.countdownMsg.textContent = '링크를 받은 사람은 모두 같은 화면을 봐요';
    await shareLink(shareUrl(startAt), '같이 보기 링크');
  }

  /** 휴대폰이면 공유 창(카톡 등), 아니면 클립보드 복사 */
  async function shareLink(url: string, label: string): Promise<void> {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: document.title, text: `${label} 🎲 같이 봐요!`, url });
        return;
      } catch {
        /* 공유 창을 닫은 경우 아래 복사로 */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(`${label}가 복사됐어요. 카톡에 붙여넣어 공유하세요!`);
    } catch {
      prompt('아래 링크를 복사해서 공유하세요', url);
    }
  }

  let toastTimer = 0;
  function toast(message: string): void {
    let box = document.getElementById('toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast';
      box.className = 'toast';
      document.body.append(box);
    }
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => box!.classList.remove('show'), 2600);
  }

  function stopGame(): void {
    cancelAnimationFrame(rafId);
    game = null;
    watchStart = null;
    document.body.classList.remove('watching');
    el.countdown.classList.add('hidden');
    el.result.classList.add('hidden');
    el.screenGame.classList.add('hidden');
    document.body.classList.remove('playing');
    el.screenInput.classList.remove('hidden');
    history.replaceState(null, '', location.pathname);
  }

  let rosterRows: { li: HTMLLIElement; bar: HTMLElement; icon: HTMLElement }[] = [];

  function buildRoster(): void {
    if (!game) return;
    rosterRows = def.entrants(game).map((b) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = b.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = b.name;
      const icon = document.createElement('span');
      icon.className = 'weapon';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('i');
      bar.append(fill);
      li.append(dot, name, icon, bar);
      return { li, bar: fill, icon };
    });
    el.roster.replaceChildren(...rosterRows.map((r) => r.li));
  }

  let lastHud = '';

  function updateHud(): void {
    if (!game) return;
    const hud = def.hud(game);
    if (hud !== lastHud) {
      el.hud.innerHTML = hud;
      lastHud = hud;
    }
    def.roster(game).forEach((r, i) => {
      const row = rosterRows[i];
      row.bar.style.width = `${Math.max(0, Math.min(1, r.bar)) * 100}%`;
      row.bar.style.background = r.barColor;
      row.li.classList.toggle('dead', r.out);
      if (row.icon.textContent !== r.icon) row.icon.textContent = r.icon;
    });
  }

  function showResult(): void {
    if (!game?.result) return;
    const { picked, ranking, mode: m } = game.result;
    el.resultLabel.textContent = m === 'winner' ? '🏆 1등은!' : '💀 꼴등은…';
    el.resultName.textContent = picked.name;
    el.resultName.style.color = picked.color;
    el.resultRanking.replaceChildren(
      ...ranking.map((b) => {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = b.color;
        li.append(dot, b.name);
        if (b.id === picked.id) li.className = 'picked';
        return li;
      }),
    );
    el.result.classList.remove('hidden');
    // 같이 보기 중이면 주소를 그대로 둬서 새로고침해도 같은 경기로 돌아오게
    if (watchStart === null) history.replaceState(null, '', shareUrl());
  }

  function shareUrl(startAt: number | null = null): string {
    const params = new URLSearchParams();
    params.set('items', items.join(','));
    params.set('mode', mode);
    if (game) params.set('seed', String(game.seed));
    if (startAt !== null) params.set('start', String(startAt));
    return `${location.origin}${location.pathname}?${params}`;
  }

  el.speed.onclick = () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    el.speed.textContent = `${speed}x`;
  };
  el.back.onclick = stopGame;
  el.edit.onclick = stopGame;
  el.again.onclick = () => startGame(randomSeed());
  el.replay.onclick = () => game && startGame(game.seed);
  el.watch.onclick = () => void createWatch();
  el.watchAgain.onclick = () => void createWatch();
  el.countdownShare.onclick = () => {
    if (watchStart !== null) void shareLink(shareUrl(watchStart), '같이 보기 링크');
  };
  el.share.onclick = async () => {
    // 결과 링크는 같이 보기 시각 없이 (받은 사람이 처음부터 다시 보게)
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      el.share.textContent = '✅ 복사됨!';
    } catch {
      prompt('아래 링크를 복사하세요', url);
    }
    setTimeout(() => (el.share.textContent = '🔗 결과 링크 복사'), 1500);
  };

  // ───────────────────────── 초기화 ─────────────────────────
  // ?items=a,b,c&mode=loser&seed=123 → 공유받은 경기를 그대로 재생
  // …&start=1764000000000 → 같이 보기: 그 시각에 맞춰 모두 같은 장면

  loadLast();
  const params = new URLSearchParams(location.search);
  const sharedItems = params.get('items');
  if (sharedItems) {
    items = [];
    addItems(sharedItems);
  }
  const sharedMode = params.get('mode');
  if (sharedMode === 'winner' || sharedMode === 'loser') mode = sharedMode;
  setMode(mode);
  renderChips();

  const sharedSeed = Number(params.get('seed'));
  const sharedStart = Number(params.get('start'));
  if (sharedItems && params.has('seed') && Number.isInteger(sharedSeed)) {
    if (params.has('start') && Number.isFinite(sharedStart) && sharedStart > 0) {
      startGame(sharedSeed, sharedStart);
      el.countdownMsg.textContent = '친구가 보낸 같이 보기 링크예요. 곧 함께 시작해요!';
    } else {
      startGame(sharedSeed);
    }
  }
}
