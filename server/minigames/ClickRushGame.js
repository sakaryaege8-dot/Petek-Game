import Minigame from './Minigame.js';

// Tık Yarışı.
// Her oyuncunun kendi ekranı/butonu/skoru var (bağımsız). Buton her tıkta rastgele
// yeni bir konuma zıplar. 30 sn boyunca rastgele aralıklarla modifier'lar tetiklenir:
// ALTIN (+5), STOP (her tık -3), SAHTE butonlar (sahteye tık -2).
//
// Server-authoritative: buton konumu, modifier state'i ve hedef id'leri tamamen
// server'da. Client sadece TIKLADIĞI öğenin server'dan gelen id'sini yollar; server
// güncel state'e göre doğrular (hile önlenebilir; eski/uydurma id'ler yok sayılır).
//
// Ayar için tek config objesi (sıklık, süre, puanlar burada):
const CONFIG = {
  roundMs: 30000,
  tickMs: 100, // modifier zamanlaması hassasiyeti
  points: { normal: 1, gold: 5, decoy: -2, stopViolation: -3 },
  normalGapMs: [1200, 2600], // normal dönem: bir sonraki modifier'a kadar rastgele aralık
  gold: { durationMs: 1300 }, // altın buton kısa görünür
  stop: { durationMs: 2500 },
  decoy: { durationMs: 3000, countMin: 2, countMax: 3 },
  posMin: 10, // buton konumu yüzde aralığı (arena içinde kalsın)
  posMax: 90,
  modifiers: ['gold', 'stop', 'decoy'], // eşit ağırlıkla seçilir
};

export default class ClickRushGame extends Minigame {
  static id = 'click-rush';
  static displayName = 'Tık Yarışı';

  start() {
    this.cfg = CONFIG;
    const now = Date.now();
    this.endsAt = now + this.cfg.roundMs;
    this.state = {};
    for (const p of this.players) {
      const s = {
        score: 0,
        mode: 'normal',
        target: null,
        decoys: [],
        seq: 0, // her puan değişiminde artar (client flash için)
        lastDelta: 0,
        nextId: 1,
        modeExpiry: 0,
        nextTriggerAt: 0,
        left: false,
      };
      this._toNormal(s);
      s.nextTriggerAt = now + this._rand(this.cfg.normalGapMs[0], this.cfg.normalGapMs[1]);
      this.state[p.id] = s;
    }
    this._lastSecond = Math.ceil(this.cfg.roundMs / 1000);
    this.timer = setTimeout(() => this.finish(), this.cfg.roundMs);
    this.tick = setInterval(() => this._onTick(), this.cfg.tickMs);
  }

  _rand(min, max) {
    return min + this.ctx.random() * (max - min);
  }
  _randInt(min, max) {
    return Math.floor(this._rand(min, max + 1));
  }
  _pos() {
    return { x: Math.round(this._rand(this.cfg.posMin, this.cfg.posMax)), y: Math.round(this._rand(this.cfg.posMin, this.cfg.posMax)) };
  }

  // Not: _toNormal nextTriggerAt'ı AYARLAMAZ; her çağıran ayrıca ayarlar.
  _toNormal(s) {
    s.mode = 'normal';
    s.decoys = [];
    const { x, y } = this._pos();
    s.target = { id: s.nextId++, x, y, kind: 'normal' };
    s.modeExpiry = 0;
  }

  _enterModifier(s, kind, now) {
    if (kind === 'gold') {
      const { x, y } = this._pos();
      s.mode = 'gold';
      s.decoys = [];
      s.target = { id: s.nextId++, x, y, kind: 'gold' };
      s.modeExpiry = now + this.cfg.gold.durationMs;
    } else if (kind === 'stop') {
      s.mode = 'stop';
      s.decoys = [];
      s.target = null; // STOP sırasında buton yok; her tık ceza
      s.modeExpiry = now + this.cfg.stop.durationMs;
    } else if (kind === 'decoy') {
      s.mode = 'decoy';
      const { x, y } = this._pos();
      s.target = { id: s.nextId++, x, y, kind: 'normal' };
      const n = this._randInt(this.cfg.decoy.countMin, this.cfg.decoy.countMax);
      s.decoys = [];
      for (let i = 0; i < n; i++) {
        const pp = this._pos();
        s.decoys.push({ id: s.nextId++, x: pp.x, y: pp.y });
      }
      s.modeExpiry = now + this.cfg.decoy.durationMs;
    }
  }

