import Minigame from './Minigame.js';

// Sayı Sıralama.
// 1..25 sayıları ekrana KARIŞIK ama üst üste binmeyecek şekilde dağıtılır (dizilim
// round başında server'da bir kez üretilir, herkese AYNISI gider -> adil). Oyuncu
// küçükten büyüğe sırayla tıklar (1->2->...->25). Yanlış tık cezasız (sadece zaman
// kaybı). Üst sınır 60 sn. Bu bir SÜRE yarışı: kim daha hızlı bitirirse üstte.
//
// SKOR MODELİ (ctx.end "yüksek = iyi" bekliyor; iki durumu tek eksene taşıyoruz):
//   - Tamamlayan  : 1_000_000 - bitirmeSüresiMs   (>= ~940000; hızlı = daha yüksek)
//   - Tamamlayamayan: ilerleme (0..24)            (kaç sayıya kadar geldiyse)
// Böylece: her tamamlayan (>=940000) her tamamlayamayandan (<=24) KESİN üstte;
// tamamlayanlar süreye göre; tamamlayamayanlar ilerlemeye göre sıralanır. Room'un
// tie-aware sıralaması sadece SIRAYI kullandığı için mutlak sayılar önemli değil,
// yalnızca bu toplam sıralamanın doğru olması yeterli (beraberlikler paylaşılır).
const TIME_LIMIT_MS = 60000;
const TICK_MS = 1000;
const GRID = 5;             // 5x5 = 25 hücre (her sayı ayrı hücrede -> çakışma yok)
const MAX = GRID * GRID;    // 25
const JITTER = 4;           // hücre içi rastgele kayma (yüzde) — dağınık görünüm

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default class NumberSortGame extends Minigame {
  static id = 'number-sort';
  static displayName = 'Sayı Sıralama';

  start() {
    // DiziliM: her sayıyı ayrı bir hücreye koy (çakışma imkansız), hücre içinde hafif kaydır.
    const cells = shuffle([...Array(MAX).keys()], this.ctx.random);
    this.layout = [];
    for (let n = 1; n <= MAX; n++) {
      const cell = cells[n - 1];
      const col = cell % GRID;
      const row = Math.floor(cell / GRID);
      const jx = (this.ctx.random() * 2 - 1) * JITTER;
      const jy = (this.ctx.random() * 2 - 1) * JITTER;
      const x = Math.round(((col + 0.5) / GRID) * 100 + jx);
      const y = Math.round(((row + 0.5) / GRID) * 100 + jy);
      this.layout.push({ num: n, x, y });
    }
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + TIME_LIMIT_MS;
    this.state = {};
    for (const p of this.players) this.state[p.id] = { next: 1, finishMs: null, left: false };
    this._lastSecond = Math.ceil(TIME_LIMIT_MS / 1000);
    this.timer = setTimeout(() => this.finish(), TIME_LIMIT_MS);
    this.tick = setInterval(() => {
      const sec = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
      if (sec !== this._lastSecond) { this._lastSecond = sec; this.ctx.broadcastView(); }
    }, TICK_MS);
  }

  handleInput(playerId, input) {
    const s = this.state[playerId];
    if (!s || !input || s.finishMs !== null || Date.now() >= this.endsAt) return;
    if (typeof input.num !== 'number') return;
    // Server-authoritative: yalnızca SIRADAKİ doğru sayı ilerletir (uydurma engellenir).
    if (input.num === s.next) {
      s.next += 1;
      if (s.next > MAX) s.finishMs = Date.now() - this.startedAt; // set tamamlandı
      this.ctx.broadcastView();
      this._maybeEndEarly();
    }
    // Yanlış/sıra dışı tık: hiçbir şey (ceza yok, yayın yok).
  }

  _maybeEndEarly() {
    // Herkes ya bitirdi ya ayrıldıysa 60 sn'yi beklemeye gerek yok.
    const allDone = this.players.every((p) => {
      const s = this.state[p.id];
      return s.finishMs !== null || s.left;
    });
    if (allDone) this.finish();
  }

  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (s) { s.left = true; this._maybeEndEarly(); } // ilerlemesi skorlamada kullanılır
  }

  getView() {
    const timeLeftMs = Math.max(0, this.endsAt - Date.now());
    const players = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      players[p.id] = {
        nickname: p.nickname,
        next: s.next, // sıradaki hedef (26 = bitti)
        progress: Math.min(s.next - 1, MAX),
        finished: s.finishMs !== null,
      };
    }
    // layout sabit; client sayıları buna göre çizer, tamamlananları (num < next) soluklaştırır.
    return { total: MAX, timeLimitMs: TIME_LIMIT_MS, timeLeftMs, layout: this.layout, players };
  }

  finish() {
    if (this._done) return;
    this._done = true;
    this.stop();
    const scores = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      if (s.finishMs !== null) {
        scores[p.id] = 1000000 - s.finishMs; // tamamlayan: hızlı = daha yüksek
      } else {
        scores[p.id] = Math.min(s.next - 1, MAX - 1); // tamamlayamayan: ilerleme (0..24)
      }
    }
    this.ctx.end(scores);
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
  }
}
