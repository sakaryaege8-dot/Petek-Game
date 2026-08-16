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
let undercoverMounted = false; // Kelime Casusu: kendi sıramdaki metin input'u korumak için
let pbMounted = false; // Hassas Duruş: bar shell'i mount edildi mi (in-place güncelleme)
let pbSync = null; // Hassas Duruş: { elapsedMs, atPerf } — çizgi animasyon senkronu
let pbRaf = null; // Hassas Duruş: requestAnimationFrame id
let pbShownAttempts = -1; // Hassas Duruş: floating "+puan" tetikleyicisi
let rbExplodedShown = false; // Kırmızı Buton: patlama efekti bir kez tetiklensin
let ttMounted = false; // Zaman Vurucu: shell mount edildi mi (in-place güncelleme)
let ttStructKey = ''; // Zaman Vurucu: ekran yapısı anahtarı (phase|pressed) — değişince remount
let ttSync = null; // Zaman Vurucu: { atPerf } — lokal sayaç başlangıcı
let ttRaf = null; // Zaman Vurucu: requestAnimationFrame id
let rlglMounted = false; // Kırmızı Işık: shell mount edildi mi (in-place güncelleme)
let rlglHolding = false; // Kırmızı Işık: yerel "basılı tutuyorum" durumu (tekrar göndermeyi engeller)
let rlglWalkTimer = null; // Kırmızı Işık: yürüme animasyonu kare döngüsü
let rlglWalkFrame = 0; // Kırmızı Işık: o anki yürüme karesi

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
  } else if (mgId === 'undercover') {
    // Oylama: portre/isim kartına basınca oyu yolla (pointerdown = yeniden-çizim
    // araya girse bile tık kaçmaz; server ayrıca doğrular).
    if (s.minigame.view.phase !== 'voting') return;
    const cell = e.target.closest('.uc-vote');
    if (cell && !cell.disabled) send('game:input', { type: 'vote', targetId: cell.dataset.pid });
  } else if (mgId === 'precision-bar') {
    // Bara ya da DURDUR'a basınca çizgiyi durdur (server o anki gerçek pozisyonu hesaplar).
    if (e.target.closest('#pbArena') || e.target.closest('#pbStop')) send('game:input', { type: 'stop' });
  } else if (mgId === 'red-button') {
    // Kırmızı butona bas (bir kez). Server basış anını kendi saatiyle ölçer.
    const you = s.minigame.view.you || {};
    if (!you.pressed && e.target.closest('#rbBtn')) send('game:input', { type: 'press' });
  } else if (mgId === 'time-target') {
    // Hedef süreye ulaştığını düşününce bas (bir kez). Server basış anını ölçer.
    const you = s.minigame.view.you || {};
    if (!you.pressed && e.target.closest('#ttBtn')) send('game:input', { type: 'press' });
  } else if (mgId === 'red-light-green-light') {
    // İLERLE'ye BASILI TUT: pointerdown -> hold başlat (bırakma global pointerup'ta).
    if (e.target.closest('#rlglGo')) { e.preventDefault(); rlglSetHold(true); }
  }
});

// Kırmızı Işık: basılı-tut kontrolü. Fare/dokunma her yerde bırakılınca dursun +
// Boşluk/↑ tuşu da basılı tutmayı sağlasın. (Bir kez eklenir; currentState'e bakar.)
function rlglSetHold(down) {
  const s = currentState;
  if (!s || s.phase !== 'playing' || !s.minigame || s.minigame.id !== 'red-light-green-light') {
    rlglHolding = false;
    return;
  }
  const me = s.minigame.view.players[myId];
  if (!me || me.eliminated || me.finished || me.left) return;
  if (down === rlglHolding) return; // durum değişmediyse tekrar gönderme
  rlglHolding = down;
  send('game:input', { type: 'hold', down });
}
document.addEventListener('pointerup', () => rlglSetHold(false));
document.addEventListener('keydown', (e) => {
  const s = currentState;
  if (!s || s.phase !== 'playing' || !s.minigame || s.minigame.id !== 'red-light-green-light') return;
  if (e.key === ' ' || e.code === 'Space' || e.key === 'ArrowUp') { e.preventDefault(); rlglSetHold(true); }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' || e.code === 'Space' || e.key === 'ArrowUp') rlglSetHold(false);
});
window.addEventListener('blur', () => rlglSetHold(false));

