import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import RoomManager from './RoomManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const io = new Server(server);
const manager = new RoomManager(io);

// Statik frontend (public/) ve socket.io client'ı aynı porttan sunulur.
// no-store: geliştirme sırasında tarayıcı ESKİ client.js/styles.css'i önbellekten
// göstermesin; her açılışta güncel dosya çekilsin (aksi halde "güncelledim ama
// tarayıcı eskisini gösteriyor" sorunları yaşanıyor).
app.use(
  express.static(join(__dirname, '..', 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

io.on('connection', (socket) => {
  // Bir oyuncuyu odaya bağla: socket.io room'una katıl, kimliğini bildir, state yolla.
  const attach = (room, player) => {
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    socket.emit('room:joined', { playerId: player.id, roomCode: room.code });
    room.broadcast();
  };

  // Bu soket zaten bir odaya bağlıysa ilgili Room + playerId ile işlemi çalıştır.
  const withRoom = (fn) => {
    const room = manager.get(socket.data.roomCode);
    if (!room || !socket.data.playerId) return;
    fn(room, socket.data.playerId);
  };

  socket.on('room:create', ({ nickname } = {}) => {
    if (!nickname || !nickname.trim())
      return socket.emit('room:error', { message: 'Takma ad gerekli.' });
    const { room, player } = manager.create(nickname.trim(), socket.id);
    attach(room, player);
  });

  socket.on('room:join', ({ roomCode, nickname } = {}) => {
    const code = (roomCode || '').trim().toUpperCase();
    const res = manager.join(code, (nickname || '').trim(), socket.id);
    if (res.error) return socket.emit('room:error', { message: res.error });
    attach(res.room, res.player);
  });

  socket.on('lobby:setRounds', ({ rounds } = {}) =>
    withRoom((room, pid) => room.setRounds(pid, Number(rounds)))
  );
  socket.on('lobby:toggleMinigame', ({ id, enabled } = {}) =>
    withRoom((room, pid) => room.setMinigameEnabled(pid, id, !!enabled))
  );
  socket.on('lobby:selectCharacter', ({ characterId } = {}) =>
    withRoom((room, pid) => room.selectCharacter(pid, characterId ?? null))
  );
  socket.on('lobby:toggleReady', () => withRoom((room, pid) => room.setReady(pid)));
  socket.on('round:toggleReady', () => withRoom((room, pid) => room.setRoundReady(pid)));
  socket.on('game:input', (input) => withRoom((room, pid) => room.handleInput(pid, input)));
  socket.on('game:returnToLobby', () => withRoom((room, pid) => room.returnToLobby(pid)));

  socket.on('disconnect', () => withRoom((room, pid) => room.handleDisconnect(pid)));
});

const PORT = process.env.PORT || 3000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[HATA] ${PORT} portu zaten kullanimda.`);
    console.error('Muhtemelen sunucu baska bir pencerede hala calisiyor.');
    console.error('Cozum 1: Acik olan diger sunucuyu kapat (o pencerede Ctrl+C).');
    console.error(`Cozum 2: Farkli bir port kullan:  set PORT=3001 && npm start   (PowerShell: $env:PORT=3001; npm start)`);
    console.error(`Cozum 3 (Windows): portu tutan sureci bul ve kapat:  netstat -ano | findstr :${PORT}\n`);
    process.exit(1);
  }
  console.error('[HATA] Sunucu baslatilamadi:', err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Parti minigame sunucusu calisiyor: http://localhost:${PORT}`);
  console.log('Ayni agdaki arkadaslarin icin: http://<bu-bilgisayarin-LAN-IP>:' + PORT);
});
