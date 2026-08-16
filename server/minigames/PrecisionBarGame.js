import Minigame from './Minigame.js';

// Hassas Duruş — precision timing.
// Ekranda yatay bir bar var; dıştan içe DARALAN, iç içe bölmelerden oluşuyor
// (dart hedefi gibi ama yatay). İnce bir çizgi bar üzerinde ping-pong yapar;
// oyuncu DURDUR'a basınca çizgi hangi bölmede durduysa o kadar puan alır. Her
// deneme yeni RASTGELE hızla başlar (oyuncu ritmi ezberleyemesin). 30 sn boyunca
// sınırsız deneme; her denemenin puanı toplam skora eklenir. Herkes kendi barında
// bağımsız oynar.
//
// SERVER-AUTHORITATIVE: çizginin pozisyonu HER ZAMAN zaman-bazlı hesaplanır
// (moveStartAt + speed). Oyuncu "stop" yolladığında server, input'un GELDİĞİ andaki
// gerçek pozisyonu kendi saatiyle hesaplayıp puanı verir; client'ın gönderdiği
// pozisyona ASLA güvenmez (client yalnızca görsel animasyon için kendi tahminini
// çizer). Böylece "tam ortaya bastım" hilesi mümkün değil.
const ROUND_MS = 30000;      // sabit round süresi
const RESULT_PAUSE_MS = 700; // durdurma sonrası sonuç gösterimi, sonra yeni deneme
const TICK_MS = 1000;        // geri sayım + animasyon senkron tazeleme yayını

// Hız değişkenliği: çoğu deneme normal aralıkta, ama FAST_CHANCE olasılıkla çok
// daha HIZLI bir deneme gelir (oyuncu ritmi ezberleyemesin, bazen zorlansın).
const SPEED_MIN = 0.7;       // bar-fraction / saniye (yavaş uç)
const SPEED_MAX = 1.9;       // normal hızlı uç -> tek yön ~0.53s
const FAST_CHANCE = 0.28;    // "çok hızlı" deneme olasılığı
const FAST_MIN = 2.5;        // çok hızlı aralık
const FAST_MAX = 4.0;        // -> tek yön ~0.25s (merkezi tutturmak çok zor)

// Bölmeler DIŞTAN İÇE (4 kutu). `half` = bölmenin barın BİR yanında kapladığı
// genişlik (bar fraction; merkez tek, iki yana simetrik). half'lerin toplamı 0.50.
// TAM genişlik = 2*half: dış %50, sonraki %30, sonraki %15, merkez %5.
// Zorluk ayarı için SADECE bu tabloyu değiştir (toplam 0.5 kalsın).
const BANDS = [
  { points: 0, half: 0.25, color: '#3a3d52' },  // dış  - %50 - gri (ıska, 0 puan)
  { points: 1, half: 0.15, color: '#3d6a86' },  // %30  - mavi
  { points: 3, half: 0.075, color: '#e08a2e' }, // %15  - turuncu
  { points: 5, half: 0.025, color: '#e23b4e' }, // merkez - %5 - kırmızı (en değerli, en dar)
];

export default class PrecisionBarGame extends Minigame {
  static id = 'precision-bar';
  static displayName = 'Hassas Duruş';

  start() {
    this._done = false;
    this._timers = []; // bekleyen "yeni deneme" zamanlayıcıları (stop'ta temizlenir)
    this.segments = this._buildSegments(); // client'ın çizeceği bar bölmeleri (statik)

    this.state = {};
    for (const p of this.players) {
      this.state[p.id] = {
        nickname: p.nickname,
        score: 0,
        attempts: 0,
        left: false,
        phase: 'moving',   // 'moving' | 'result'
        moveStartAt: 0,
        speed: 0,
        lastPos: null,     // en son durulan pozisyon (0..1)
        lastPoints: 0,
        lastTier: -1,
        resumeTimer: null,
      };
    }

    this.endsAt = Date.now() + ROUND_MS;
    this._lastSecond = Math.ceil(ROUND_MS / 1000);
    for (const p of this.players) this._startAttempt(p.id, false);

    this.timer = setTimeout(() => this.finish(), ROUND_MS);
    this.tick = setInterval(() => {
      const sec = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
      if (sec !== this._lastSecond) { this._lastSecond = sec; this.ctx.broadcastView(); }
    }, TICK_MS);
    this.ctx.broadcastView();
  }

  // Bir oyuncu için yeni deneme başlat: çizgiyi sıfırla, yeni rastgele hız ver.
  _startAttempt(playerId, broadcast = true) {
    const s = this.state[playerId];
    if (!s || s.left || this._done || Date.now() >= this.endsAt) return;
    s.phase = 'moving';
    s.moveStartAt = Date.now();
    s.speed = this._randomSpeed();
    s.resumeTimer = null;
    if (broadcast) this.ctx.broadcastView();
  }

