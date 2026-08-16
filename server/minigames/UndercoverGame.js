import Minigame from './Minigame.js';
import { UNDERCOVER_WORDS } from './data/undercover-words.js';
import { foldTr } from './TypeRaceGame.js';

// Kelime Casusu — bir bluff / sosyal dedüksiyon oyunu.
// Diğer 5 minigame'den YAPISAL olarak farklı: turn-based (sıralı), oylama içeriyor,
// serbest METİN girişi var ve HER OYUNCUYA FARKLI görüntü gider (casus kelimeyi
// görmez). Bu son madde için Minigame kontratına opsiyonel bir getViewFor(playerId)
// ekledik; Room.broadcast() bu metod varsa görüntüyü her sokete ayrı yollar
// (böylece casusun kimliği/kelime hiçbir client'a sızmaz — server-authoritative).
//
// AKIŞ (kendi iç durum makinesi):
//   tooFew  -> <3 oyuncu: oyun anlamsız, kısa bilgi ekranı + herkese eşit puan (round atlanır)
//   reveal  -> herkes SADECE kendi rolünü görür (gizli kelime ya da "sen casussun")
//   clue    -> 3 tur boyunca SIRAYLA herkes temayla ilgili tek kelime yazar
//              (casus da yazmak zorunda; gizli kelimenin birebir aynısı reddedilir)
//   voting  -> herkes AYNI ANDA casus olduğunu düşündüğüne oy verir (kendine olmaz)
//   result  -> büyük reveal: casus kim, kim kime oy verdi, kim kazandı
//
// SKORLAMA (takım bazlı -> mevcut sıralama sistemine): kazanan tarafın HER üyesi
// yüksek raw (100), kaybeden tarafın HER üyesi düşük raw (20) alır. Room'un
// tie-aware sıralaması "kazananlar hep beraber üstte, kaybedenler hep beraber altta"
// olarak zaten doğru çevirir.
const LAPS = 3;              // her oyuncu kaç kelime söyler
const REVEAL_MS = 5000;     // rol gösterim süresi
const TURN_MS = 20000;      // bir oyuncunun düşünme/yazma süresi (dolunca otomatik kelime)
const VOTE_MS = 30000;      // oylama süresi
const RESULT_MS = 9000;     // reveal ekranının gösterim süresi
const TOOFEW_MS = 4500;     // <3 oyuncu bilgi ekranı süresi
const TICK_MS = 250;        // geri sayım yayını
const MIN_REAL = 3;         // gerçek oyun için minimum oyuncu
const WIN_SCORE = 100;
const LOSE_SCORE = 20;
const TIE_SCORE = 50;       // <3 oyuncu: herkes eşit
const MAX_WORD_LEN = 24;
// Süre dolunca otomatik gönderilen "takıldı" kelimeleri (rastgele biri seçilir).
const FILLER = ['şey', 'hmm', 'bilemedim', 'pas', 'boş', 'yok'];

// Karşılaştırma için normalize (Türkçe karakterleri katla, boşlukları sadeleştir).
function normalize(s) {
  return foldTr(String(s)).replace(/\s+/g, ' ').trim();
}

export default class UndercoverGame extends Minigame {
  static id = 'undercover';
  static displayName = 'Kelime Casusu';