// Hassas Duruş: Boşluk tuşuyla da durdurulabilsin (ayrı dinleyici; ok-tuşu
// dinleyicisine dokunmuyoruz).
document.addEventListener('keydown', (e) => {
  const s = currentState;
  if (!s || s.phase !== 'playing' || !s.minigame || s.minigame.id !== 'precision-bar') return;
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    send('game:input', { type: 'stop' });
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

  // Kelime Casusu — çok ekranlı: tooFew / reveal / clue / voting / result.
  // view.you sadece BU oyuncunun soketine gelir (rol/kelime sızmaz).
  undercover(view, state) {
    if (view.phase === 'tooFew') {
      return `<div class="uc-role uc-spectator">Kelime Casusu için en az <b>${view.minPlayers}</b> oyuncu gerekli.
        <br><small>Bu round atlanıyor — herkes eşit puan alıyor.</small></div>`;
    }
    if (view.phase === 'reveal') {
      return `
        ${ucRoleBig(view)}
        <p class="uc-info">Rolünü aklında tut… Birazdan sıra başlıyor. Amaç: casus konuşmalardan kelimeyi çözemesin; sivilseniz casusu bulun.</p>
        <h3>Oyuncular</h3>${ucPlayerList(view, state)}`;
    }
    if (view.phase === 'clue') {
      const secs = Math.ceil((view.turnTimeLeftMs || 0) / 1000);
      const myTurn = view.you && view.you.isYourTurn;
      let panel;
      if (myTurn) {
        panel = `
          <div class="uc-turn me">
            <div class="uc-turn-label">⌨ SIRA SENDE — <b id="ucTimer">⏱ ${secs}s</b></div>
            <input id="ucInput" class="uc-input" maxlength="24" autocomplete="off" autocorrect="off"
                   autocapitalize="off" spellcheck="false" placeholder="temayla ilgili TEK kelime…" />
            <button id="ucSubmit" class="primary wide">Gönder</button>
            <div id="ucNotice" class="uc-notice">${view.you.notice ? esc(view.you.notice) : ''}</div>
          </div>`;
      } else {
        const who = view.currentTurn ? esc(view.currentTurn.nickname) : '—';
        panel = `<div class="uc-turn"><div class="uc-turn-label"><b>${who}</b> düşünüyor… <span id="ucTimer">⏱ ${secs}s</span></div></div>`;
      }
      return `
        ${ucRoleHint(view)}
        <div class="rowbetween ar-hud"><span class="ar-timer">Tur ${view.lap}/${view.lapsTotal}</span>
          <span class="ar-score">🕵️ birimiz casus…</span></div>
        ${panel}
        <h3>Şu ana kadar söylenenler</h3>${ucBoard(view, state)}`;
    }
    if (view.phase === 'voting') {
      const secs = Math.ceil((view.voteTimeLeftMs || 0) / 1000);
      const myVote = view.you ? view.you.myVote : null;
      const voted = new Set(view.votedIds || []);
      const alive = view.players.filter((p) => !p.left).length;
      const cells = view.players
        .map((p) => {
          const isSelf = p.id === myId;
          const disabled = isSelf || p.left;
          const sel = myVote === p.id ? ' sel' : '';
          const mark = voted.has(p.id) ? '<span class="uc-voted">oy verdi ✔</span>' : '';
          const tag = isSelf ? ' <small>(sen)</small>' : p.left ? ' <small class="off">(koptu)</small>' : '';
          return `
            <button class="uc-vote${sel}" data-pid="${p.id}" ${disabled ? 'disabled' : ''}>
              ${avatarHTML(state, playerCharId(state, p.id), 'avatar-sm')}
              <span class="uc-vname">${esc(p.nickname)}${tag}</span>
              ${mark}
            </button>`;
        })
        .join('');
      return `
        ${ucRoleHint(view)}
        <div class="rowbetween ar-hud"><span class="ar-timer">🗳️ Oylama — ⏱ ${secs}s</span>
          <span class="ar-score">${(view.votedIds || []).length}/${alive} oy</span></div>
        <p class="uc-info">Sence casus kim? Portreye bas. (Kendine oy veremezsin — fikrini değiştirebilirsin.)</p>
        <div class="uc-vote-grid">${cells}</div>
        <h3>Söylenenler</h3>${ucBoard(view, state)}`;
    }
    if (view.phase === 'result') {
      const r = view.result;
      const caught = r.spyCaught;
      const nameOf = (id) => {
        const p = view.players.find((x) => x.id === id);
        return p ? esc(p.nickname) : '—';
      };
      const voteRows = view.players
        .map((p) => {
          const target = r.votes[p.id];
          const isSpy = p.id === r.spyId;
          const accused = r.accusedIds.includes(p.id);
          const right = target ? '→ ' + nameOf(target) : p.left ? '(koptu)' : 'oy yok';
          return `<li class="${accused ? 'uc-accused' : ''}">
            <span>${avatarHTML(state, playerCharId(state, p.id), 'avatar-xs')}${esc(p.nickname)}${isSpy ? ' 🕵️' : ''}</span>
            <span>${right} · <b>${r.tally[p.id] || 0}</b> oy</span>
          </li>`;
        })
        .join('');
      const win = r.winnerNames.length ? r.winnerNames.map(esc).join(', ') : '—';
      return `
        <div class="uc-result ${caught ? 'uc-caught' : 'uc-escaped'}">
          <div class="uc-result-big">${caught ? '✅ CASUS YAKALANDI' : '🕵️ CASUS SIYRILDI'}</div>
          <div class="uc-reveal">Casus: <b>${esc(r.spyNickname)}</b></div>
          <div class="uc-reveal">Gizli kelime: <b>${esc(r.secret)}</b></div>
          <div class="uc-reveal">Kazanan${r.winnerNames.length > 1 ? 'lar' : ''}: <b>${win}</b></div>
          <div class="uc-reason">${esc(r.reason)}</div>
        </div>
        <h3>Kim kime oy verdi</h3><ul class="list">${voteRows}</ul>`;
    }
    return '';
  },

  // Hassas Duruş — bar + hareketli çizgi. Bar bölmeleri statik (view.segments).
  // Çizgiyi rAF döngüsü oynatır (mount'ta başlar); HUD yerinde güncellenir.
  'precision-bar'(view) {
    const me = view.players[myId];
    const secs = Math.ceil(view.timeLeftMs / 1000);
    if (!me) return `<p class="hint">İzleyici modu — ⏱ ${secs}s</p>`;
    const segs = view.segments
      .map(
        (sg) =>
          `<div class="pb-seg pb-tier${sg.tier}" style="left:${sg.startPct}%;width:${sg.widthPct}%;background:${sg.color}"><span class="pb-seg-pts">${sg.points}</span></div>`
      )
      .join('');
    return `
      <div class="rowbetween ar-hud">
        <span class="ar-timer" id="pbTimer">⏱ ${secs}s</span>
        <span class="ar-score">Skor: <b id="pbScore">${me.score}</b></span>
        <span class="pb-attempts">Deneme: <b id="pbAttempts">${me.attempts}</b></span>
      </div>
      <div id="pbArena" class="pb-arena">
        <div class="pb-bar">${segs}</div>
        <div id="pbLine" class="pb-line"></div>
        <div id="pbFloat" class="pb-float"></div>
      </div>
      <button id="pbStop" class="primary wide pb-stop">DURDUR</button>
      <p class="hint">Çizgi gidip gelirken <b>DURDUR</b>'a bas (bara tıkla / Boşluk tuşu da olur). Merkeze ne kadar yakınsan o kadar çok puan — merkez <b>5</b>! Her denemenin hızı farklı; 30 sn boyunca elinden geldiğince çok dene.</p>`;
  },

  // Kırmızı Buton — senkron nerve oyunu. Patlama efekti bindMinigame'de tetiklenir.
  'red-button'(view) {
    const secs = Math.ceil(view.timeLeftMs / 1000);
    const you = view.you || {};
    const hud = `
      <div class="rowbetween ar-hud">
        <span class="ar-timer">⏱ ${secs}s</span>
        <span class="ar-score">${view.pressedCount}/${view.total} bastı</span>
      </div>`;
    let center;
    if (you.pressed) {
      const t = you.pressSec != null ? you.pressSec.toFixed(1) : '?';
      if (you.late) {
        center = `
          <button class="rb-btn rb-used rb-late" disabled>
            <span class="rb-main">ÇOK GEÇ</span>
            <span class="rb-sub">${t} sn · 0 puan 💀</span>
          </button>
          <p class="hint">Patlamadan sonra bastın — bu round <b>0 puan</b>. Bir dahakine biraz daha erken bas! 😬</p>`;
      } else {
        center = `
          <button class="rb-btn rb-used rb-safe" disabled>
            <span class="rb-main">BASTIN</span>
            <span class="rb-sub">${t} saniyede ✔</span>
          </button>
          <p class="hint">Patlamadan ÖNCE bastın — süren ne kadar geçse o kadar iyi. Round sonunda herkesin süresi açıklanacak. 😎</p>`;
      }
    } else if (view.exploded) {
      // Patlama oldu, hâlâ basmadıysan artık puan yok (ama basıp "çok geç" görebilirsin).
      center = `
        <button id="rbBtn" class="rb-btn rb-live rb-toolate">
          <span class="rb-main">GEÇ KALDIN</span>
          <span class="rb-sub">artık 0 puan</span>
        </button>
        <p class="hint">Patladı! Basmadın — bu round <b>0 puan</b>. Bir sonraki sefere patlamadan hemen önce basmayı dene.</p>`;
    } else {
      center = `
        <button id="rbBtn" class="rb-btn rb-live">
          <span class="rb-main">BASMA…</span>
          <span class="rb-sub">geç bas = çok puan (ama patlamadan ÖNCE!)</span>
        </button>
        <p class="hint">Gizli bir <b>patlama anı</b> var — ondan ÖNCE ne kadar geç basarsan o kadar çok puan. Ama patlamadan sonra basarsan (ya da hiç basmazsan) <b>0 puan</b>. Sinirini test et!</p>`;
    }
    return hud + `<div class="rb-arena">${center}</div>`;
  },

  // Zaman Vurucu — hedef süre + gizlenen sayaç. Sayacı rAF (client-lokal) sürer.
  'time-target'(view, state) {
    const target = view.targetSec.toFixed(2);
    // Round sonu: herkesin süresi/farkı karşılaştırmalı.
    if (view.phase === 'reveal') {
      const rows = view.results
        .map((r, i) => {
          const time = r.pressed ? `${r.pressSec.toFixed(2)} sn` : 'basmadı';
          const diff = r.pressed ? `${r.diffSec.toFixed(2)} fark` : '—';
          const cls = i === 0 && r.pressed ? 'uc-accused' : ''; // en yakını vurgula
          return `<li class="${cls}">
            <span>${i + 1}. ${avatarHTML(state, playerCharId(state, r.playerId), 'avatar-xs')}${esc(r.nickname)}${r.pressed ? '' : ' <span class="off">(basmadı)</span>'}</span>
            <span>${time} · ${diff} · <b>${r.points}</b></span>
          </li>`;
        })
        .join('');
      return `
        <div class="tt-target">🎯 Hedef: <b>${target}</b> sn</div>
        <h3>Sonuçlar — hedefe en yakın kazanır</h3>
        <ul class="list">${rows}</ul>`;
    }
    // Oynanış
    const you = view.you || {};
    const hud = `<div class="rowbetween ar-hud"><span></span><span class="ar-score">${view.pressedCount}/${view.total} bastı</span></div>`;
    const targetBox = `<div class="tt-target">🎯 Hedef: <b>${target}</b> sn</div>`;
    let body;
    if (you.pressed) {
      body = `
        <div class="tt-feedback">
          <div class="tt-fb-time">${you.pressSec != null ? you.pressSec.toFixed(2) : '?'} sn'de bastın</div>
          <div class="tt-fb-diff">hedef ${target} → <b>${you.diffSec != null ? you.diffSec.toFixed(2) : '?'} sn fark</b></div>
          <div class="tt-fb-pts">${you.points != null ? you.points : 0} puan</div>
        </div>
        <p class="hint">Bir kez basılır. Round sonunda herkesin süresi karşılaştırılacak. 🎯</p>`;
    } else {
      body = `
        <div id="ttCounter" class="tt-counter">0.00</div>
        <div id="ttHidden" class="tt-hidden hidden">🙈 sayaç gizlendi — artık kendi hissine güven!</div>
        <button id="ttBtn" class="primary wide tt-btn">BAS!</button>
        <p class="hint">Sayaç ilk <b>3 saniye</b> görünür, sonra kaybolur. Hedef süreye (<b>${target}</b> sn) ulaştığını hissettiğin an <b>BAS</b>. Hedefe en yakın en çok puanı alır.</p>`;
    }
    return hud + targetBox + `<div class="tt-arena">${body}</div>`;
  },

  // Kırmızı Işık Yeşil Işık — yolda ilerleyen karakterler + büyük ışık. Shell mount'ta
  // çizilir; ışık/konum/durum her broadcast'te updateRedLight ile yerinde güncellenir.
  'red-light-green-light'(view, state) {
    const lanes = state.players
      .map((p) => {
        const pv = view.players[p.id];
        if (!pv) return '';
        const file = charFile(state, p.characterId);
        const staticSrc = file ? `characters/${file}` : '';
        const img = file ? `<img src="${staticSrc}" alt="" />` : '<span class="rlgl-noimg">?</span>';
        const mineStar = p.id === myId ? '★ ' : '';
        return `<div class="rlgl-lane">
          <div class="rlgl-runner" id="rlglR_${p.id}" data-cid="${p.characterId || ''}" data-static="${staticSrc}" style="left:${rlglLeft(pv.x)}">
            ${img}<span class="rlgl-rname">${mineStar}${esc(p.nickname)}</span>
          </div>
        </div>`;
      })
      .join('');
    return `
      <div class="rowbetween ar-hud">
        <span class="ar-timer" id="rlglTime">⏱ ${Math.ceil(view.timeLeftMs / 1000)}s</span>
        <span class="ar-score" id="rlglAlive">🏃 ${view.activeCount}/${view.total}</span>
      </div>
      <div id="rlglLight" class="rlgl-light ${view.light}">${view.light === 'green' ? 'YEŞİL — GEÇ' : 'KIRMIZI — DUR'}</div>
      <div class="rlgl-track"><div class="rlgl-finishline"></div>${lanes}</div>
      <div id="rlglBanner" class="rlgl-banner hidden"></div>
      <button id="rlglGo" class="primary wide rlgl-go">İLERLE — basılı tut</button>
      <p class="hint">Yeşilde <b>İLERLE</b>'yi basılı tut (Boşluk / ↑ da olur), kırmızıda <b>hemen bırak</b>! Kırmızıda hareket eden <b>anında elenir</b>. Işık süreleri rastgele, uyarı yok. Önce bitiş çizgisine ulaşan en yüksek puanı alır.</p>`;
  },
};

// Runner'ın yol üzerindeki sol konumu (2%..94% -> taşmasın, bitiş çizgisiyle hizalı).
function rlglLeft(x) {
  return (2 + Math.max(0, Math.min(1, x || 0)) * 92) + '%';
}
// Broadcast geldikçe (100ms) ışık/konum/durumları YERİNDE güncelle (shell'i çizmeden).
function updateRedLight(state) {
  const view = state.minigame.view;
  setText('#rlglTime', `⏱ ${Math.ceil(view.timeLeftMs / 1000)}s`);
  setText('#rlglAlive', `🏃 ${view.activeCount}/${view.total}`);
  const light = document.getElementById('rlglLight');
  if (light) {
    light.className = `rlgl-light ${view.light}`;
    light.textContent = view.light === 'green' ? 'YEŞİL — GEÇ' : 'KIRMIZI — DUR';
  }
  for (const id in view.players) {
    const pv = view.players[id];
    const runner = document.getElementById(`rlglR_${id}`);
    if (!runner) continue;
    runner.style.left = rlglLeft(pv.x);
    runner.classList.toggle('walking', !!pv.moving);
    runner.classList.toggle('elim', !!pv.eliminated);
    runner.classList.toggle('done', !!pv.finished);
    runner.classList.toggle('gone', !!pv.left);
  }
  const me = view.players[myId];
  const banner = document.getElementById('rlglBanner');
  if (banner) {
    if (me && me.eliminated) { banner.className = 'rlgl-banner elim'; banner.textContent = '💀 ELENDİN — diğerlerini izliyorsun'; }
    else if (me && me.finished) { banner.className = 'rlgl-banner done'; banner.textContent = '🏁 BİTİRDİN!'; }
    else { banner.className = 'rlgl-banner hidden'; banner.textContent = ''; }
  }
  const go = document.getElementById('rlglGo');
  if (go) {
    go.disabled = !me || me.eliminated || me.finished || me.left;
    go.classList.toggle('rlgl-red', view.light === 'red');
  }
}

// ---- Kırmızı Işık: yürüme animasyonu (PixelLab kareleri) ----
// characters/animations/<id>/walk_00..03.png (04 == 00, döngü için atlanır). Tüm 8
// karakterde mevcut. moving=true olan runner'ın img'i bu kareler arasında döner;
// durunca statik poza (data-static) döner. SADECE bu minigame'de kullanılır.
const WALK_FRAMES = 4;
const WALK_FPS = 8;
const WALK_HAS = new Set(SELECT_ANIM_IDS); // seçim animasyonuyla aynı 8 karakter
(function preloadWalkAnims() {
  WALK_HAS.forEach((id) => {
    for (let i = 0; i < WALK_FRAMES; i++) {
      new Image().src = `characters/animations/${id}/walk_${String(i).padStart(2, '0')}.png`;
    }
  });
})();
function rlglStartWalk() {
  rlglStopWalk();
  rlglWalkTimer = setInterval(() => {
    rlglWalkFrame = (rlglWalkFrame + 1) % WALK_FRAMES;
    const view = currentState && currentState.minigame && currentState.minigame.view;
    if (!view || !view.players) return;
    document.querySelectorAll('#rlglTrack .rlgl-runner').forEach((r) => {
      const img = r.querySelector('img');
      if (!img) return;
      const id = r.id.slice('rlglR_'.length);
      const pv = view.players[id];
      const cid = r.dataset.cid;
      if (pv && pv.moving && cid && WALK_HAS.has(cid)) {
        img.src = `characters/animations/${cid}/walk_${String(rlglWalkFrame).padStart(2, '0')}.png`;
      } else if (r.dataset.static && img.getAttribute('src') !== r.dataset.static) {
        img.src = r.dataset.static; // durunca statik poz (aynıysa dokunma -> titremesin)
      }
    });
  }, 1000 / WALK_FPS);
}
function rlglStopWalk() {
  if (rlglWalkTimer) { clearInterval(rlglWalkTimer); rlglWalkTimer = null; }
  rlglWalkFrame = 0;
}

// ---- Kelime Casusu yardımcı çiziciler ----
function ucRoleBig(view) {
  if (!view.you || !view.you.participant) return `<div class="uc-role uc-spectator">İzleyici modu</div>`;
  if (view.you.isSpy)
    return `<div class="uc-role uc-spy">🕵️ SEN CASUSSUN<br><small>Kelimeyi bilmiyorsun. Diğerlerinin dediklerinden ipucu çıkar, yakalanmadan mantıklı bir kelime uydur.</small></div>`;
  return `<div class="uc-role uc-civ">Gizli kelime<br><b>${esc(view.you.word || '')}</b><br><small>Casusu belli etmeden bu kelimeyle ilgili bir şey söyle.</small></div>`;
}
// Clue/voting sırasında üstte küçük rol hatırlatıcı.
function ucRoleHint(view) {
  if (!view.you || !view.you.participant) return `<div class="uc-mini uc-spectator-mini">İzleyici modu</div>`;
  if (view.you.isSpy) return `<div class="uc-mini uc-spy-mini">🕵️ Sen casussun — kelimeyi bilmiyorsun</div>`;
  return `<div class="uc-mini uc-civ-mini">Gizli kelime: <b>${esc(view.you.word || '')}</b></div>`;
}
function ucBoard(view, state) {
  if (!view.clues || !view.clues.length) return `<p class="hint">Henüz kimse konuşmadı.</p>`;
  const rows = view.clues
    .map(
      (c) => `<li>
        <span>${avatarHTML(state, playerCharId(state, c.playerId), 'avatar-xs')}${esc(c.nickname)}</span>
        <span class="uc-word">${esc(c.word)}${c.auto ? ' <small class="uc-auto">(süre doldu)</small>' : ''}</span>
      </li>`
    )
    .join('');
  return `<ul class="list uc-clues">${rows}</ul>`;
}
function ucPlayerList(view, state) {
  const rows = view.players
    .map(
      (p) => `<li><span>${avatarHTML(state, playerCharId(state, p.id), 'avatar-xs')}${esc(p.nickname)}${p.left ? ' <span class="off">(koptu)</span>' : ''}</span></li>`
    )
    .join('');
  return `<ul class="list">${rows}</ul>`;
}
// Kendi sıramdayken (in-place) sadece süre + uyarı metnini güncelle; input'a dokunma.
function updateUndercoverTurn(state) {
  const v = state.minigame.view;
  const secs = Math.ceil((v.turnTimeLeftMs || 0) / 1000);
  setText('#ucTimer', `⏱ ${secs}s`);
  const n = document.getElementById('ucNotice');
  if (n) n.textContent = v.you && v.you.notice ? v.you.notice : '';
}

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
  } else if (id === 'undercover') {
    // Sadece KENDİ clue sıramda metin input'u mount edilir; oy tıklamaları #game
    // pointerdown delegasyonuyla yakalanıyor (burada bağlama gerekmez).
    if (view.phase === 'clue' && view.you && view.you.isYourTurn) {
      undercoverMounted = true; // artık bu turda yerinde güncelleme yapılacak
      const input = document.getElementById('ucInput');
      const submit = () => {
        const el = document.getElementById('ucInput');
        if (!el) return;
        const word = el.value.trim();
        if (!word) return;
        send('game:input', { type: 'clue', word });
        // input'u BURADA temizlemiyoruz: kelime reddedilirse (gizli kelime vs.) yazdığı
        // metin kalsın. Kabul edilince sıra geçer -> tam yeniden çizim yeni boş input verir.
      };
      if (input) {
        input.focus();
        input.onkeydown = (e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        };
      }
      const btn = document.getElementById('ucSubmit');
      if (btn) btn.onclick = submit;
    }
  } else if (id === 'precision-bar') {
    // Shell (bar + çizgi) mount edildi; bundan sonra yerinde güncelleme yapılır.
    // Çizgiyi rAF döngüsü sürekli oynatır (currentState'ten okur).
    pbMounted = true;
    const me = view && view.players ? view.players[myId] : null;
    pbShownAttempts = me ? me.attempts : 0;
    capturePbSync(view);
    startPrecisionAnim();
  } else if (id === 'red-button') {
    // Patlama anı geldiğinde (exploded false->true) senkron efekti BİR KEZ tetikle.
    if (view.exploded) {
      if (!rbExplodedShown) { rbExplodedShown = true; triggerRedButtonBoom(); }
    } else {
      rbExplodedShown = false; // yeni round / patlama öncesi: sıfırla
    }
  } else if (id === 'time-target') {
    ttMounted = true;
    ttStructKey = `${view.phase}|${view.you && view.you.pressed ? 1 : 0}`;
    // Sayaç sadece oynanışta ve daha basmadıysan gerekli (ilk 3 sn görünür).
    if (view.phase === 'playing' && view.you && !view.you.pressed) {
      ttSync = { atPerf: performance.now() }; // sayaç mount anında 0'dan başlar (round başı ≈ şimdi)
      startTimeTargetAnim();
    } else {
      stopTtRaf();
    }
  } else if (id === 'red-light-green-light') {
    // Shell mount edildi; bundan sonra broadcast'ler updateRedLight ile yerinde işlenir.
    rlglMounted = true;
    rlglHolding = false;
    updateRedLight(currentState);
    rlglStartWalk(); // yürüme kare döngüsü (moving olanlar için)
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

  // Kelime Casusu: KENDİ sıramdayken metin input'u her saniye (geri sayım) yeniden
  // çizilirse focus/yazdıklarım kaybolur. Type Race'teki gibi, bu durumda tam yeniden
  // çizim yerine sadece dinamik metinleri (süre, uyarı) yerinde güncelliyoruz.
  const ucv =
    state.phase === 'playing' && state.minigame && state.minigame.id === 'undercover'
      ? state.minigame.view
      : null;
  if (ucv && undercoverMounted && ucv.phase === 'clue' && ucv.you && ucv.you.isYourTurn) {
    updateUndercoverTurn(state);
    return;
  }
  undercoverMounted = false;

  // Hassas Duruş: bar/çizgi DOM'u her broadcast'te yeniden çizilirse animasyon
  // sıçrar. Type Race gibi: mount edildiyse tam yeniden çizim yerine yerinde
  // güncelleme yap (rAF döngüsü çizgiyi sürekli oynatır). Oyundan çıkınca rAF'ı durdur.
  const pbActive = state.phase === 'playing' && state.minigame && state.minigame.id === 'precision-bar';
  if (pbActive && pbMounted) {
    updatePrecisionBar(state);
    return;
  }
  if (!pbActive) stopPrecisionAnim();

  // Zaman Vurucu: sayaç (rAF) shell'i her broadcast'te yeniden çizilmesin. Ekran
  // yapısı (phase|pressed) aynı kaldığı sürece yerinde güncelle; değişince remount.
  const ttv = state.phase === 'playing' && state.minigame && state.minigame.id === 'time-target'
    ? state.minigame.view
    : null;
  const ttKey = ttv ? `${ttv.phase}|${ttv.you && ttv.you.pressed ? 1 : 0}` : null;
  if (ttv && ttMounted && ttKey === ttStructKey) {
    updateTimeTarget(state);
    return;
  }
  if (!ttv) stopTimeTargetAnim();
  ttMounted = false;

  // Kırmızı Işık Yeşil Işık: 100ms'de bir güncelleniyor; shell'i her seferinde yeniden
  // çizmek yerine (karakterlerin kayması bozulmasın) mount edip yerinde güncelliyoruz.
  const rlglActive = state.phase === 'playing' && state.minigame && state.minigame.id === 'red-light-green-light';
  if (rlglActive && rlglMounted) {
    updateRedLight(state);
    return;
  }
  if (!rlglActive) { rlglMounted = false; rlglStopWalk(); }

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

  // Lobide bir oyuncu karakter SEÇTİĞİNDE, o kartta seçim animasyonunu bir kez oynat
  // (herkes görsün). state'i diff'leyip yeni seçimleri yakalıyoruz.
  if (state.phase === 'lobby') handleLobbySelectAnims(state);
  else lobbyCharSnapshot = null; // lobiden çıktık; baz durumu sıfırla
}

