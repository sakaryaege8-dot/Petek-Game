import Minigame from './Minigame.js';

// Ok Tuşu Yarışı.
// Her oyuncunun kendi ok kuyruğu, kendi combo'su ve kendi skoru var (bağımsız).
// 30 saniye boyunca kuyruk sürekli beslenir; "dizi bitti" durumu yoktur.
// Server-authoritative: kuyruk ve skor tamamen server'da; client sadece basılan
// tuşu 'game:input' ile yollar, en öndeki okla karşılaştırma burada yapılır.
const DIRS = ['up', 'down', 'left', 'right'];
const ROUND_MS = 30000;      // sabit round süresi
const QUEUE_LEN = 5;         // önde tutulan ok sayısı (client ilk 4'ünü çizer)
const TICK_MS = 1000;        // geri sayım için periyodik yayın

export default class ArrowRushGame extends Minigame {
  static id = 'arrow-rush';
  static displayName = 'Ok Tuşu Yarışı';

  start() {
    this.state = {}; // playerId -> { queue, combo, score, seq, lastCorrect }
    for (const p of this.players) {
      this.state[p.id] = {
        queue: Array.from({ length: QUEUE_LEN }, () => this._rand()),
        combo: 0,
        score: 0,
        seq: 0,           // her input'ta artar (client geri bildirim/flash için)
        lastCorrect: null,
      };
    }
    this.endsAt = Date.now() + ROUND_MS;
    this.timer = setTimeout(() => this.finish(), ROUND_MS);
    // Geri sayımın client'ta akması için düzenli yayın.
    this.tick = setInterval(() => this.ctx.broadcastView(), TICK_MS);
  }

  _rand() {
    return DIRS[Math.floor(this.ctx.random() * DIRS.length)];
  }

  handleInput(playerId, input) {
    const s = this.state[playerId];
    if (!s || !input || Date.now() >= this.endsAt) return;
    const key = input.key;
    if (!DIRS.includes(key)) return;

    if (key === s.queue[0]) {
      // Doğru: combo büyür, kazanılan puan = combo'nun YENİ değeri.
      s.combo += 1;
      s.score += s.combo;
      s.lastCorrect = true;
    } else {
      // Yanlış: combo sıfırlanır, öndeki ok "kaçtı" sayılır ama yine de düşer.
      s.combo = 0;
      s.lastCorrect = false;
    }
    // Her iki durumda da öndeki ok kuyruktan düşer, arkadan yeni ok gelir.
    s.queue.shift();
    s.queue.push(this._rand());
    s.seq += 1;
    this.ctx.broadcastView();
  }

  onPlayerLeave(playerId) {
    // Bağımsız oynandığı için ek işlem yok; oyuncunun mevcut skoru state'te korunur
    // ve round süresi dolunca finish() ile end'e dahil edilir.
  }

  getView() {
    const timeLeftMs = Math.max(0, this.endsAt - Date.now());
    const players = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      players[p.id] = {
        nickname: p.nickname,
        queue: s.queue.slice(0, 4), // client'ta gösterilecek ilk 4 ok
        combo: s.combo,
        score: s.score,
        seq: s.seq,
        lastCorrect: s.lastCorrect,
      };
    }
    return { durationMs: ROUND_MS, timeLeftMs, players };
  }

  finish() {
    if (this._done) return;
    this._done = true;
    this.stop();
    const scores = {};
    for (const p of this.players) scores[p.id] = this.state[p.id].score;
    // rawScore = toplam skor (yüksek = iyi); Room'un tie-aware sıralaması aynen çalışır.
    this.ctx.end(scores);
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
  }
}
