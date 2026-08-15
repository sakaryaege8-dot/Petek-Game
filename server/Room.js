import { randomUUID } from 'crypto';
import { awardPoints } from './scoring.js';
import { pickRandom } from './minigames/index.js';
import { CHARACTERS, isValidCharacter } from './characters.js';

// Solo test kolay olsun diye 1; gerçek oyunda 2+ önerilir.
const MIN_PLAYERS = 1;
// Bağlantı koptuktan sonra oyuncu bu süre boyunca odada tutulur (yeniden bağlanma için).
const DISCONNECT_GRACE_MS = 45000;

// Bir odanın TÜM oyun state'ini ve durum makinesini tutar (server-authoritative).
// phase: 'lobby' | 'playing' | 'roundResult' | 'gameOver'
export default class Room {
  constructor(code, io, onEmpty) {
    this.code = code;
    this.io = io;
    this.onEmpty = onEmpty; // oda tamamen boşalınca RoomManager'a haber ver
    this.phase = 'lobby';
    this.totalRounds = 3;
    this.currentRound = 0;
    this.hostId = null;
    this.players = new Map(); // playerId -> player
    this.lastMinigameId = null;
    this.currentMinigame = null;
    this.lastRoundResult = null;
    this._graceTimers = new Map(); // playerId -> timeout
    this._seq = 0; // katılım sırası (host devri ve listeleme için)
  }

  // ---------- oyuncu yönetimi ----------
  addPlayer(socketId, nickname) {
    const id = randomUUID();
    const isHost = this.players.size === 0;
    const player = {
      id,
      socketId,
      nickname,
      isHost,
      connected: true,
      ready: false,
      roundReady: false,
      totalScore: 0,
      characterId: null, // lobide seçilen avatar (null = seçilmedi)
      order: this._seq++,
    };
    if (isHost) this.hostId = id;
    this.players.set(id, player);
    return player;
  }

  findByNickname(nickname) {
    const key = nickname.trim().toLowerCase();
    for (const p of this.players.values()) {
      if (p.nickname.trim().toLowerCase() === key) return p;
    }
    return null;
  }

  reconnect(player, socketId) {
    player.socketId = socketId;
    player.connected = true;
    // Kopukken karakteri havuza dönmüştü; bu sırada başka BAĞLI oyuncu kaptıysa
    // seçimi düşür (ve hazır durumunu da), yeniden seçmesi gerekir.
    if (player.characterId && this._characterTaken(player.characterId, player.id)) {
      player.characterId = null;
      player.ready = false;
    }
    const t = this._graceTimers.get(player.id);
    if (t) {
      clearTimeout(t);
      this._graceTimers.delete(player.id);
    }
  }

  // Bir karakter BAŞKA bir bağlı oyuncu tarafından kullanılıyor mu?
  // (Kopan oyuncular sayılmaz -> karakter otomatik havuza döner.)
  _characterTaken(characterId, exceptPlayerId) {
    for (const o of this.players.values()) {
      if (o.id !== exceptPlayerId && o.connected && o.characterId === characterId) return true;
    }
    return false;
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  orderedPlayers() {
    return [...this.players.values()].sort((a, b) => a.order - b.order);
  }

  handleDisconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;

    // Round ortasında düştüyse: minigame haberdar olsun (beklemeyi bıraksın, skoru korusun).
    if (this.phase === 'playing' && this.currentMinigame) {
      this.currentMinigame.onPlayerLeave(playerId);
    }
    if (this.hostId === playerId) this.transferHost();

    // Grace timer: lobide isek süre sonunda oyuncuyu tamamen çıkar (hayalet kalmasın).
    // Oyun sırasında skoru korumak için oyuncu odada tutulur.
    const timer = setTimeout(() => {
      this._graceTimers.delete(playerId);
      const cur = this.players.get(playerId);
      if (cur && !cur.connected && this.phase === 'lobby') {
        this.players.delete(playerId);
        if (this.hostId === playerId) this.transferHost();
        this.broadcast();
      }
      this.checkEmpty();
    }, DISCONNECT_GRACE_MS);
    this._graceTimers.set(playerId, timer);

    // Düşen oyuncuyu bekleyen bir kapı varsa (lobi/round sonucu) şimdi ilerlet.
    this.checkReadyGates();
    if (!this.checkEmpty()) this.broadcast();
  }

