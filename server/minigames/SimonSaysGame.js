import Minigame from './Minigame.js';

// Simon Says (Simon Diyor) — setteki TEK gerçek SENKRON multiplayer oyun.
// Diğer 4 minigame'de herkes bağımsız/kendi hızında oynuyordu. Burada server
// herkese AYNI ANDA aynı sequence'i gösterir, aynı anda cevap fazına geçirir,
// elenme durumunu canlı yayınlar. Bütün zamanlama (gösterim adımları + 5 sn
// cevap penceresi) SERVER'DA yönetilir; client "süre bitti / doğru yaptım"
// gibi hiçbir karar vermez (hile açığı kapalı). Client sadece bastığı rengin
// index'ini yollar ve server'ın yaydığı görüntüyü çizer.
//
// AKIŞ (server-authoritative durum makinesi):
//   showing  -> sequence renk renk yanıp söner (tıklama kapalı, herkes izler)
//   input    -> herkes AYNI ANDA 5 sn içinde sequence'i doğru sırayla tıklar
//   resolved -> kim geçti / kim elendi kısa süre gösterilir, sonra bir sonraki
//               seviye (sequence 1 uzar) ya da oyun biter
//
// SEVİYE UZUNLUĞU: seviye 1 = 3 renk, her seviye +1 (klasik Simon: dizi büyür).
//
// ELENME: bir seviyede yanlış renk VEYA süre yetişmezse (sequence'i bitiremezse)
// oyuncu elenir; kalan seviyeleri spectator olarak izler. Tek kişi kalınca (ya
// da solo'da oyuncu hata yapınca) minigame biter.
//
// SKOR: rawScore = "kaç seviye hayatta kalındı" (levelsCleared). Daha geç elenen
// daha yüksek. Aynı seviyede birlikte elenenler eşit skor alır -> Room'un
// tie-aware sıralaması beraberliği zaten paylaştırır (ona dokunulmuyor).
//   - Aynı seviyede HERKES elenirse (0 hayatta kalan): hepsi bir önceki seviyeyi
//     geçmiş sayılır (levelsCleared eşit) -> berabere paylaşırlar.
const COLORS = 4;              // 4 renk/buton (kırmızı, mavi, yeşil, sarı)
const START_LEN = 3;           // ilk seviyenin sequence uzunluğu
const LEAD_MS = 800;           // gösterim başlamadan önce "izle" molası
const LIT_MS = 460;            // bir rengin yandığı süre
const GAP_MS = 300;            // iki renk arası boşluk
const INPUT_MS = 5000;         // cevap penceresi (her seviye)
const RESOLVE_PAUSE_MS = 2100; // "sonuçlar" ekranının gösterim süresi
const MAX_LEVEL = 25;          // güvenlik tavanı (özellikle solo'da sonsuz döngü olmasın)
const TICK_MS = 250;           // cevap fazı geri sayım yayını

export default class SimonSaysGame extends Minigame {
  static id = 'simon-says';
  static displayName = 'Simon Diyor';

  start() {
    this._timers = [];   // tüm setTimeout handle'ları (stop'ta temizlenir)
    this._tick = null;   // cevap fazı geri sayım interval'ı
    this._done = false;
    // Solo test: tek katılımcıysa elenecek rakip yok; oyuncu HATA YAPANA kadar
    // oynansın (her geçtiği seviye skorunu artırır). 2+ oyuncuda son ayakta kalan kazanır.
    this.soloMode = this.players.length <= 1;

    this.state = {};
    for (const p of this.players) {
      this.state[p.id] = {
        nickname: p.nickname,
        alive: true,
        left: false,
        levelsCleared: 0,        // rawScore kaynağı
        eliminatedAtLevel: null, // gösterim için
        status: 'entering',      // 'entering' | 'correct' | 'wrong'  (o seviye içindeki durum)
        progress: 0,             // o seviyede doğru girilen renk sayısı
      };
    }

    // İlk seviyenin sequence'i (sonraki seviyelerde sona 1 renk eklenir).
    this.sequence = Array.from({ length: START_LEN }, () => this._rand());
    this.level = 0;
    this.phase = 'showing';
    this.flash = null; // showing sırasında o an yanan renk index'i (0..3) ya da null
    this._startLevel();
  }

  _rand() {
    return Math.floor(this.ctx.random() * COLORS);
  }

  _alivePresent() {
    // Hâlâ oyunda VE bağlantısı kopmamış oyuncular (oyunu ilerleten küme).
    return this.players.filter((p) => {
      const s = this.state[p.id];
      return s.alive && !s.left;
    });
  }

  // ---------- seviye başlangıcı + gösterim ----------
  _startLevel() {
    if (this._done) return;
    // Herkes ayrıldıysa (ör. bağlantı koptu) boşuna gösterme; bitir.
    if (this._alivePresent().length === 0) return this._finish();

    this.level += 1;
    if (this.level > 1) this.sequence.push(this._rand()); // dizi 1 uzar
    if (this.level > MAX_LEVEL) return this._finish();

    // Hayatta kalanların seviye-içi durumunu sıfırla.
    for (const p of this.players) {
      const s = this.state[p.id];
      if (s.alive && !s.left) {
        s.status = 'entering';
        s.progress = 0;
      }
    }

    this.phase = 'showing';
    this.flash = null;
    this.ctx.broadcastView(); // "Seviye L — izle" ekranı

    this._runShow();
  }