  start() {
    this._timers = [];       // reveal/result/tooFew gibi tek-seferlik zamanlayıcılar
    this._turnTimer = null;  // aktif sıranın süre zamanlayıcısı
    this._voteTimer = null;  // oylama süre zamanlayıcısı
    this._tick = null;       // geri sayım yayın interval'ı
    this._done = false;

    this.order = this.players.map((p) => p.id); // sabit sıra
    this.nameById = {};
    for (const p of this.players) this.nameById[p.id] = p.nickname;

    this.state = {};
    for (const p of this.players) this.state[p.id] = { left: false, isSpy: false, notice: null };
    this.clues = [];   // { playerId, nickname, word, lap, auto }
    this.votes = {};   // voterId -> targetId
    this.result = null;
    this.secret = null;

    // <3 oyuncu: dedüksiyon anlamsız. Kısa bilgi + eşit puan (solo/2 kişilik testte kilitlenme yok).
    if (this.players.length < MIN_REAL) {
      this.phase = 'tooFew';
      this.ctx.broadcastView();
      this._timers.push(setTimeout(() => this._finishTie(), TOOFEW_MS));
      return;
    }

    // Gizli kelime + casus seç (casus asla client'a sızmaz; sadece result'ta reveal edilir).
    this.secret = UNDERCOVER_WORDS[Math.floor(this.ctx.random() * UNDERCOVER_WORDS.length)];
    this.secretNorm = normalize(this.secret);
    this.spyId = this.order[Math.floor(this.ctx.random() * this.order.length)];
    this.state[this.spyId].isSpy = true;

    // Sıra kuyruğu: LAPS tur boyunca order sırasıyla.
    this.turnQueue = [];
    for (let lap = 0; lap < LAPS; lap++) for (const id of this.order) this.turnQueue.push({ id, lap });
    this.turnCursor = 0;

    this.phase = 'reveal';
    this.ctx.broadcastView();
    this._timers.push(setTimeout(() => this._startClue(), REVEAL_MS));
  }

  // ---------- clue fazı (sıralı kelime) ----------
  _startClue() {
    if (this._done) return;
    this.phase = 'clue';
    this._startTick();
    this._beginTurnAtCursor();
  }

  _beginTurnAtCursor() {
    if (this._done) return;
    this._clearTurnTimer();
    // Kopmuş oyuncuların sırasını atla.
    while (this.turnCursor < this.turnQueue.length && this.state[this.turnQueue[this.turnCursor].id].left) {
      this.turnCursor++;
    }
    if (this.turnCursor >= this.turnQueue.length) return this._startVoting();
    this.turnEndsAt = Date.now() + TURN_MS;
    this._lastSecond = Math.ceil(TURN_MS / 1000);
    this._turnTimer = setTimeout(() => this._autoSubmit(), TURN_MS);
    this.ctx.broadcastView();
  }

  get _currentTurnId() {
    if (this.phase !== 'clue' || this.turnCursor >= this.turnQueue.length) return null;
    return this.turnQueue[this.turnCursor].id;
  }

  // Süre doldu: oyuncu takılıp kalmasın diye rastgele bir "takıldı" kelimesi gönder.
  _autoSubmit() {
    if (this._done || this.phase !== 'clue') return;
    const id = this._currentTurnId;
    if (id == null) return;
    const word = FILLER[Math.floor(this.ctx.random() * FILLER.length)];
    this._acceptClue(id, word, true);
  }

  _acceptClue(id, word, auto) {
    const entry = this.turnQueue[this.turnCursor];
    this.clues.push({ playerId: id, nickname: this.nameById[id], word, lap: entry.lap, auto: !!auto });
    this.state[id].notice = null;
    this.turnCursor++;
    this._beginTurnAtCursor();
  }

  // ---------- voting fazı ----------
  _startVoting() {
    if (this._done) return;
    this._clearTurnTimer();
    this.phase = 'voting';
    this.voteEndsAt = Date.now() + VOTE_MS;
    this._lastSecond = Math.ceil(VOTE_MS / 1000);
    this._startTick();
    this._voteTimer = setTimeout(() => this._resolve(), VOTE_MS);
    this.ctx.broadcastView();
  }

  _maybeResolveVotesEarly() {
    if (this.phase !== 'voting') return;
    // Bekleyeceğimiz oy verenler = kopmamış katılımcılar.
    const eligible = this.order.filter((id) => !this.state[id].left);
    if (eligible.length === 0 || eligible.every((id) => this.votes[id] != null)) this._resolve();
  }

