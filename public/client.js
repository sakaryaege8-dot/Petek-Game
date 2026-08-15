/* global io */
// Client TAMAMEN server-authoritative çalışır: sadece input yollar ve
// server'dan gelen 'room:state' anlık görüntüsünü çizer. Hiç oyun mantığı yok.

const socket = io();
let myId = null;
let myRoom = null;
let currentState = null; // en son alınan room:state (klavye dinleyicisi için)
let arrowRushLastSeq = -1; // Ok Tuşu Yarışı: son gösterilen input sırası (flash için)
let clickRushLastSeq = -1; // Tık Yarışı: son gösterilen input sırası (flash için)
let typeRaceMounted = false; // Type Race: shell çizildi mi (input'u korumak için yerinde güncelleme)
let typeRaceValue = ''; // Type Race: o an yazılan metin (yeniden çizimlerde kaynak-doğru)

const $ = (sel) => document.querySelector(sel);
const homeEl = $('#home');
const gameEl = $('#game');
const homeError = $('#homeError');

// ---------- ana ekran (oda kur / katıl) ----------
$('#createBtn').onclick = () => {
  const nickname = $('#nickname').value.trim();
  if (!nickname) return showHomeError('Önce takma ad gir.');
  socket.emit('room:create', { nickname });
};
$('#joinBtn').onclick = () => {
  const nickname = $('#nickname').value.trim();
  const roomCode = $('#roomCode').value.trim().toUpperCase();
  if (!nickname) return showHomeError('Önce takma ad gir.');
  if (!roomCode) return showHomeError('Oda kodu gir.');
  socket.emit('room:join', { roomCode, nickname });
};
function showHomeError(m) {
  homeError.textContent = m;
}

// ---------- socket olayları ----------
socket.on('room:error', ({ message }) => showHomeError(message));

socket.on('room:joined', ({ playerId, roomCode }) => {
  myId = playerId;
  myRoom = roomCode;
  homeError.textContent = '';
  homeEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
});

socket.on('room:state', render);

// Bağlantı kopup geri gelirse aynı oda + takma adla yeniden bağlan (server slotu geri verir).
socket.on('connect', () => {
  if (myRoom) {
    const nickname = $('#nickname').value.trim();
    if (nickname) socket.emit('room:join', { roomCode: myRoom, nickname });
  }
});

function send(type, payload) {
  socket.emit(type, payload);
}

// Ok Tuşu Yarışı klavye girişi: sadece o minigame aktifken ok tuşlarını yolla.
const ARROW_KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
document.addEventListener('keydown', (e) => {
  const s = currentState;
  if (!s || s.phase !== 'playing' || !s.minigame || s.minigame.id !== 'arrow-rush') return;
  const dir = ARROW_KEYMAP[e.key];
  if (!dir) return;
  e.preventDefault(); // sayfanın kaymasını engelle
  send('game:input', { key: dir });
});

// Hızlı-tıklama minigame'lerinde tık DELEGASYONU + 'pointerdown' (önemli):
// Her broadcast tüm #game içeriğini innerHTML ile yeniden çiziyor. 'click' olayı
// mousedown+mouseup ister; arada (geri sayım/broadcast) yeniden-çizim butonu yok
// ederse tarayıcı click'i üst elemana ateşler -> closest('.ns-num') null döner ->
// tık KAÇAR (tek basışta olmaz, hızlı basınca durağan ana denk gelince olur).
// Çözüm: 'pointerdown' basış anında, o an var olan gerçek butonda anında ateşlenir;
// mouseup beklemediği için yeniden-çizim onu bozamaz. Tıkları stabil parent (#game)
// üzerinde yakalıyoruz.
gameEl.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return; // sağ tık sayılmasın
  const s = currentState;
  if (!s || s.phase !== 'playing' || !s.minigame) return;
  const mgId = s.minigame.id;
  if (mgId === 'click-rush') {
    const me = s.minigame.view.players[myId];
    if (me && me.mode === 'stop') {
      if (e.target.closest('#crArena')) send('game:input', { id: null }); // STOP: her tık ceza
      return;
    }
    const btn = e.target.closest('.cr-btn');
    if (btn) send('game:input', { id: Number(btn.dataset.id) });
  } else if (mgId === 'arrow-rush') {
    const pad = e.target.closest('.ar-pad');
    if (pad) send('game:input', { key: pad.dataset.dir });
  } else if (mgId === 'number-sort') {
    const btn = e.target.closest('.ns-num');
    if (!btn || btn.disabled) return;
    const num = Number(btn.dataset.num);
    const me = s.minigame.view.players[myId];
    send('game:input', { num }); // server sadece sıradaki doğru sayıyı kabul eder
    if (me && num !== me.next) {
      // yanlış tık: kırmızı flash (kozmetik; skoru etkilemez)
      btn.classList.remove('ns-wrong');
      void btn.offsetWidth;
      btn.classList.add('ns-wrong');
    }
  } else if (mgId === 'simon-says') {
    const view = s.minigame.view;
    const me = view.players[myId];
    // Sadece cevap fazında, hayattaysan ve daha bitirmediysen tıklama sayılır
    // (server ayrıca doğrular; bu yalnızca UX).
    if (!me || !me.alive || view.phase !== 'input' || me.status !== 'entering') return;
    const btn = e.target.closest('.sim-btn');
    if (btn) send('game:input', { index: Number(btn.dataset.color) });
  }
});

