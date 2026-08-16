import Minigame from './Minigame.js';

// Zaman Vurucu — target-time / iç saat oyunu.
// Round başında server rastgele bir HEDEF SÜRE seçer (5–20 sn, ondalıklı, örn 12.39).
// Hedef herkese aynı gösterilir. Sayaç 0.00'dan başlar; İLK 3 SANİYE görünür (oyuncu
// ritmi hissetsin), sonra EKRANDAN KAYBOLUR (arka planda saymaya devam eder). Oyuncu
// hedefe ulaştığını düşündüğü an butona basar (bir kez). Round; herkes basınca ya da
// üst sınırda (hedef + 15 sn) biter, sonra kısa bir REVEAL'da herkesin süresi/farkı
// karşılaştırmalı gösterilir.
//
// SERVER-AUTHORITATIVE: basış anı SERVER saatiyle ölçülür (now - startAt). Client
// "tam hedefte bastım" diye sahte süre gönderemez. ÖNEMLİ: görünen 0..3sn sayacı
// tamamen CLIENT-LOKAL çizilir; server geçen süreyi (elapsedMs) view'da YOLLAMAZ —
// yollasaydı, birinin basışında yapılan broadcast'te o anki süre herkese sızardı
// (hile). Süreler round bitene kadar gizli (getViewFor: sadece kendi süreni görürsün).
//
// SKOR: rawScore = 1.000.000 / (fark_ms + 1000). fark = |basış - hedef|.
//   - Tam isabet (fark 0) -> 1000 (tavan).  +1000 offset sıfıra bölmeyi engeller
//     ve tam isabette 1000 verir.
//   - Ters orantı: fark büyüdükçe puan düşer ama HEP POZİTİF kalır, yani en kötü
//     basan bile hiç basmayandan (0) iyidir. (Örn fark 0.1s->909, 1s->500, 5s->167.)
//   - Hiç basmayan = 0 (garanti en düşük).
const TARGET_MIN_MS = 5000;
const TARGET_MAX_MS = 20000;
const VISIBLE_MS = 3000;      // sayaç ilk 3 sn görünür
const CAP_EXTRA_MS = 15000;   // üst süre sınırı = hedef + 15 sn (hiç basmayanlar için)
const REVEAL_MS = 6000;       // round sonu karşılaştırmalı reveal süresi

export default class TimeTargetGame extends Minigame {
  static id = 'time-target';
  static displayName = 'Zaman Vurucu';

  start() {
    this._done = false;
    this.phase = 'playing'; // 'playing' | 'reveal'
    this.startAt = Date.now();
    // Hedef süre: 10 ms'e yuvarla -> temiz 2 ondalık gösterim (örn 12.39).
    const raw = TARGET_MIN_MS + this.ctx.random() * (TARGET_MAX_MS - TARGET_MIN_MS);
    this.targetMs = Math.round(raw / 10) * 10;

    this.state = {};
    for (const p of this.players) {
      this.state[p.id] = { nickname: p.nickname, pressed: false, pressMs: null, left: false };
    }
    this.results = null;
    // Üst sınır: hedef + 15 sn (hiç basmayanlar takılıp kalmasın).
    this.endTimer = setTimeout(() => this._startReveal(), this.targetMs + CAP_EXTRA_MS);
    this.ctx.broadcastView();
  }

  handleInput(playerId, input) {
    if (this._done || this.phase !== 'playing' || !input || input.type !== 'press') return;
    const s = this.state[playerId];
    if (!s || s.left || s.pressed) return;     // bir kez basılır
    s.pressed = true;
    s.pressMs = Date.now() - this.startAt;      // server ölçümü (authoritative)
    this.ctx.broadcastView();                   // "X/Y bastı" güncellensin (süre gizli)
    this._maybeEarlyFinish();
  }

  _maybeEarlyFinish() {
    const active = this.players.filter((p) => !this.state[p.id].left);
    if (active.length > 0 && active.every((p) => this.state[p.id].pressed)) this._startReveal();
  }

  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (!s || s.left) return;
    s.left = true; // beklenmez; bastıysa skoru korunur, basmadıysa 0
    this._maybeEarlyFinish();
  }

  // rawScore = 1.000.000 / (fark_ms + 1000). Tam isabet 1000; ters orantı, hep pozitif.
  _rawScore(pressMs) {
    const diff = Math.abs(pressMs - this.targetMs);
    return Math.round(1000000 / (diff + 1000));
  }

  // Round'u bitir: önce herkesin süresini açan REVEAL, sonra ctx.end.
  _startReveal() {
    if (this._done || this.phase !== 'playing') return;
    this.phase = 'reveal';
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    this.results = this.players
      .map((p) => {
        const s = this.state[p.id];
        const diffMs = s.pressed ? Math.abs(s.pressMs - this.targetMs) : null;
        return {
          playerId: p.id,
          nickname: s.nickname,
          pressed: s.pressed,
          pressSec: s.pressed ? s.pressMs / 1000 : null,
          diffSec: diffMs != null ? diffMs / 1000 : null,
          points: s.pressed ? this._rawScore(s.pressMs) : 0,
        };
      })
      .sort((a, b) => {
        if (a.pressed && b.pressed) return a.diffSec - b.diffSec; // en yakın en üstte
        return (b.pressed ? 1 : 0) - (a.pressed ? 1 : 0);         // basanlar önce
      });
    this.ctx.broadcastView();
    this.revealTimer = setTimeout(() => this._end(), REVEAL_MS);
  }

  _end() {
    if (this._done) return;
    this._done = true;
    this.stop();
    const scores = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      scores[p.id] = s.pressed ? this._rawScore(s.pressMs) : 0; // hiç basmayan = 0
    }
    this.ctx.end(scores);
  }

  // Ortak (SIRSIZ) görüntü. Oynarken süreler gizli; reveal'da herkesinki açılır.
  getView() {
    const players = this.players.map((p) => {
      const s = this.state[p.id];
      return { id: p.id, nickname: s.nickname, pressed: s.pressed, left: s.left };
    });
    const v = {
      phase: this.phase,
      targetMs: this.targetMs,
      targetSec: this.targetMs / 1000,
      visibleMs: VISIBLE_MS,
      players,
      pressedCount: players.filter((p) => p.pressed).length,
      total: this.players.length,
    };
    if (this.phase === 'reveal') v.results = this.results;
    return v;
  }

  // Oyuncuya özel: kendi basış süreni/farkını sadece SEN görürsün (sürpriz bozulmasın).
  getViewFor(playerId) {
    const v = this.getView();
    const s = this.state[playerId];
    const pressed = !!(s && s.pressed);
    v.you = {
      participant: !!s,
      pressed,
      pressSec: pressed ? s.pressMs / 1000 : null,
      diffSec: pressed ? Math.abs(s.pressMs - this.targetMs) / 1000 : null,
      points: pressed ? this._rawScore(s.pressMs) : null,
    };
    return v;
  }

  stop() {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    if (this.revealTimer) { clearTimeout(this.revealTimer); this.revealTimer = null; }
  }
}
