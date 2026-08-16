import Minigame from './Minigame.js';

// Kırmızı Buton — nerve / dayanma oyunu. Simon Diyor'dan sonra setteki İKİNCİ
// gerçek SENKRON oyun: gizli "patlama anı" TÜM oyunculara AYNI ANDA yansır.
//
// Fikir: Round başında server gizli bir patlama anı seçer (3–25 sn arası). O an
// gelince ekran herkeste aynı anda "patlar" (dramatik efekt). Patlama artık bir
// SON TESLİM ANI: puanı, patlamadan ÖNCE ne kadar GEÇ basarsan o kadar yüksek
// alırsın. Patlamadan SONRA basarsan (ya da hiç basmazsan) 0 puan. Gerilim: geç
// basmak çok kazandırır ama fazla beklersen patlar ve elin boş kalır.
//
// SERVER-AUTHORITATIVE: hem patlama zamanı hem de basış zamanları server saatiyle
// ölçülür. Client "27 saniyede bastım" diye sahte zaman gönderemez — server,
// input'un GELDİĞİ gerçek anı (now - startAt) kaydeder ve patlamadan önce mi
// (now < explodeAt) olduğunu kendisi belirler. Patlama, Simon'daki gibi tek bir
// broadcast() ile tüm soketlere aynı anda gider (senkron).
//
// SKOR: patlamadan ÖNCE basan -> rawScore = basış anı (saniye, 0.1 hassasiyet;
// geç = yüksek). Patlamadan SONRA basan ya da hiç basmayan -> rawScore = 0.
// Round; HERKES patlamadan önce basınca ya da patlama olunca (kısa reveal molasıyla)
// ya da 30 sn dolunca biter. Süreler round bitene kadar GİZLİ (getViewFor ile
// sadece kendi süreni görürsün); reveal Room'un round-sonucu sıralamasında olur.
const ROUND_MS = 30000;            // sabit üst süre sınırı
const EXPLODE_MIN_MS = 3000;       // patlama anı alt sınırı
const EXPLODE_MAX_MS = 25000;      // patlama anı üst sınırı
const POST_EXPLODE_GRACE_MS = 1600;// patlamadan sonra: kısa reveal, sonra round biter
const TICK_MS = 250;               // geri sayım yayını (saniye değişince)

export default class RedButtonGame extends Minigame {
  static id = 'red-button';
  static displayName = 'Kırmızı Buton';

  start() {
    this._done = false;
    this._timers = [];
    this.startAt = Date.now();
    // Gizli patlama anı — HİÇBİR oyuncuya önceden gösterilmez.
    this.explodeAt =
      this.startAt + EXPLODE_MIN_MS + Math.floor(this.ctx.random() * (EXPLODE_MAX_MS - EXPLODE_MIN_MS));
    this.exploded = false;

    this.state = {};
    for (const p of this.players) {
      // late = patlamadan SONRA basıldı mı (true -> 0 puan)
      this.state[p.id] = { nickname: p.nickname, pressed: false, pressMs: null, late: false, left: false };
    }

    this._lastSecond = Math.ceil(ROUND_MS / 1000);
    // Senkron patlama zamanlayıcısı.
    this._timers.push(setTimeout(() => this._explode(), this.explodeAt - this.startAt));
    // Kesin bitiş (30 sn).
    this.endTimer = setTimeout(() => this.finish(), ROUND_MS);
    // Geri sayım yayını.
    this.tick = setInterval(() => {
      const sec = Math.max(0, Math.ceil((this.startAt + ROUND_MS - Date.now()) / 1000));
      if (sec !== this._lastSecond) { this._lastSecond = sec; this.ctx.broadcastView(); }
    }, TICK_MS);

    this.ctx.broadcastView();
  }

  // Patlama anı: exploded=true yap ve TEK broadcast ile herkese aynı anda gönder.
  // Patlamadan sonra puan kazanılamaz; kısa bir reveal molası verip round'u bitir.
  _explode() {
    if (this._done || this.exploded) return;
    this.exploded = true;
    this.ctx.broadcastView();
    this._timers.push(setTimeout(() => this.finish(), POST_EXPLODE_GRACE_MS));
  }

  handleInput(playerId, input) {
    if (this._done || !input || input.type !== 'press') return;
    const s = this.state[playerId];
    if (!s || s.left || s.pressed) return;             // bir kez basılır
    const now = Date.now();
    if (now >= this.startAt + ROUND_MS) return;        // süre bittiyse geç
    s.pressed = true;
    s.pressMs = now - this.startAt;                    // server ölçümü (authoritative)
    s.late = now >= this.explodeAt;                    // patlamadan sonra bastı -> 0 puan
    this.ctx.broadcastView();                          // "X/Y bastı" güncellensin (süre gizli)
    this._maybeEarlyFinish();
  }

  _maybeEarlyFinish() {
    // Tüm KOPMAMIŞ oyuncular bastıysa 30 sn'yi bekleme, erken bitir.
    const active = this.players.filter((p) => !this.state[p.id].left);
    if (active.length > 0 && active.every((p) => this.state[p.id].pressed)) this.finish();
  }

  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (!s || s.left) return;
    s.left = true; // beklenmez; bastıysa skoru korunur, basmadıysa 0
    this._maybeEarlyFinish();
  }

  // Basış anını temiz reveal için 0.1 sn'ye yuvarla (rawScore olarak da kullanılır).
  _pressSec(pressMs) {
    return Math.round(pressMs / 100) / 10;
  }

  // Ortak (SIRSIZ) görüntü: basış SAYISI paylaşılır, basış ZAMANLARI gizli.
  getView() {
    const now = Date.now();
    const players = this.players.map((p) => {
      const s = this.state[p.id];
      return { id: p.id, nickname: s.nickname, pressed: s.pressed, left: s.left };
    });
    const pressedCount = players.filter((p) => p.pressed).length;
    return {
      timeLeftMs: Math.max(0, this.startAt + ROUND_MS - now),
      durationMs: ROUND_MS,
      exploded: this.exploded,
      players,
      pressedCount,
      total: this.players.length,
    };
  }

  // Oyuncuya özel: kendi basış süresini sadece KENDİSİ görür (sürpriz bozulmasın).
  getViewFor(playerId) {
    const v = this.getView();
    const s = this.state[playerId];
    v.you = {
      participant: !!s,
      pressed: s ? s.pressed : false,
      pressSec: s && s.pressed ? this._pressSec(s.pressMs) : null,
      late: s ? s.late : false, // patlamadan sonra bastıysa (0 puan)
    };
    return v;
  }

  finish() {
    if (this._done) return;
    this._done = true;
    this.stop();
    const scores = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      // Patlamadan ÖNCE basan puanını alır; geç basan ya da hiç basmayan = 0.
      scores[p.id] = s.pressed && !s.late ? this._pressSec(s.pressMs) : 0;
    }
    this.ctx.end(scores);
  }

  stop() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
  }
}