  _runShow() {
    // Gösterim kareleri: her renk için [yanık, boşluk]. Başta bir "izle" molası.
    const frames = [{ c: null, ms: LEAD_MS }];
    for (const c of this.sequence) {
      frames.push({ c, ms: LIT_MS });
      frames.push({ c: null, ms: GAP_MS });
    }
    const step = (i) => {
      if (this._done) return;
      if (i >= frames.length) return this._startInput();
      this.flash = frames[i].c;
      this.ctx.broadcastView();
      this._timers.push(setTimeout(() => step(i + 1), frames[i].ms));
    };
    step(0);
  }

  // ---------- cevap fazı ----------
  _startInput() {
    if (this._done) return;
    this.phase = 'input';
    this.flash = null;
    this.inputEndsAt = Date.now() + INPUT_MS;
    this._lastSecond = Math.ceil(INPUT_MS / 1000);
    // Server-side süre kontrolü (client'a güvenmiyoruz).
    this._timers.push(setTimeout(() => this._resolveLevel(), INPUT_MS));
    // Geri sayımın client'ta akması için periyodik yayın.
    this._tick = setInterval(() => {
      const sec = Math.max(0, Math.ceil((this.inputEndsAt - Date.now()) / 1000));
      if (sec !== this._lastSecond) { this._lastSecond = sec; this.ctx.broadcastView(); }
    }, TICK_MS);
    this.ctx.broadcastView();
  }

  handleInput(playerId, input) {
    if (this._done || this.phase !== 'input') return;
    const s = this.state[playerId];
    if (!s || !s.alive || s.left || s.status !== 'entering') return;
    if (!input || typeof input.index !== 'number' || input.index < 0 || input.index >= COLORS) return;

    const expected = this.sequence[s.progress];
    if (input.index === expected) {
      s.progress += 1;
      if (s.progress === this.sequence.length) s.status = 'correct'; // sequence'i bitirdi
    } else {
      s.status = 'wrong'; // tek yanlış = bu seviyede başarısız
    }
    this.ctx.broadcastView(); // durum değişti -> herkes (elenenler dahil) anında görsün
    this._maybeResolveEarly();
  }

  _maybeResolveEarly() {
    // Hayatta kalan herkes ya bitirdi (correct) ya da hata yaptı (wrong) ise
    // 5 sn'yi beklemeye gerek yok — hemen çöz.
    const present = this._alivePresent();
    if (present.every((p) => this.state[p.id].status !== 'entering')) this._resolveLevel();
  }

  _resolveLevel() {
    if (this._done || this.phase !== 'input') return; // çift çağrıya karşı
    this.phase = 'resolved';
    if (this._tick) { clearInterval(this._tick); this._tick = null; }

    // Sonuçları uygula: 'correct' hayatta kalır ve seviyeyi geçer; 'wrong' ya da
    // süreye yetişemeyen ('entering' kalmış) elenir (levelsCleared aynı kalır).
    for (const p of this.players) {
      const s = this.state[p.id];
      if (!s.alive || s.left) continue;
      if (s.status === 'correct') {
        s.levelsCleared = this.level;
      } else {
        s.alive = false;
        s.eliminatedAtLevel = this.level;
      }
    }

    this.ctx.broadcastView(); // kim geçti / kim elendi (ELENDİN) canlı görünsün

    const survivors = this._alivePresent().length;
    const ended = this.soloMode ? survivors === 0 : survivors <= 1;

    if (ended || this.level >= MAX_LEVEL) {
      this._timers.push(setTimeout(() => this._finish(), RESOLVE_PAUSE_MS));
    } else {
      this._timers.push(setTimeout(() => this._startLevel(), RESOLVE_PAUSE_MS));
    }
  }

  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (!s || s.left) return;
    // Bağlantı koptu: beklenmez. Mevcut levelsCleared'ı KORUNUR (skoru kalsın).
    s.left = true;
    s.alive = false;
    if (this.phase === 'input') this._maybeResolveEarly();
    else this.ctx.broadcastView();
  }

  getView() {
    const inputTimeLeftMs =
      this.phase === 'input' ? Math.max(0, this.inputEndsAt - Date.now()) : 0;
    const players = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      players[p.id] = {
        nickname: s.nickname,
        alive: s.alive,
        left: s.left,
        status: s.status,
        progress: s.progress,
        levelsCleared: s.levelsCleared,
        eliminatedAtLevel: s.eliminatedAtLevel,
      };
    }
    return {
      colors: COLORS,
      phase: this.phase,             // 'showing' | 'input' | 'resolved'
      level: this.level,
      sequenceLength: this.sequence.length,
      flash: this.phase === 'showing' ? this.flash : null, // o an yanan renk (0..3) ya da null
      inputTimeLeftMs,
      inputMs: INPUT_MS,
      aliveCount: this._alivePresent().length,
      soloMode: this.soloMode,
      players,
    };
  }

  _finish() {
    if (this._done) return;
    this._done = true;
    this.stop();
    const scores = {};
    for (const p of this.players) scores[p.id] = this.state[p.id].levelsCleared;
    this.ctx.end(scores);
  }

  stop() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
  }
}