  transferHost() {
    const next = this.orderedPlayers().find((p) => p.connected);
    this.hostId = next ? next.id : null;
    for (const p of this.players.values()) p.isHost = p.id === this.hostId;
  }

  // Bağlı oyuncu kalmadıysa odayı kapat. true dönerse oda yok edilmiştir.
  checkEmpty() {
    if (this.connectedPlayers().length > 0) return false;
    for (const t of this._graceTimers.values()) clearTimeout(t);
    this._graceTimers.clear();
    if (this.currentMinigame) {
      this.currentMinigame.stop();
      this.currentMinigame = null;
    }
    if (this.onEmpty) this.onEmpty(this.code);
    return true;
  }

  // ---------- lobi ----------
  setRounds(playerId, rounds) {
    if (playerId !== this.hostId || this.phase !== 'lobby') return;
    if (![3, 5, 7].includes(rounds)) return;
    this.totalRounds = rounds;
    this.broadcast();
  }

  setReady(playerId, ready) {
    if (this.phase !== 'lobby') return;
    const p = this.players.get(playerId);
    if (!p) return;
    const want = ready === undefined ? !p.ready : !!ready;
    // SUNUCU TARAFI KURAL: karakter seçmeden "hazır" olunamaz (client engelini
    // atlayıp sahte hazır göndermeyi de burada engelliyoruz).
    if (want && !p.characterId) return;
    p.ready = want;
    this.broadcast();
    this.checkReadyGates();
  }

  // Lobide karakter seç / değiştir / bırak. Aynı karakteri iki BAĞLI oyuncu alamaz.
  // Kendi seçili karakterine tekrar tıklamak seçimi bırakır (toggle) ve hazırı düşürür.
  selectCharacter(playerId, characterId) {
    if (this.phase !== 'lobby') return;
    const p = this.players.get(playerId);
    if (!p) return;

    // Bırakma: null ya da kendi seçili karakterine tekrar tıklama
    if (characterId === null || characterId === p.characterId) {
      p.characterId = null;
      p.ready = false; // karaktersiz hazır olunamaz
      this.broadcast();
      return;
    }

    if (!isValidCharacter(characterId)) return;
    if (this._characterTaken(characterId, playerId)) return; // başkası almış -> yok say
    p.characterId = characterId;
    this.broadcast();
  }

  setRoundReady(playerId, ready) {
    if (this.phase !== 'roundResult') return;
    const p = this.players.get(playerId);
    if (!p) return;
    p.roundReady = ready === undefined ? !p.roundReady : !!ready;
    this.broadcast();
    this.checkReadyGates();
  }

  checkReadyGates() {
    if (this.phase === 'lobby') this.maybeStartGame();
    else if (this.phase === 'roundResult') this.maybeAdvance();
  }

  maybeStartGame() {
    const conn = this.connectedPlayers();
    if (conn.length < MIN_PLAYERS) return;
    if (!conn.every((p) => p.ready)) return;
    this.startGame();
  }

  // ---------- oyun döngüsü ----------
  startGame() {
    for (const p of this.players.values()) {
      p.totalScore = 0;
      p.ready = false;
      p.roundReady = false;
    }
    this.currentRound = 0;
    this.lastMinigameId = null;
    this.lastRoundResult = null;
    this.startRound();
  }