  _resolve() {
    if (this._done || this.phase !== 'voting') return;
    if (this._voteTimer) { clearTimeout(this._voteTimer); this._voteTimer = null; }

    // Oyları say.
    const tally = {};
    for (const id of this.order) tally[id] = 0;
    for (const voter of Object.keys(this.votes)) {
      const t = this.votes[voter];
      if (t in tally) tally[t] += 1;
    }
    const totalVotes = Object.keys(this.votes).length;
    let accusedIds = [];
    if (totalVotes > 0) {
      const max = Math.max(...this.order.map((id) => tally[id]));
      if (max > 0) accusedIds = this.order.filter((id) => tally[id] === max);
    }

    // EN ÇOK oyu alan TEK kişi casus ise casus yakalanır; aksi halde (yanlış kişi
    // ya da oylamada eşitlik/oy yok) casus sıyrılır.
    const spyCaught = accusedIds.length === 1 && accusedIds[0] === this.spyId;
    const winnerIds = spyCaught ? this.order.filter((id) => id !== this.spyId) : [this.spyId];
    const winnerSet = new Set(winnerIds);

    const scores = {};
    for (const p of this.players) scores[p.id] = winnerSet.has(p.id) ? WIN_SCORE : LOSE_SCORE;
    this._pendingScores = scores;

    this.result = {
      spyId: this.spyId,
      spyNickname: this.nameById[this.spyId],
      secret: this.secret,
      votes: { ...this.votes }, // voterId -> targetId (reveal için)
      tally,
      accusedIds,
      spyCaught,
      winnerIds,
      winnerNames: winnerIds.map((id) => this.nameById[id]),
      reason: this._reason(accusedIds, spyCaught),
    };
    this.phase = 'result';
    this.ctx.broadcastView();
    this._timers.push(setTimeout(() => this._finish(this._pendingScores), RESULT_MS));
  }

  _reason(accusedIds, spyCaught) {
    if (accusedIds.length === 0) return 'Hiç oy çıkmadı — casus fark edilmedi.';
    if (accusedIds.length > 1) return 'Oylar eşit çıktı, net bir suçlama yok — casus sıyrıldı.';
    if (spyCaught) return 'En çok oyu casus aldı — yakalandı!';
    return 'Yanlış kişi suçlandı — casus sıyrıldı.';
  }

  // ---------- input (server-authoritative doğrulama) ----------
  handleInput(playerId, input) {
    if (this._done || !input) return;
    if (input.type === 'clue') return this._onClue(playerId, input.word);
    if (input.type === 'vote') return this._onVote(playerId, input.targetId);
  }

  _onClue(playerId, raw) {
    if (this.phase !== 'clue' || playerId !== this._currentTurnId) return; // sadece sırası gelen
    const s = this.state[playerId];
    if (!s || s.left || typeof raw !== 'string') return;
    const word = raw.trim().replace(/\s+/g, ' ');
    const setErr = (m) => { s.notice = m; this.ctx.broadcastView(); };
    if (!word || !/[\p{L}\p{N}]/u.test(word)) return setErr('Bir kelime yaz.');
    if (word.length > MAX_WORD_LEN) return setErr('Kelime çok uzun.');
    if (/\s/.test(word)) return setErr('Sadece TEK bir kelime yazabilirsin.');
    if (normalize(word) === this.secretNorm) return setErr('Gizli kelimeyi kullanamazsın! Başka bir kelime dene.');
    this._acceptClue(playerId, word, false);
  }

  _onVote(playerId, targetId) {
    if (this.phase !== 'voting') return;
    const s = this.state[playerId];
    if (!s || s.left) return;                 // kopan oy veremez
    if (typeof targetId !== 'string') return;
    if (targetId === playerId) return;        // kendine oy yok
    if (!this.state[targetId]) return;        // katılımcı olmalı
    this.votes[playerId] = targetId;          // fikir değiştirmeye izin var
    this.ctx.broadcastView();
    this._maybeResolveVotesEarly();
  }

