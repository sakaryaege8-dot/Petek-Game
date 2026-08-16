import Minigame from './Minigame.js';

// Kırmızı Işık Yeşil Işık — senkron dayanma/refleks oyunu.
// Karakterler yolun solundan sağına (x: 0 -> 1) ilerler. Oyuncu tuşu BASILI TUTUNCA
// ilerler, bırakınca durur. Büyük ışık göstergesi YEŞİL iken hareket serbest, KIRMIZI
// iken YASAK. Yeşil/kırmızı süreleri RASTGELE (uyarı yok). Kırmızıda tuşu basılı tutan
// (hareket eden) oyuncu ANINDA elenir. x=1'e ulaşan başarıyla bitirir. Round; herkes
// elenene/bitirene kadar ya da 60 sn üst sınırda (hangisi önce) biter.
//
// SERVER-AUTHORITATIVE: ışık durumu ve her oyuncunun x'i server'da. Kimin tuşu basılı
// (holding) olduğu server'da tutulur; elenme kararını server verir (client "elenmedim"
// diyemez). Işık ve konumlar tek broadcast ile herkese senkron gider (Simon gibi).
//
// SKOR (tek rawScore'a çevrildi):
//   - BİTİRENLER: 1000 + bonus, bonus = round((ROUND_MS - finishMs)/100). Yüksek taban
//     (1000) sayesinde her bitiren, bitiremeyen HERKESTEN üstte. Bonus erken bitireni
//     ödüllendirir (finishMs küçük -> bonus büyük), yani İLK bitiren en yüksek.
//   - BİTİREMEYENLER (elenen/süre dolan/kopan): round(x*100) = ilerleme yüzdesi (0..100).
//     Daha ileri gitmiş olan daha yüksek. 100 < 1000 olduğundan bitirenlerin altında.
//   Tie-aware sıralama beraberlikleri zaten paylaştırır (dokunulmadı).
const ROUND_MS = 60000;
const TICK_MS = 100;              // hareket + geri sayım yayını
const MOVE_SPEED = 0.16;          // yeşilde saniyede ilerleme (fraction/sn) -> tam tur ~6.25s
const GREEN_MIN = 1500, GREEN_MAX = 5500; // yeşil süresi aralığı (rastgele)
const RED_MIN = 1500, RED_MAX = 4000;     // kırmızı süresi aralığı (rastgele)

export default class RedLightGreenLightGame extends Minigame {
  static id = 'red-light-green-light';
  static displayName = 'Kırmızı Işık Yeşil Işık';

  start() {
    this._done = false;
    this.startAt = Date.now();
    this.lastTickAt = this.startAt;
    this.light = 'green';
    this.finishSeq = 0;
    this.state = {};
    for (const p of this.players) {
      this.state[p.id] = {
        nickname: p.nickname,
        x: 0,
        holding: false,
        eliminated: false,
        finished: false,
        left: false,
        finishMs: null,
        finishOrder: null,
      };
    }
    this._scheduleLight();
    this.tick = setInterval(() => this._tick(), TICK_MS);
    this.endTimer = setTimeout(() => this._end(), ROUND_MS);
    this.ctx.broadcastView();
  }

  _rand(min, max) { return min + this.ctx.random() * (max - min); }

  // Bir sonraki ışık geçişini rastgele süre sonra planla.
  _scheduleLight() {
    const dur = this.light === 'green' ? this._rand(GREEN_MIN, GREEN_MAX) : this._rand(RED_MIN, RED_MAX);
    this._lightTimer = setTimeout(() => this._flipLight(), dur);
  }

  _flipLight() {
    if (this._done) return;
    this.light = this.light === 'green' ? 'red' : 'green';
    if (this.light === 'red') {
      // Kırmızı yandı: o an hareket eden (tuşu basılı) herkes anında elenir.
      for (const p of this.players) {
        const s = this.state[p.id];
        if (!s.eliminated && !s.finished && !s.left && s.holding) this._eliminate(p.id);
      }
    }
    this.ctx.broadcastView();
    this._maybeEnd();
    if (!this._done) this._scheduleLight();
  }

  _tick() {
    if (this._done) return;
    const now = Date.now();
    const dt = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;

    if (this.light === 'green') {
      for (const p of this.players) {
        const s = this.state[p.id];
        if (s.eliminated || s.finished || s.left || !s.holding) continue;
        s.x += MOVE_SPEED * dt;
        if (s.x >= 1) { s.x = 1; this._finish(p.id); }
      }
    } else {
      // Güvenlik: kırmızıda hâlâ hareket eden varsa ele (flip/input normalde yakalar).
      for (const p of this.players) {
        const s = this.state[p.id];
        if (!s.eliminated && !s.finished && !s.left && s.holding) this._eliminate(p.id);
      }
    }
    this.ctx.broadcastView();
    this._maybeEnd();
  }

  // Basılı tut / bırak olayları. Kırmızıda basmaya BAŞLAMAK da anında eler.
  handleInput(playerId, input) {
    if (this._done || !input || input.type !== 'hold') return;
    const s = this.state[playerId];
    if (!s || s.eliminated || s.finished || s.left) return;
    s.holding = !!input.down;
    if (s.holding && this.light === 'red') {
      this._eliminate(playerId);
      this.ctx.broadcastView();
      this._maybeEnd();
    }
  }

  _eliminate(playerId) {
    const s = this.state[playerId];
    if (!s || s.eliminated || s.finished) return;
    s.eliminated = true;
    s.holding = false; // x olduğu yerde donar
  }

  _finish(playerId) {
    const s = this.state[playerId];
    if (!s || s.finished || s.eliminated) return;
    s.finished = true;
    s.x = 1;
    s.finishMs = Date.now() - this.startAt;
    s.finishOrder = this.finishSeq++;
  }

  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (!s || s.eliminated || s.finished || s.left) return;
    // Kopan oyuncu elenmiş sayılmaz (haksızlık olmasın); ilerlemesi dondurulur,
    // artık hareket etmez, beklenmez. Skoru mevcut x ile korunur.
    s.left = true;
    s.holding = false;
    this._maybeEnd();
  }

  _activeCount() {
    return this.players.filter((p) => {
      const s = this.state[p.id];
      return !s.eliminated && !s.finished && !s.left;
    }).length;
  }

  _maybeEnd() {
    if (!this._done && this._activeCount() === 0) this._end();
  }

  _end() {
    if (this._done) return;
    this._done = true;
    this.stop();
    const scores = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      if (s.finished) {
        const bonus = Math.round((ROUND_MS - s.finishMs) / 100); // erken bitiren daha yüksek
        scores[p.id] = 1000 + bonus;
      } else {
        scores[p.id] = Math.round(s.x * 100); // ilerleme yüzdesi (0..100)
      }
    }
    this.ctx.end(scores);
  }

  getView() {
    const now = Date.now();
    const players = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      players[p.id] = {
        nickname: s.nickname,
        x: s.x,
        eliminated: s.eliminated,
        finished: s.finished,
        left: s.left,
        finishOrder: s.finishOrder,
        // "moving" = yürüme animasyonu için: aktif + basılı + yeşil
        moving: !s.eliminated && !s.finished && !s.left && s.holding && this.light === 'green',
      };
    }
    return {
      light: this.light,
      timeLeftMs: Math.max(0, this.startAt + ROUND_MS - now),
      durationMs: ROUND_MS,
      activeCount: this._activeCount(),
      total: this.players.length,
      players,
    };
  }

  stop() {
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    if (this._lightTimer) { clearTimeout(this._lightTimer); this._lightTimer = null; }
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
  }
}
