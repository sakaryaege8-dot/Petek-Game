import Room from './Room.js';

// Karışması kolay karakterler (0/O, 1/I/L) çıkarıldı.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 4;

// Tüm odaları yönetir: oluşturma, benzersiz kod üretimi, katılma/yeniden bağlanma, temizlik.
export default class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> Room
  }

  _genCode() {
    let code;
    do {
      code = Array.from({ length: CODE_LEN }, () =>
        CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
      ).join('');
    } while (this.rooms.has(code));
    return code;
  }

  create(nickname, socketId) {
    const code = this._genCode();
    const room = new Room(code, this.io, (c) => this.destroy(c));
    this.rooms.set(code, room);
    const player = room.addPlayer(socketId, nickname);
    return { room, player };
  }

  join(code, nickname, socketId) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Oda bulunamadi.' };
    if (!nickname || !nickname.trim()) return { error: 'Takma ad gerekli.' };

    const existing = room.findByNickname(nickname);
    if (existing) {
      // Aynı isim bağlıysa çakışma; değilse bu bir yeniden bağlanmadır.
      if (existing.connected) return { error: 'Bu isim odada kullanimda.' };
      room.reconnect(existing, socketId);
      return { room, player: existing, reconnected: true };
    }

    // Yeni oyuncu ancak lobide katılabilir.
    if (room.phase !== 'lobby') return { error: 'Oyun basladi, yeni oyuncu katilamaz.' };
    const player = room.addPlayer(socketId, nickname);
    return { room, player };
  }

  get(code) {
    return this.rooms.get(code);
  }

  destroy(code) {
    this.rooms.delete(code);
  }
}