// ================= PLUGGABLE CLIENT MINIGAME RENDERERS =================
// Yeni bir minigame eklerken buraya "minigameId -> render fonksiyonu" ekle.
// render(view) -> HTML string döndürür. Buton bağlama için bindMinigame'e ekle.
const minigameRenderers = {
  placeholder(view) {
    const me = view.players.find((p) => p.id === myId);
    const iSubmitted = me ? me.submitted : true; // katılımcı değilsem buton kapalı
    const rows = view.players
      .map(
        (p) => `
      <li class="${p.submitted ? 'done' : ''}">
        <span>${esc(p.nickname)}</span>
        <span>${p.submitted ? p.score + ' skor' : 'bekliyor…'}</span>
      </li>`
      )
      .join('');
    return `
      <p>${esc(view.prompt)}</p>
      <button id="rollBtn" class="primary" ${iSubmitted ? 'disabled' : ''}>
        ${iSubmitted ? 'Skorun düştü ✔' : 'Skor Üret!'}
      </button>
      <ul class="list">${rows}</ul>`;
  },

  'arrow-rush'(view) {
    const me = view.players[myId];
    const secs = Math.ceil(view.timeLeftMs / 1000);
    if (!me) return `<p class="hint">İzleyici modu — ⏱ ${secs}s</p>`;
    const symbols = { up: '↑', down: '↓', left: '←', right: '→' };
    const strip = me.queue
      .map((d, i) => `<div class="arrow pos${i}">${symbols[d]}</div>`)
      .join('');
    return `
      <div class="rowbetween ar-hud">
        <span class="ar-timer">⏱ ${secs}s</span>
        <span class="ar-score">Skor: <b>${me.score}</b></span>
        <span class="ar-combo">Combo: <b>x${me.combo}</b></span>
      </div>
      <div id="arStrip" class="ar-strip">${strip}</div>
      <div class="ar-pads">
        <button class="ar-pad" data-dir="left">←</button>
        <button class="ar-pad" data-dir="up">↑</button>
        <button class="ar-pad" data-dir="down">↓</button>
        <button class="ar-pad" data-dir="right">→</button>
      </div>
      <p class="hint">Ok tuşları (veya butonlar) ile en öndeki büyük oku yakala. Art arda doğru bastıkça combo ve puan büyür!</p>`;
  },

  'click-rush'(view) {
    const me = view.players[myId];
    const secs = Math.ceil(view.timeLeftMs / 1000);
    if (!me) return `<p class="hint">İzleyici modu — ⏱ ${secs}s</p>`;

    let arena = '';
    let modeLabel = '';
    if (me.mode === 'stop') {
      arena = `<div id="crStop" class="cr-stop"><span>STOP!</span></div>`;
      modeLabel = 'DUR — tıklama!';
    } else {
      const real = me.target
        ? `<button class="cr-btn ${me.target.kind === 'gold' ? 'cr-gold' : 'cr-real'}" data-id="${me.target.id}" style="left:${me.target.x}%;top:${me.target.y}%">${me.target.kind === 'gold' ? '★' : '●'}</button>`
        : '';
      const decoys = me.decoys
        .map((d) => `<button class="cr-btn cr-decoy" data-id="${d.id}" style="left:${d.x}%;top:${d.y}%">◍</button>`)
        .join('');
      arena = real + decoys;
      if (me.mode === 'gold') modeLabel = 'ALTIN! +5';
      else if (me.mode === 'decoy') modeLabel = 'DİKKAT: sahteler var (-2)';
    }
    return `
      <div class="rowbetween ar-hud">
        <span class="ar-timer">⏱ ${secs}s</span>
        <span class="ar-score">Skor: <b>${me.score}</b></span>
        <span class="cr-mode">${modeLabel}</span>
      </div>
      <div id="crArena" class="cr-arena">${arena}</div>
      <p class="hint">Butona tıkla — her tıkta yer değiştirir. ● +1 · ★ altın +5 · ◍ sahte −2 · STOP'ta tık −3.</p>`;
  },

  'type-race'(view) {
    const me = view.players[myId];
    const secs = Math.ceil(view.timeLeftMs / 1000);
    if (!me) return `<p class="hint">İzleyici modu — ⏱ ${secs}s</p>`;
    // Not: #trWord ve #trNext mount'ta doldurulur; input asla yeniden çizilmez (yerinde güncelleme).
    return `
      <div class="rowbetween ar-hud">
        <span class="ar-timer" id="trTimer">⏱ ${secs}s</span>
        <span class="ar-score">Kelime: <b id="trScore">${me.count}</b></span>
      </div>
      <div class="tr-word" id="trWord"></div>
      <div class="tr-next" id="trNext"></div>
      <input id="trInput" class="tr-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="buraya yaz…" />
      <p class="hint">Kelimeyi yaz — doğru bitince otomatik sıradaki kelimeye geçer. Türkçe karakter şart değil (şarkı = sarki, güneş = gunes).</p>`;
  },

  'number-sort'(view) {
    const me = view.players[myId];
    const secs = Math.ceil(view.timeLeftMs / 1000);
    if (!me) return `<p class="hint">İzleyici modu — ⏱ ${secs}s</p>`;
    const nextLabel = me.finished ? 'Bitti! 🎉' : me.next;
    const nums = view.layout
      .map((it) => {
        const done = it.num < me.next; // sıralı gidildiği için num<next = tamamlandı
        return `<button class="ns-num ${done ? 'ns-done' : ''}" data-num="${it.num}" style="left:${it.x}%;top:${it.y}%" ${done ? 'disabled' : ''}>${it.num}</button>`;
      })
      .join('');
    return `
      <div class="rowbetween ar-hud">
        <span class="ar-timer">⏱ ${secs}s</span>
        <span class="ns-next">Sıradaki: <b>${nextLabel}</b></span>
        <span class="ar-score">${me.progress}/${view.total}</span>
      </div>
      <div id="nsBoard" class="ns-board">${nums}</div>
      <p class="hint">1'den ${view.total}'e küçükten büyüğe sırayla tıkla. Yanlış tık ceza değil — sadece zaman kaybı.</p>`;
  },

  'simon-says'(view) {
    const me = view.players[myId];
    const meta = [
      { name: 'Kırmızı', cls: 'sim-red' },
      { name: 'Mavi', cls: 'sim-blue' },
      { name: 'Yeşil', cls: 'sim-green' },
      { name: 'Sarı', cls: 'sim-yellow' },
    ];
    const secs = Math.ceil(view.inputTimeLeftMs / 1000);

    // Faz etiketi + kime dokunulacağı
    let banner = '';
    let clickable = false;
    if (view.phase === 'showing') {
      banner = `<span class="sim-phase watch">👀 İZLE — sırayı ezberle</span>`;
    } else if (view.phase === 'input') {
      if (me && me.alive) {
        banner = `<span class="sim-phase go">⌨ SIRA SENDE — <b>${secs}s</b></span>`;
        clickable = true;
      } else {
        banner = `<span class="sim-phase watch">Diğerleri oynuyor… <b>${secs}s</b></span>`;
      }
    } else {
      banner = `<span class="sim-phase">Sonuçlar…</span>`;
    }

    // 4 renk butonu (2x2). Gösterim fazında yanan buton (view.flash) parlar.
    const buttons = meta
      .map((m, i) => {
        const lit = view.phase === 'showing' && view.flash === i ? ' sim-lit' : '';
        const dis = clickable ? '' : 'disabled';
        return `<button class="sim-btn ${m.cls}${lit}" data-color="${i}" ${dis} aria-label="${m.name}"></button>`;
      })
      .join('');

    // Kendi ilerleme noktaların (cevap fazında dolu = doğru girilen renk sayısı)
    let progressDots = '';
    if (me) {
      progressDots = Array.from({ length: view.sequenceLength }, (_, i) => {
        const on = view.phase === 'input' && me.status !== 'wrong' && i < me.progress;
        return `<span class="sim-dot${on ? ' on' : ''}"></span>`;
      }).join('');
    }

    // Elenme / durum bandı
    let statusBar = '';
    if (me && !me.alive) {
      statusBar = `<div class="sim-out">💀 ELENDİN${me.eliminatedAtLevel ? ` — Seviye ${me.eliminatedAtLevel}` : ''}<br><small>Kalanları izliyorsun</small></div>`;
    } else if (me && view.phase === 'input' && me.status === 'wrong') {
      statusBar = `<div class="sim-out sim-wrong">❌ Yanlış! Bu seviye elendin…</div>`;
    } else if (me && view.phase === 'input' && me.status === 'correct') {
      statusBar = `<div class="sim-ok">✅ Doğru! Diğerleri bekleniyor…</div>`;
    } else if (!me) {
      statusBar = `<div class="sim-out">İzleyici modu</div>`;
    }

    // Canlı oyuncu listesi (kim geçti / kim elendi anında görünür)
    const roster = Object.keys(view.players)
      .map((id) => view.players[id])
      .map((p) => {
        let icon = '⌛';
        let cls = '';
        if (!p.alive) { icon = '💀'; cls = 'sim-r-out'; }
        else if (p.status === 'correct') { icon = '✅'; cls = 'sim-r-ok'; }
        else if (p.status === 'wrong') { icon = '❌'; cls = 'sim-r-bad'; }
        return `<li class="${cls}"><span>${icon} ${esc(p.nickname)}</span><span>${p.levelsCleared} sv</span></li>`;
      })
      .join('');

    return `
      <div class="rowbetween ar-hud">
        <span class="ar-timer">Seviye ${view.level}</span>
        <span class="ar-score">🟢 ${view.aliveCount} kaldı</span>
      </div>
      <div class="sim-banner">${banner}</div>
      <div class="sim-grid">${buttons}</div>
      <div class="sim-dots">${progressDots}</div>
      ${statusBar}
      <ul class="list sim-roster">${roster}</ul>
      <p class="hint">Server sequence'i herkese aynı anda gösterir. İzle, sonra 5 sn içinde aynı sırayla bas. Bir yanlış = elenirsin. En uzun dayanan kazanır.</p>`;
  },
};