  _onTick() {
    const now = Date.now();
    let changed = false;
    for (const p of this.players) {
      const s = this.state[p.id];
      if (s.left) continue;
      if (s.mode === 'normal') {
        if (now >= s.nextTriggerAt) {
          const kind = this.cfg.modifiers[Math.floor(this.ctx.random() * this.cfg.modifiers.length)];
          this._enterModifier(s, kind, now);
          changed = true;
        }
      } else if (now >= s.modeExpiry) {
        this._toNormal(s);
        s.nextTriggerAt = now + this._rand(this.cfg.normalGapMs[0], this.cfg.normalGapMs[1]);
        changed = true;
      }
    }
    // Bir şey değiştiyse ya da geri sayım saniyesi değiştiyse yayın yap (aşırı yayını önler).
    const sec = Math.max(0, Math.ceil((this.endsAt - now) / 1000));
    if (changed || sec !== this._lastSecond) {
      this._lastSecond = sec;
      this.ctx.broadcastView();
    }
  }

  handleInput(playerId, input) {
    const s = this.state[playerId];
    if (!s || !input || Date.now() >= this.endsAt) return;
    const now = Date.now();

    let delta;
    if (s.mode === 'stop') {
      delta = this.cfg.points.stopViolation; // STOP: yapılan HER tık -3
    } else if (s.mode === 'gold') {
      if (s.target && input.id === s.target.id) {
        delta = this.cfg.points.gold; // +5
        this._toNormal(s);
        s.nextTriggerAt = now + this._rand(this.cfg.normalGapMs[0], this.cfg.normalGapMs[1]);
      } else {
        return; // boşa/eski tık: etkisiz
      }
    } else if (s.mode === 'decoy') {
      if (s.target && input.id === s.target.id) {
        delta = this.cfg.points.normal; // gerçek: +1, buton zıplar, sahteler kalır
        const { x, y } = this._pos();
        s.target = { id: s.nextId++, x, y, kind: 'normal' };
      } else if (s.decoys.some((d) => d.id === input.id)) {
        delta = this.cfg.points.decoy; // sahte: -2
      } else {
        return;
      }
    } else {
      // normal
      if (s.target && input.id === s.target.id) {
        delta = this.cfg.points.normal; // +1, buton zıplar
        const { x, y } = this._pos();
        s.target = { id: s.nextId++, x, y, kind: 'normal' };
      } else {
        return; // eski id (çift sayım) veya boşa tık: etkisiz
      }
    }

    s.score += delta; // negatife düşebilir (alt sınır yok)
    s.lastDelta = delta;
    s.seq += 1;
    this.ctx.broadcastView();
  }

  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (s) s.left = true; // skoru korunur; artık modifier işlenmez
  }

  getView() {
    const timeLeftMs = Math.max(0, this.endsAt - Date.now());
    const players = {};
    for (const p of this.players) {
      const s = this.state[p.id];
      players[p.id] = {
        nickname: p.nickname,
        score: s.score,
        mode: s.mode,
        target: s.target ? { id: s.target.id, x: s.target.x, y: s.target.y, kind: s.target.kind } : null,
        decoys: s.decoys.map((d) => ({ id: d.id, x: d.x, y: d.y })),
        seq: s.seq,
        lastDelta: s.lastDelta,
      };
    }
    return { durationMs: this.cfg.roundMs, timeLeftMs, points: this.cfg.points, players };
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
  }
}