function renderLobby(state, amHost, me) {
  // Oyuncu KARTLARI: isim üstte (başlık), büyük karakter görseli ortada, host tacı
  // + Hazır/Bekliyor durumu net biçimde. Yatay büyük kartlar (dar ekranda sarar).
  const players = state.players
    .map((p) => {
      const status = !p.connected ? '(koptu)' : p.ready ? 'Hazır ✔' : 'Bekliyor…';
      const cardCls = !p.connected ? 'pcOff' : p.ready ? 'pcReady' : 'pcWaiting';
      return `
    <div class="playerCard ${cardCls}" data-pid="${p.id}">
      <div class="pcName">${p.isHost ? '<span class="pcCrown">👑</span> ' : ''}${esc(p.nickname)}</div>
      ${avatarHTML(state, p.characterId, 'avatar-pc')}
      <div class="pcStatus">${status}</div>
    </div>`;
    })
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

  // Oyun havuzu: host hangi minigame'lerin round'larda düşeceğini seçer (en az 1 açık).
  // Host olmayanlar sadece seçili olanları görür (tıklanamaz).
  const enabled = new Set(state.enabledMinigames || []);
  const mgCells = (state.minigames || [])
    .map((m) => {
      const on = enabled.has(m.id);
      return `<button class="mgCell ${on ? 'on' : 'off'}" data-mg="${m.id}" ${amHost ? '' : 'disabled'} title="${esc(m.displayName)}">
        <span class="mgCheck">${on ? '✔' : ''}</span>
        <span class="mgName">${esc(m.displayName)}</span>
      </button>`;
    })
    .join('');
  const hasMgCatalog = Array.isArray(state.minigames) && state.minigames.length > 0;
  const mgHtml = hasMgCatalog
    ? `<div class="mgGrid">${mgCells}</div>
       <p class="hint">${amHost ? `Seçili oyunlardan rastgele round düşer (${enabled.size}/${state.minigames.length} açık, en az 1 gerekli).` : 'Havuzu host seçer.'}</p>`
    : '';

  const canReady = !!(me && me.characterId);
  const readyLabel = me && me.ready ? 'Hazır değilim' : 'Hazırım';
  return `
    <div class="rowbetween lobbyHead"><h2>Lobi</h2><span class="code">${state.code}</span></div>
    <div class="playerCards">${players}</div>

    <h3 class="charHeading">🎭 Karakterini seç</h3>
    ${gridHtml}
    <button id="readyBtn" class="primary wide" ${canReady ? '' : 'disabled'}>${readyLabel}</button>
    ${canReady ? '' : '<p class="hint charhint">⚠ Önce bir karakter seç — sonra “Hazırım”.</p>'}
    <p class="hint">${state.waitingFor.length ? 'Bekleniyor: ' + state.waitingFor.map(esc).join(', ') : 'Herkes hazır! Başlıyor…'}</p>

    <div class="lobbySettings">
      <div class="lobbySetRow">
        <span class="lobbySetLabel">Round sayısı${amHost ? '' : ' · host seçer'}</span>
        <span class="roundBtns">${rounds}</span>
      </div>
      <div class="lobbySetBlock">
        <span class="lobbySetLabel">Oyun havuzu${amHost ? '' : ' · host seçer'}</span>
        ${mgHtml}
      </div>
    </div>`;
}