  // ---------- bağlantı kopması ----------
  onPlayerLeave(playerId) {
    const s = this.state[playerId];
    if (!s || s.left) return;
    s.left = true;
    delete this.votes[playerId]; // varsa oyu düşsün
    if (this.phase === 'clue' && this._currentTurnId === playerId) {
      // Sırası gelen kişi koptu: bekleme, sırayı atla.
      this._clearTurnTimer();
      this.turnCursor += 1;
      this._beginTurnAtCursor();
      return;
    }
    if (this.phase === 'voting') {
      this.ctx.broadcastView();
      this._maybeResolveVotesEarly();
      return;
    }
    this.ctx.broadcastView();
  }

  // ---------- view'lar ----------
  // Herkese ORTAK, SIR İÇERMEYEN görüntü (secret/spyId yok — result hariç).
  getView() {
    const players = this.order.map((id) => ({ id, nickname: this.nameById[id], left: this.state[id].left }));
    const v = { variant: 'undercover', phase: this.phase, players, lapsTotal: LAPS, minPlayers: MIN_REAL };
    if (this.phase === 'tooFew') return v;
    if (this.phase === 'reveal') { v.revealMs = REVEAL_MS; return v; }
    if (this.phase === 'clue') {
      const cur = this._currentTurnId;
      v.clues = this._publicClues();
      v.currentTurn = cur ? { playerId: cur, nickname: this.nameById[cur] } : null;
      v.lap = this.turnCursor < this.turnQueue.length ? this.turnQueue[this.turnCursor].lap + 1 : LAPS;
      v.turnTimeLeftMs = Math.max(0, this.turnEndsAt - Date.now());
      v.turnMs = TURN_MS;
      return v;
    }
    if (this.phase === 'voting') {
      v.clues = this._publicClues();
      v.voteTimeLeftMs = Math.max(0, this.voteEndsAt - Date.now());
      v.voteMs = VOTE_MS;
      v.votedIds = Object.keys(this.votes); // kim oy verdi (kime verdiği GİZLİ)
      return v;
    }
    // result: her şey açık.
    v.clues = this._publicClues();
    v.result = this.result;
    return v;
  }

  // Oyuncuya ÖZEL görüntü: ortak view + sadece o oyuncunun göreceği gizli bilgiler.
  // Room.broadcast() bunu her sokete ayrı yollar -> casus/kelime sızmaz.
  getViewFor(playerId) {
    const v = this.getView();
    const s = this.state[playerId];
    v.you = {
      participant: !!s,
      isSpy: s ? s.isSpy : false,
      word: s && !s.isSpy ? (this.secret || null) : null, // casus kelimeyi ASLA almaz
      isYourTurn: this.phase === 'clue' && this._currentTurnId === playerId,
      notice: s ? s.notice : null,
      hasVoted: this.phase === 'voting' ? this.votes[playerId] != null : false,
      myVote: this.votes[playerId] || null,
    };
    return v;
  }

  _publicClues() {
    return this.clues.map((c) => ({ playerId: c.playerId, nickname: c.nickname, word: c.word, lap: c.lap, auto: c.auto }));
  }

  _finishTie() {
    const scores = {};
    for (const p of this.players) scores[p.id] = TIE_SCORE;
    this._finish(scores);
  }

  _finish(scores) {
    if (this._done) return;
    this._done = true;
    this.stop();
    this.ctx.end(scores);
  }

  // ---------- zamanlayıcı yardımcıları ----------
  _startTick() {
    if (this._tick) return;
    this._tick = setInterval(() => {
      if (this._done) return;
      let endsAt = null;
      if (this.phase === 'clue') endsAt = this.turnEndsAt;
      else if (this.phase === 'voting') endsAt = this.voteEndsAt;
      else return;
      const sec = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (sec !== this._lastSecond) { this._lastSecond = sec; this.ctx.broadcastView(); }
    }, TICK_MS);
  }

  _clearTurnTimer() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
  }

  stop() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    this._clearTurnTimer();
    if (this._voteTimer) { clearTimeout(this._voteTimer); this._voteTimer = null; }
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
  }
}
