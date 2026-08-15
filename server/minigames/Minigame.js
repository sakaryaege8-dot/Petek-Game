// Minigame KONTRATI (pluggable arayüz).
//
// Her minigame bu sınıftan türeyen server-side bir class'tır. Oyun mantığı
// tamamen server'da çalışır (server-authoritative); client sadece input yollar
// ve getView() ile dönen state'i çizer.
//
// Yeni bir minigame eklemek için:
//   1) Bu sınıftan türeyen bir class yaz (static id + displayName ver).
//   2) Aşağıdaki yaşam döngüsü metodlarını doldur.
//   3) minigames/index.js içinde register(...) ile kaydet.
//   4) İstersen public/client.js içindeki minigameRenderers'a bir çizici ekle.
//
// ctx (constructor'a Room tarafından verilir):
//   - players:  [{ id, nickname }]  -> round başındaki katılımcılar (sabit)
//   - random:   () => number        -> 0..1 arası (Math.random)
//   - broadcastView(): void         -> view değiştiğinde tüm oyunculara yeni state yolla
//   - end(rawScores): void          -> minigame bitti; { [playerId]: rawScore } ver
//                                       (yüksek skor = daha iyi). Room bunu sıralama
//                                       puanına çevirir ve round sonucuna geçer.
export default class Minigame {
  static id = 'base';
  static displayName = 'Base';

  constructor(ctx) {
    this.ctx = ctx;
    this.players = ctx.players; // round başındaki katılımcı listesi (sabit)
  }

  // Round başında bir kez çağrılır. Timer/state kurulumunu burada yap.
  start() {}

  // Bir oyuncudan input geldiğinde çağrılır.
  handleInput(playerId, input) {}

  // Client'a gidecek, minigame'e özel serialize edilebilir state.
  getView() {
    return {};
  }

  // Bir oyuncu round ORTASINDA bağlantısını kaybederse çağrılır.
  // (Genellikle: onu beklemeyi bırak; mevcut skorunu koru.)
  onPlayerLeave(playerId) {}

  // Round bittiğinde (normal ya da erken) temizlik için çağrılır.
  stop() {}
}