function renderPlaying(state) {
  const mg = state.minigame;
  const renderer = minigameRenderers[mg.id];
  // renderer'a state'i de veriyoruz (Kelime Casusu oyuncu portrelerini state.characters +
  // player.characterId'den çiziyor; diğer renderer'lar ikinci argümanı yok sayar).
  const inner = renderer ? renderer(mg.view, state) : `<p>Bilinmeyen minigame: ${esc(mg.id)}</p>`;
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
    if (amHost) {
      document.querySelectorAll('.roundBtn').forEach((b) => {
        b.onclick = () => send('lobby:setRounds', { rounds: Number(b.dataset.rounds) });
      });
      // Oyun havuzu: tıklayınca o oyunun açık/kapalı durumunu ters çevir.
      document.querySelectorAll('.mgCell').forEach((b) => {
        b.onclick = () =>
          send('lobby:toggleMinigame', { id: b.dataset.mg, enabled: !b.classList.contains('on') });
      });
    }
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

// ---------------- Lobi karakter SEÇİM animasyonu ----------------
// Kareler PixelLab ile üretildi (TÜM 8 karaktere aynı "zıpla + el kaldır" aksiyonu).
// Her karakterin klasörü: characters/animations/<id>/frame_00..12.png (00 ve 12 = rest
// duruşu, first=last sabitlendiği için başladığı poza döner -> kesintisiz).
const SELECT_ANIM_IDS = [
  'petek', 'tuvalet', 'lamba', 'camasir-makinesi', 'duvar-saati', 'musluk', 'priz', 'cop-kutusu',
];
const SELECT_ANIMS = {};
SELECT_ANIM_IDS.forEach((id) => {
  SELECT_ANIMS[id] = { dir: `characters/animations/${id}`, frames: 13, fps: 20 };
});
let lobbyCharSnapshot = null;        // playerId -> characterId (bir önceki lobi render'ı)
const activeSelectAnims = {};        // playerId -> { timer, overlay }

function frameSrc(anim, i) {
  return `${anim.dir}/frame_${String(i).padStart(2, '0')}.png`;
}
// Kareleri önden yükle (seçim anında takılmasın/titremesin).
(function preloadSelectAnims() {
  for (const id in SELECT_ANIMS) {
    const a = SELECT_ANIMS[id];
    for (let i = 0; i < a.frames; i++) new Image().src = frameSrc(a, i);
  }
})();

// Lobi render'ları arasında karakter seçimlerini diff'le; YENİ bir seçim (null/başka
// -> yeni karakter) olan her oyuncunun kartında animasyonu tetikle. İlk lobi render'ı
// (snapshot yok) sadece baz alınır — mevcut seçimler için animasyon oynatılmaz.
function handleLobbySelectAnims(state) {
  const prev = lobbyCharSnapshot;
  const next = {};
  for (const p of state.players) next[p.id] = p.characterId || null;
  if (prev) {
    for (const p of state.players) {
      const before = prev[p.id]; // yeni katılan oyuncuda undefined
      const after = next[p.id];
      if (after && before !== undefined && after !== before) triggerSelectAnim(p.id, after);
    }
  }
  lobbyCharSnapshot = next;
}

// Kartın avatarı üzerinde animasyonu bir kez oynat. Overlay body'ye eklenir (lobi
// yeniden çizilse bile animasyon bozulmaz); karesi bitince kendini kaldırır ve kart
// yine statik rest duruşunu gösterir (frame_00 == son kare == rest, kesintisiz).
function triggerSelectAnim(playerId, charId) {
  const anim = SELECT_ANIMS[charId];
  if (!anim) return;
  const card = document.querySelector(`.playerCard[data-pid="${playerId}"]`);
  const avatar = card && card.querySelector('.avatar-pc');
  if (!avatar) return;
  const rect = avatar.getBoundingClientRect();
  if (!rect.width) return;
  cancelSelectAnim(playerId); // aynı oyuncuda önceki animasyon varsa iptal et

  const overlay = document.createElement('img');
  overlay.className = 'select-anim';
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.src = frameSrc(anim, 0);
  document.body.appendChild(overlay);

  let i = 0;
  const timer = setInterval(() => {
    i += 1;
    if (i >= anim.frames) return cancelSelectAnim(playerId);
    overlay.src = frameSrc(anim, i);
  }, 1000 / anim.fps);
  activeSelectAnims[playerId] = { timer, overlay };
}
function cancelSelectAnim(playerId) {
  const a = activeSelectAnims[playerId];
  if (!a) return;
  clearInterval(a.timer);
  if (a.overlay && a.overlay.parentNode) a.overlay.parentNode.removeChild(a.overlay);
  delete activeSelectAnims[playerId];
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

// ---------------- Hassas Duruş yardımcıları ----------------
// Üçgen dalga (server'daki _posAt ile AYNI): 0->1->0 ping-pong.
function trianglePos(speed, tSec) {
  let ph = (speed * tSec) % 2;
  if (ph < 0) ph += 2;
  return ph <= 1 ? ph : 2 - ph;
}
// Server'ın elapsedMs'ini yerel performance.now() ile eşle (saat farkını atlatır).
function capturePbSync(view) {
  const me = view && view.players ? view.players[myId] : null;
  if (!me) { pbSync = null; return; }
  pbSync = { elapsedMs: me.phase === 'moving' ? me.elapsedMs || 0 : 0, atPerf: performance.now() };
}
function stopPrecisionAnim() {
  if (pbRaf) { cancelAnimationFrame(pbRaf); pbRaf = null; }
  pbMounted = false;
  pbSync = null;
  pbShownAttempts = -1;
}
// Çizgiyi her karede oynat: pozisyonu currentState + pbSync'ten hesapla (server'a
// güvenmiyoruz; bu SADECE görsel — puanı server veriyor).
function startPrecisionAnim() {
  if (pbRaf) cancelAnimationFrame(pbRaf);
  const frame = () => {
    pbRaf = requestAnimationFrame(frame);
    const s = currentState;
    if (!s || !s.minigame || s.minigame.id !== 'precision-bar') return;
    const me = s.minigame.view.players[myId];
    const line = document.getElementById('pbLine');
    if (!me || !line) return;
    let pos;
    if (me.phase === 'moving' && pbSync) {
      const elapsed = pbSync.elapsedMs + (performance.now() - pbSync.atPerf);
      pos = trianglePos(me.speed, elapsed / 1000);
    } else {
      pos = me.lastPos != null ? me.lastPos : me.linePos != null ? me.linePos : 0.5;
    }
    line.style.left = pos * 100 + '%';
    line.classList.toggle('pb-line-stopped', me.phase === 'result');
  };
  pbRaf = requestAnimationFrame(frame);
}
// Broadcast geldikçe HUD'u yerinde güncelle; bar/çizgi DOM'una dokunma.
function updatePrecisionBar(state) {
  const view = state.minigame.view;
  const me = view.players[myId];
  setText('#pbTimer', `⏱ ${Math.ceil(view.timeLeftMs / 1000)}s`);
  if (!me) return;
  setText('#pbScore', me.score);
  setText('#pbAttempts', me.attempts);
  // Yeni bir deneme sonuçlandıysa "+puan" baloncuğunu göster.
  if (me.attempts !== pbShownAttempts) {
    pbShownAttempts = me.attempts;
    if (me.phase === 'result' && me.lastPos != null) showPbFloat(me);
  }
  capturePbSync(view); // animasyon senkronunu tazele (saniyede bir baz noktası)
}
function showPbFloat(me) {
  const float = document.getElementById('pbFloat');
  if (!float) return;
  const suffix = me.lastPoints >= 10 ? '! 🎯' : me.lastPoints >= 5 ? '!' : '';
  float.textContent = (me.lastPoints > 0 ? '+' : '') + me.lastPoints + suffix;
  float.style.left = me.lastPos * 100 + '%';
  float.className = 'pb-float pb-float-t' + me.lastTier;
  void float.offsetWidth; // reflow: animasyonu baştan tetikle
  float.classList.add('show');
}

// ---------------- Kırmızı Buton yardımcısı ----------------
// Ekran geneli senkron patlama efekti. #game her broadcast'te yeniden çizildiği
// için overlay/shake'i BODY üzerinde yapıyoruz (redraw'dan etkilenmesin), animasyon
// bitince temizliyoruz.
function triggerRedButtonBoom() {
  document.body.classList.remove('rb-shake');
  void document.body.offsetWidth; // reflow: shake'i baştan tetikle
  document.body.classList.add('rb-shake');
  const boom = document.createElement('div');
  boom.className = 'rb-boom';
  boom.innerHTML = '<span>💥 BOM! 💥</span>';
  document.body.appendChild(boom);
  setTimeout(() => {
    boom.remove();
    document.body.classList.remove('rb-shake');
  }, 1150);
}

// ---------------- Zaman Vurucu yardımcıları ----------------
function stopTtRaf() {
  if (ttRaf) { cancelAnimationFrame(ttRaf); ttRaf = null; }
}
function stopTimeTargetAnim() {
  stopTtRaf();
  ttMounted = false;
  ttStructKey = '';
  ttSync = null;
}
// İlk 3 sn sayaç (client-lokal); 3 sn dolunca sayaç gizlenir, "hissine güven" mesajı çıkar.
// Not: geçen süre server'dan GELMEZ (sızmasın); mount anı round başı sayılır.
function startTimeTargetAnim() {
  stopTtRaf();
  const frame = () => {
    ttRaf = requestAnimationFrame(frame);
    const s = currentState;
    if (!s || !s.minigame || s.minigame.id !== 'time-target') return;
    const view = s.minigame.view;
    if (view.phase !== 'playing' || (view.you && view.you.pressed) || !ttSync) return;
    const counter = document.getElementById('ttCounter');
    const hidden = document.getElementById('ttHidden');
    if (!counter || !hidden) return;
    const elapsed = performance.now() - ttSync.atPerf;
    if (elapsed < view.visibleMs) {
      counter.classList.remove('hidden');
      hidden.classList.add('hidden');
      counter.textContent = (elapsed / 1000).toFixed(2);
    } else {
      counter.classList.add('hidden');
      hidden.classList.remove('hidden');
    }
  };
  ttRaf = requestAnimationFrame(frame);
}
// Yapı değişmeden gelen broadcast'lerde (ör. başkası bastı) sadece "X/Y bastı"yı tazele.
function updateTimeTarget(state) {
  const view = state.minigame.view;
  const el = document.querySelector('.tt-arena');
  if (el) {
    const score = document.querySelector('.ar-hud .ar-score');
    if (score) score.textContent = `${view.pressedCount}/${view.total} bastı`;
  }
}
