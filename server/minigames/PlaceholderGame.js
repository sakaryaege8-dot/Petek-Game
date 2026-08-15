import Minigame from './Minigame.js';

// GEÇİCİ placeholder minigame.
// Amaç: gerçek minigame'ler yazılmadan önce tüm oyun döngüsünü uçtan uca test
// edebilmek. Her oyuncu "Skor Üret!" butonuna basar, kendisine rastgele bir skor
// düşer. Herkes bastığında (ya da güvenlik zamanlayıcısı dolduğunda) round biter.
export default class PlaceholderGame extends Minigame {
  static id = 'placeholder';
  static displayName = 'Placeholder (Rastgele Skor)';

  start() {
    this.scores = {};
    this.pending = new Set(); // henüz skor üretmemiş oyuncular
    for (const p of this.players) {
      this.scores[p.id] = 0;
      this.pending.add(p.id);
    }
    // Güvenlik: kimse basmazsa 45 sn sonra mevcut skorlarla bitir (oyun kilitlenmesin).
    this.timer = setTimeout(() => this.finish(), 45000);
  }

  handleInput(playerId, input) {
    if (!this.pending.has(playerId)) return; // zaten bastı ya da katılımcı değil
    if (input && input.type === 'roll') {
      this.scores[playerId] = 1 + Math.floor(this.ctx.random() * 100);
      this.pending.delete(playerId);
      this.ctx.broadcastView();
      if (this.pending.size === 0) this.finish();
    }
  }

  onPlayerLeave(playerId) {
    // Düşen oyuncunun MEVCUT skoru korunur; sadece onu beklemeyi bırakırız.
    this.pending.delete(playerId);
    if (this.pending.size === 0) this.finish();
  }

  getView() {
    return {
      prompt: 'Butona bas, sana rastgele bir skor düşsün!',
      players: this.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        submitted: !this.pending.has(p.id),
        score: this.scores[p.id] ?? 0,
      })),
    };
  }

  finish() {
    if (this._done) return; // çift bitişi önle
    this._done = true;
    this.ctx.end({ ...this.scores });
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