function bindMinigame(id, view) {
  if (id === 'placeholder') {
    const b = $('#rollBtn');
    if (b) b.onclick = () => send('game:input', { type: 'roll' });
  } else if (id === 'arrow-rush') {
    // Ped butonlarının tıkları delegasyonla (#game üzerinde) yakalanıyor; burada sadece flash.
    // Doğru/yanlış görsel geri bildirim: input sırası (seq) değiştiyse şeridi yakıp söndür.
    const me = view && view.players ? view.players[myId] : null;
    const strip = document.getElementById('arStrip');
    if (me && strip && me.seq !== arrowRushLastSeq) {
      arrowRushLastSeq = me.seq;
      if (me.seq > 0) {
        strip.classList.remove('hit', 'miss');
        void strip.offsetWidth; // reflow: animasyonu baştan başlat
        strip.classList.add(me.lastCorrect ? 'hit' : 'miss');
      }
    }
  } else if (id === 'click-rush') {
    // Tıklar delegasyonla (#game üzerinde) yakalanıyor; burada sadece görsel durum.
    const me = view && view.players ? view.players[myId] : null;
    const arena = document.getElementById('crArena');
    if (me && me.mode === 'stop') {
      gameEl.classList.add('cr-screen-stop'); // ekran geneli kırmızı uyarı
    }
    // Puan değişiminde yeşil/kırmızı geri bildirim.
    if (me && arena && me.seq !== clickRushLastSeq) {
      clickRushLastSeq = me.seq;
      if (me.seq > 0) {
        arena.classList.remove('cr-hit', 'cr-bad');
        void arena.offsetWidth;
        arena.classList.add(me.lastDelta > 0 ? 'cr-hit' : 'cr-bad');
      }
    }
  } else if (id === 'type-race') {
    // MOUNT (round başına bir kez): input persistan kalır; sonraki güncellemeler
    // updateTypeRace ile yerinde yapılır (input yok edilmez -> focus/imleç korunur).
    typeRaceMounted = true;
    typeRaceValue = '';
    const input = document.getElementById('trInput');
    if (input) {
      input.value = '';
      input.addEventListener('input', onTypeRaceInput);
      input.focus(); // otomatik focus (oyuncu tıklamak zorunda kalmasın)
    }
    const me = view && view.players ? view.players[myId] : null;
    if (me) updateTypeRaceNext(me);
    paintTypeRaceWord('');
  }
}
// ======================================================================

