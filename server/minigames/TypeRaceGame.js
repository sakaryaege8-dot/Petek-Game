import Minigame from './Minigame.js';
import { TURKISH_WORDS } from './data/turkish-words.js';

// Type Race.
// TÜM oyuncular AYNI kelime dizisini AYNI sırayla görür (round başında server'da bir
// kez üretilir). Herkes kendi hızında ilerler; skor = 30 sn'de tamamlanan kelime sayısı.
//
// Anti-hile / input yaklaşımı: her tuşu değil, KELİME TAMAMLANINCA bir doğrulama
// isteği gönderilir ({ typed }). Server, gönderilen metni o oyuncunun GÜNCEL beklenen
// kelimesiyle (normalize edilmiş) karşılaştırır; eşleşmezse hiçbir şey olmaz. Böylece
// client "bitirdim" deyip skor uyduramaz (gerçekten doğru harfleri üretmek zorunda).
// Tuş-tuş göndermek de belirli bir botu engellemez ama çok daha ağır olurdu; arkadaş
// ortamı için kelime-bazlı doğrulama makul denge. (Canlı yeşil/kırmızı harf geri
// bildirimi client'ta kozmetiktir; SKOR daima server doğrulamasıyla artar.)
const ROUND_MS = 30000;
const TICK_MS = 1000;
const LIST_LEN = 120; // 30 sn'de bitmeyecek kadar uzun kelime dizisi

// Türkçe karakter normalizasyonu (ı/i, ş/s, ç/c, ö/o, ü/u, ğ/g) — hepsi 1:1.
export function foldTr(s) {
  return String(s)
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/Ş/g, 's').replace(/ş/g, 's')
    .replace(/Ç/g, 'c').replace(/ç/g, 'c')
    .replace(/Ö/g, 'o').replace(/ö/g, 'o')
    .replace(/Ü/g, 'u').replace(/ü/g, 'u')
    .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    .toLowerCase();
}
function normalizeWord(s) {
  return foldTr(s).replace(/\s+/g, ''); // karşılaştırmada boşlukları yok say
}

export default class TypeRaceGame extends Minigame {
  static id = 'type-race';
  static displayName = 'Type Race';

  start() {
    // Round başında TEK bir kelime dizisi üret; herkese aynısı gider.
    this.words = [];
    for (let i = 0; i < LIST_LEN; i++) {
      let w;
      do {
        w = TURKISH_WORDS[Math.floor(this.ctx.random() * TURKISH_WORDS.length)];
      } while (i > 0 && w === this.words[i - 1]); // arka arkaya aynı kelime gelmesin
      this.words.push(w);
    }
    this.state = {};
    for (const p of this.players) this.state[p.id] = { index: 0, count: 0, left: false };
    this.endsAt = Date.now() + ROUND_MS;
    this._lastSecond = Math.ceil(ROUND_MS / 1000);
    this.timer = setTimeout(() => this.finish(), ROUND_MS);
    this.tick = setInterval(() => {
      const sec = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
      if (sec !== this._lastSecond) {
        this._lastSecond = sec;
        this.ctx.broadcastView(); // geri sayımı akıt
      }
    }, TICK_MS);
  }

  handleInput(playerId, input) {
    const s = this.state[playerId];
    if (!s || !input || Date.now() >= this.endsAt) return;
    if (typeof input.typed !== 'string') return;
    const expected = this.words[s.index];
    // Server-authoritative doğrulama: gönderilen metin güncel beklenen kelimeye eşit mi?
    if (expected && normalizeWord(input.typed) === normalizeWord(expected)) {
      s.count += 1;
      s.index += 1;
      this.ctx.broadcastView();
    }
    // Eşleşmezse skor değişmez (uydurma engellenir).
  }

  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (s) s.left = true; // count korunur
  }

  getView() {
    const timeLeftMs = Math.max(0, this.endsAt - Date.now());
    const players = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      players[p.id] = {
        nickname: p.nickname,
        count: s.count,
        word: this.words[s.index] || '', // güncel kelime (doğru Türkçe yazımıyla)
        next: [this.words[s.index + 1] || '', this.words[s.index + 2] || ''], // sıradaki 1-2 (soluk)
      };
    }
    return { durationMs: ROUND_MS, timeLeftMs, players };
  }

  finish() {
    if (this._done) return;
    this._done = true;
    this.stop();
    const scores = {};
    for (const p of this.players) scores[p.id] = this.state[p.id].count;
    this.ctx.end(scores);
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
  }
}