  // Değişken hız: %(FAST_CHANCE) olasılıkla "çok hızlı" deneme, aksi halde normal.
  _randomSpeed() {
    if (this.ctx.random() < FAST_CHANCE) {
      return FAST_MIN + this.ctx.random() * (FAST_MAX - FAST_MIN);
    }
    return SPEED_MIN + this.ctx.random() * (SPEED_MAX - SPEED_MIN);
  }

  // Çizgi pozisyonu (0..1) = zaman-bazlı ping-pong (üçgen dalga).
  _posAt(s, now) {
    const t = (now - s.moveStartAt) / 1000; // saniye
    let ph = (s.speed * t) % 2;
    if (ph < 0) ph += 2;
    return ph <= 1 ? ph : 2 - ph;
  }

  // Pozisyonun puanı: merkeze uzaklığa göre bölme bul (içten dışa cumulative).
  _scoreAt(pos) {
    const d = Math.abs(pos - 0.5);
    let cum = 0;
    for (let i = BANDS.length - 1; i >= 0; i--) { // merkez (son) -> dış
      cum += BANDS[i].half;
      if (d < cum) return { points: BANDS[i].points, tier: i };
    }
    return { points: 0, tier: -1 }; // barın tam kenarı/dışı (garanti 0)
  }

  handleInput(playerId, input) {
    if (this._done || !input || input.type !== 'stop') return;
    const s = this.state[playerId];
    if (!s || s.left || s.phase !== 'moving') return; // sonuç gösterimindeyken durdurulamaz
    if (Date.now() >= this.endsAt) return;

    // Puan: input'un GELDİĞİ andaki server pozisyonu (client'a güvenmiyoruz).
    const pos = this._posAt(s, Date.now());
    const { points, tier } = this._scoreAt(pos);
    s.score += points;
    s.attempts += 1;
    s.lastPos = pos;
    s.lastPoints = points;
    s.lastTier = tier;
    s.phase = 'result';
    this.ctx.broadcastView();

    // Kısa sonuç gösterimi, sonra otomatik yeni deneme.
    s.resumeTimer = setTimeout(() => this._startAttempt(playerId, true), RESULT_PAUSE_MS);
    this._timers.push(s.resumeTimer);
  }

  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (!s || s.left) return;
    s.left = true; // skoru KORUNUR; yeni deneme başlatılmaz, beklenmez
    if (s.resumeTimer) { clearTimeout(s.resumeTimer); s.resumeTimer = null; }
  }

  getView() {
    const now = Date.now();
    const players = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      players[p.id] = {
        nickname: s.nickname,
        score: s.score,
        attempts: s.attempts,
        left: s.left,
        phase: s.phase,
        speed: s.speed,
        // Animasyon senkronu: client elapsedMs'i performance.now() ile ileri taşır.
        elapsedMs: s.phase === 'moving' ? now - s.moveStartAt : 0,
        linePos: s.phase === 'moving' ? this._posAt(s, now) : s.lastPos, // ilk kare için
        lastPos: s.lastPos,
        lastPoints: s.lastPoints,
        lastTier: s.lastTier,
      };
    }
    return {
      durationMs: ROUND_MS,
      timeLeftMs: Math.max(0, this.endsAt - now),
      segments: this.segments, // [{ startPct, widthPct, points, tier, color }] (sol->sağ)
      players,
    };
  }

  finish() {
    if (this._done) return;
    this._done = true;
    this.stop();
    const scores = {};
    for (const p of this.players) scores[p.id] = this.state[p.id].score;
    this.ctx.end(scores);
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    if (this.state) {
      for (const id in this.state) {
        const s = this.state[id];
        if (s.resumeTimer) { clearTimeout(s.resumeTimer); s.resumeTimer = null; }
      }
    }
  }

  // Bar bölmelerini sol->sağ, simetrik olarak kur (dış..merkez..dış).
  _buildSegments() {
    const segs = [];
    let x = 0;
    const push = (b, tier) => {
      segs.push({
        startPct: +(x * 100).toFixed(4),
        widthPct: +(b.half * 100).toFixed(4),
        points: b.points,
        tier,
        color: b.color,
      });
      x += b.half;
    };
    for (let i = 0; i < BANDS.length; i++) push(BANDS[i], i);            // sol: dış->merkez
    for (let i = BANDS.length - 1; i >= 0; i--) push(BANDS[i], i);       // sağ: merkez->dış
    return segs;
  }
}