function render(state) {
  currentState = state; // klavye dinleyicisi güncel faz/minigame'i görsün
  window.__roomState = state; // debug: konsoldan __roomState.characters ile kontrol edilebilir
  // Type Race: input'u yok etmemek için tam yeniden çizim yerine yerinde güncelle.
  if (state.phase === 'playing' && state.minigame && state.minigame.id === 'type-race' && typeRaceMounted) {
    updateTypeRace(state);
    return;
  }
  typeRaceMounted = false; // başka bir ekrana geçiyoruz (ya da type-race'e ilk kez giriyoruz)
  const me = state.players.find((p) => p.id === myId);
  const amHost = !!(me && me.isHost);
  let html = '';

  if (state.phase === 'lobby') html = renderLobby(state, amHost, me);
  else if (state.phase === 'playing') html = renderPlaying(state);
  else if (state.phase === 'roundResult') html = renderRoundResult(state, me);
  else if (state.phase === 'gameOver') html = renderGameOver(state, amHost);

  gameEl.classList.remove('cr-screen-stop'); // stop kalıntısını temizle; gerekiyorsa bind tekrar ekler
  gameEl.innerHTML = html;
  bind(state, amHost);
}

function renderLobby(state, amHost, me) {
  const players = state.players
    .map(
      (p) => `
    <li>
      <span>${avatarHTML(state, p.characterId, 'avatar-sm')}${p.isHost ? '👑 ' : ''}${esc(p.nickname)}${p.connected ? '' : '<span class="off">(koptu)</span>'}</span>
      <span class="${p.ready ? 'ready' : 'notready'}">${p.ready ? 'Hazır ✔' : 'Bekliyor'}</span>
    </li>`
    )
    .join('');
  const rounds = [3, 5, 7]
    .map(
      (n) => `<button class="roundBtn ${state.totalRounds === n ? 'sel' : ''}" data-rounds="${n}" ${amHost ? '' : 'disabled'}>${n}</button>`
    )
    .join('');

  // Karakter seçim gridi. "taken" = başka BAĞLI oyuncunun seçtiği (kopan oyuncununki
  // havuza döner). Kendi seçtiğim "sel" olur; başkasınınki soluk + tıklanamaz.
  const takenBy = {};
  state.players.forEach((p) => {
    if (p.connected && p.characterId) takenBy[p.characterId] = p;
  });
  const myChar = me ? me.characterId : null;
  const cells = (state.characters || [])
    .map((c) => {
      const owner = takenBy[c.id];
      const mine = myChar === c.id;
      const takenByOther = !!owner && (!me || owner.id !== me.id);
      const cls = ['charCell'];
      if (mine) cls.push('sel');
      if (takenByOther) cls.push('taken');
      const badge = takenByOther
        ? `<span class="charTaken">${esc(owner.nickname)}</span>`
        : mine
        ? '<span class="charMine">SEÇİLİ ✔</span>'
        : '<span class="charName">' + esc(c.name) + '</span>';
      return `
        <button class="${cls.join(' ')}" data-char="${c.id}" ${takenByOther ? 'disabled' : ''} title="${esc(c.name)}">
          <img src="characters/${c.file}" alt="${esc(c.name)}" />
          ${badge}
        </button>`;
    })
    .join('');

  // Katalog boşsa (ör. sunucu eski sürümde çalışıyorsa) grid yerine net uyarı bas.
  const hasCatalog = Array.isArray(state.characters) && state.characters.length > 0;
  const gridHtml = hasCatalog
    ? `<div class="charGrid">${cells}</div>`
    : `<p class="hint charhint">⚠ Karakter listesi sunucudan gelmedi. Sunucu büyük olasılıkla ESKİ sürümde çalışıyor — terminalde durdurup (Ctrl+C) <b>npm start</b> ile yeniden başlat.</p>`;

  const canReady = !!(me && me.characterId);
  const readyLabel = me && me.ready ? 'Hazır değilim' : 'Hazırım';
  return `
    <div class="rowbetween"><h2>Lobi</h2><span class="code">${state.code}</span></div>
    <p>Round sayısı: ${rounds} ${amHost ? '' : '<small style="color:var(--muted)">(sadece host seçer)</small>'}</p>
    <ul class="list">${players}</ul>
    <h3>Karakterini seç</h3>
    ${gridHtml}
    <button id="readyBtn" class="primary wide" ${canReady ? '' : 'disabled'}>${readyLabel}</button>
    ${canReady ? '' : '<p class="hint charhint">⚠ Önce bir karakter seç — sonra “Hazırım”.</p>'}
    <p class="hint">${state.waitingFor.length ? 'Bekleniyor: ' + state.waitingFor.map(esc).join(', ') : 'Herkes hazır! Başlıyor…'}</p>`;
}