  startRound() {
    this.currentRound++;
    const cls = pickRandom(this.lastMinigameId);
    this.lastMinigameId = cls.id;
    for (const p of this.players.values()) p.roundReady = false;

    // Katılımcılar round başındaki bağlı oyunculardır (round boyunca sabit).
    const participants = this.connectedPlayers().map((p) => ({ id: p.id, nickname: p.nickname }));
    const ctx = {
      players: participants,
      random: Math.random,
      broadcastView: () => this.broadcast(),
      end: (rawScores) => this.endRound(rawScores),
    };
    this.currentMinigame = new cls(ctx);
    this.phase = 'playing';
    this.currentMinigame.start();
    this.broadcast();
  }

  handleInput(playerId, input) {
    if (this.phase !== 'playing' || !this.currentMinigame) return;
    this.currentMinigame.handleInput(playerId, input);
  }

  endRound(rawScores) {
    if (this.phase !== 'playing') return; // çift çağrıya karşı koruma
    const mg = this.currentMinigame;
    if (mg) mg.stop();

    const ids = Object.keys(rawScores);
    const points = awardPoints(rawScores, ids);
    for (const id of ids) {
      const p = this.players.get(id);
      if (p) p.totalScore += points[id];
    }

    const ranking = ids
      .map((id) => ({
        playerId: id,
        nickname: this.players.get(id)?.nickname ?? '(ayrıldı)',
        rawScore: rawScores[id],
        points: points[id],
      }))
      .sort((a, b) => b.rawScore - a.rawScore);

    this.lastRoundResult = {
      round: this.currentRound,
      minigameId: mg ? mg.constructor.id : null,
      minigameName: mg ? mg.constructor.displayName : null,
      ranking,
    };
    this.currentMinigame = null;
    this.phase = 'roundResult';
    for (const p of this.players.values()) p.roundReady = false;
    this.broadcast();
  }

  maybeAdvance() {
    const conn = this.connectedPlayers();
    if (conn.length === 0) return;
    if (!conn.every((p) => p.roundReady)) return;
    if (this.currentRound < this.totalRounds) {
      this.startRound();
    } else {
      this.phase = 'gameOver';
      this.broadcast();
    }
  }

  returnToLobby(playerId) {
    if (playerId !== this.hostId || this.phase !== 'gameOver') return;
    this.phase = 'lobby';
    this.currentRound = 0;
    this.lastMinigameId = null;
    this.lastRoundResult = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.roundReady = false;
      p.totalScore = 0;
    }
    this.broadcast();
  }

  // ---------- state serialize ----------
  waitingFor() {
    if (this.phase === 'lobby')
      return this.connectedPlayers().filter((p) => !p.ready).map((p) => p.nickname);
    if (this.phase === 'roundResult')
      return this.connectedPlayers().filter((p) => !p.roundReady).map((p) => p.nickname);
    return [];
  }

  winners() {
    if (this.phase !== 'gameOver' || this.players.size === 0) return [];
    const scores = [...this.players.values()].map((p) => p.totalScore);
    const max = Math.max(...scores);
    return [...this.players.values()].filter((p) => p.totalScore === max).map((p) => p.nickname);
  }

  serialize() {
    return {
      code: this.code,
      phase: this.phase,
      totalRounds: this.totalRounds,
      currentRound: this.currentRound,
      hostId: this.hostId,
      characters: CHARACTERS, // seçilebilir karakter kataloğu (id, name, file)
      players: this.orderedPlayers().map((p) => ({
        id: p.id,
        nickname: p.nickname,
        isHost: p.id === this.hostId,
        connected: p.connected,
        ready: p.ready,
        roundReady: p.roundReady,
        totalScore: p.totalScore,
        characterId: p.characterId,
      })),
      minigame:
        this.phase === 'playing' && this.currentMinigame
          ? {
              id: this.currentMinigame.constructor.id,
              displayName: this.currentMinigame.constructor.displayName,
              view: this.currentMinigame.getView(),
            }
          : null,
      lastRoundResult:
        this.phase === 'roundResult' || this.phase === 'gameOver' ? this.lastRoundResult : null,
      waitingFor: this.waitingFor(),
      winners: this.winners(),
    };
  }

  broadcast() {
    this.io.to(this.code).emit('room:state', this.serialize());
  }
}