function renderPlaying(state) {
  const mg = state.minigame;
  const renderer = minigameRenderers[mg.id];
  const inner = renderer ? renderer(mg.view) : `<p>Bilinmeyen minigame: ${esc(mg.id)}</p>`;
  return `
    <div class="rowbetween"><h2>${esc(mg.displayName)}</h2><span class="code">Round ${state.currentRound}/${state.totalRounds}</span></div>
    ${inner}`;
}

function renderRoundResult(state, me) {
  const r = state.lastRoundResult;
  const ranking = r.ranking
    .map(
      (x, i) => `<li><span>${i + 1}. ${avatarHTML(state, playerCharId(state, x.playerId), 'avatar-xs')}${esc(x.nickname)}</span><span>skor ${x.rawScore} · +${x.points} puan</span></li>`
    )
    .join('');
  const scoreboard = [...state.players]
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((p, i) => `<li><span>${i + 1}. ${avatarHTML(state, p.characterId, 'avatar-xs')}${esc(p.nickname)}${p.connected ? '' : '<span class="off">(koptu)</span>'}</span><span>${p.totalScore} puan</span></li>`)
    .join('');
  const isLast = state.currentRound >= state.totalRounds;
  const label = me && me.roundReady ? 'Hazır değilim' : isLast ? 'Finali gör · Hazırım' : 'Sıradaki round · Hazırım';
  return `
    <div class="rowbetween"><h2>Round ${r.round} Sonucu</h2><span class="code">${esc(r.minigameName || '')}</span></div>
    <h3>Bu round sıralaması</h3><ul class="list">${ranking}</ul>
    <h3>Genel skor</h3><ul class="list">${scoreboard}</ul>
    <button id="continueBtn" class="primary wide">${label}</button>
    <p class="hint">${state.waitingFor.length ? 'Bekleniyor: ' + state.waitingFor.map(esc).join(', ') : 'Herkes hazır! Geçiliyor…'}</p>`;
}

function renderGameOver(state, amHost) {
  const scoreboard = [...state.players]
    .sort((a, b) => b.totalScore - a.totalScore)
    .map(
      (p, i) => `<li class="${state.winners.includes(p.nickname) ? 'winner' : ''}"><span>${i + 1}. ${avatarHTML(state, p.characterId, 'avatar-xs')}${esc(p.nickname)}</span><span>${p.totalScore} puan</span></li>`
    )
    .join('');
  const win =
    state.winners.length > 1
      ? '🤝 Berabere: ' + state.winners.map(esc).join(', ')
      : '🏆 Kazanan: ' + esc(state.winners[0] || '-');
  return `
    <h2>🎉 Oyun Bitti</h2>
    <p class="bigwin">${win}</p>
    <ul class="list">${scoreboard}</ul>
    ${amHost ? '<button id="lobbyBtn" class="primary wide">Lobiye Dön</button>' : '<p class="hint">Host yeni oyun başlatabilir.</p>'}`;
}

function bind(state, amHost) {
  if (state.phase === 'lobby') {
    const rb = $('#readyBtn');
    if (rb) rb.onclick = () => send('lobby:toggleReady');
    // Karakter seçimi: kendi seçili karakterine tekrar basmak bırakır (server toggle).
    document.querySelectorAll('.charCell').forEach((b) => {
      b.onclick = () => {
        if (b.disabled) return; // başkası almış
        send('lobby:selectCharacter', { characterId: b.dataset.char });
      };
    });
    if (amHost)
      document.querySelectorAll('.roundBtn').forEach((b) => {
        b.onclick = () => send('lobby:setRounds', { rounds: Number(b.dataset.rounds) });
      });
  } else if (state.phase === 'playing') {
    bindMinigame(state.minigame.id, state.minigame.view);
  } else if (state.phase === 'roundResult') {
    const cb = $('#continueBtn');
    if (cb) cb.onclick = () => send('round:toggleReady');
  } else if (state.phase === 'gameOver') {
    const lb = $('#lobbyBtn');
    if (lb) lb.onclick = () => send('game:returnToLobby');
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- karakter / avatar yardımcıları ----------------
// Karakter kataloğu server:state.characters içinde gelir (id, name, file).
function charFile(state, characterId) {
  if (!characterId || !state.characters) return null;
  const c = state.characters.find((x) => x.id === characterId);
  return c ? c.file : null;
}
// Oyuncu adının yanında gösterilecek küçük avatar (seçilmemişse soluk '?').
function avatarHTML(state, characterId, cls = '') {
  const file = charFile(state, characterId);
  if (!file) return `<span class="avatar avatar-empty ${cls}"></span>`;
  return `<img class="avatar ${cls}" src="characters/${file}" alt="" />`;
}
function playerCharId(state, playerId) {
  const p = state.players.find((x) => x.id === playerId);
  return p ? p.characterId : null;
}

// ---------------- Type Race yardımcıları ----------------
// Server'daki foldTr ile AYNI olmalı (ı/i, ş/s, ç/c, ö/o, ü/u, ğ/g — hepsi 1:1).
function foldTr(s) {
  return String(s)
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/Ş/g, 's').replace(/ş/g, 's')
    .replace(/Ç/g, 'c').replace(/ç/g, 'c')
    .replace(/Ö/g, 'o').replace(/ö/g, 'o')
    .replace(/Ü/g, 'u').replace(/ü/g, 'u')
    .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    .toLowerCase();
}
function trComplete(val, word) {
  return foldTr(val).replace(/\s+/g, '') === foldTr(word).replace(/\s+/g, '');
}
function trCurrentWord() {
  const s = currentState;
  if (!s || !s.minigame || !s.minigame.view) return '';
  const me = s.minigame.view.players[myId];
  return me ? me.word : '';
}
function setText(sel, val) {
  const el = document.querySelector(sel);
  if (el) el.textContent = val;
}

// Hedef kelimeyi harf harf renklendir (yeşil doğru / kırmızı yanlış / soluk yazılmamış).
function paintTypeRaceWord(val) {
  const word = trCurrentWord();
  const el = document.getElementById('trWord');
  if (!el) return;
  const nv = foldTr(val);
  const nw = foldTr(word);
  let html = '';
  for (let i = 0; i < word.length; i++) {
    let cls = 'tr-pending';
    if (i < nv.length) cls = nv[i] === nw[i] ? 'tr-ok' : 'tr-bad';
    html += `<span class="${cls}">${esc(word[i])}</span>`;
  }
  if (nv.length > nw.length) html += `<span class="tr-bad tr-extra">×</span>`; // fazla harf
  el.innerHTML = html;
}

function updateTypeRaceNext(me) {
  const next = (me.next || []).filter(Boolean).join('   ');
  setText('#trNext', next ? 'sıradaki: ' + next : '');
}

// Server yayınında input'a DOKUNMADAN sadece dinamik metinleri güncelle.
function updateTypeRace(state) {
  const view = state.minigame.view;
  const me = view.players[myId];
  const secs = Math.ceil(view.timeLeftMs / 1000);
  setText('#trTimer', `⏱ ${secs}s`);
  if (me) {
    setText('#trScore', me.count);
    updateTypeRaceNext(me);
    paintTypeRaceWord(typeRaceValue); // kelime (index) değişmiş olabilir -> yeniden boya
  }
}

// Her tuş basışında: canlı boyama + kelime tamamlandıysa server'a doğrulama gönder.
function onTypeRaceInput() {
  const input = document.getElementById('trInput');
  if (!input) return;
  const val = input.value;
  typeRaceValue = val;
  const word = trCurrentWord();
  if (word && trComplete(val, word)) {
    send('game:input', { typed: val }); // server doğrular ve index'i ilerletir
    input.value = '';
    typeRaceValue = '';
    paintTypeRaceWord(''); // server onayı gelince kelime sıradakine döner
    return;
  }
  paintTypeRaceWord(val);
}
