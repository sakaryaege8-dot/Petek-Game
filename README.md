# Parti Minigame Koleksiyonu — İskelet

Tarayıcıdan, aynı ağdaki arkadaşlarla oynanan, Pummel Party tarzı multiplayer
minigame koleksiyonu. **Bu aşama sadece iskelet:** lobi + oda sistemi + round
döngüsü + skorlama + kazanan ekranı. Gerçek minigame'ler yerine, butona basınca
rastgele skor üreten bir **placeholder** var (tüm döngüyü test etmek için).

## Gereksinimler
- Node.js 18+ (test edildiği sürüm: v24). npm.

## Kurulum & Çalıştırma
```bash
cd party-minigames
npm install
npm start
```
Ardından tarayıcıda: **http://localhost:3000**

Farklı bir port için: `PORT=4000 npm start`

## Birden fazla sekmeyle test (tek bilgisayar)
1. `npm start` ile sunucuyu başlat.
2. **2–4 tarayıcı sekmesi** aç, hepsinde `http://localhost:3000`.
   (İpucu: gerçek çok-oyunculuyu daha iyi taklit etmek için bir kısmını gizli/
   incognito pencerede aç — böylece ayrı oturum olurlar.)
3. **Sekme 1:** takma ad yaz → **Yeni Oda Kur**. Ekranda 4 harflik **oda kodu** çıkar.
4. **Diğer sekmeler:** takma ad + oda kodu → **Katıl**.
5. **Host** (👑, ilk giren) round sayısını seçer (3 / 5 / 7).
6. Herkes **Hazırım**'a basınca oyun başlar (tek kişiyle de başlayabilir — solo test için).
7. Placeholder round'da herkes **Skor Üret!**'e basar → round biter.
8. **Round sonucu:** o round'un sıralaması + genel skor tablosu. Otomatik geçiş yok;
   herkes **Hazırım**'a basınca sıradaki round başlar. Kimin beklendiği altta yazar.
9. Son round bitince **final tablosu + kazanan** ekranı. Host **Lobiye Dön** ile yeni oyun açar.

## Aynı ağdaki arkadaşlarla test (LAN)
1. Sunucunun çalıştığı bilgisayarın **yerel IP**'sini bul:
   - Windows: `ipconfig` → "IPv4 Address" (ör. `192.168.1.23`)
2. Arkadaşların aynı Wi-Fi/ağdayken tarayıcıdan: `http://192.168.1.23:3000`
3. Windows Güvenlik Duvarı ilk çalıştırmada Node.js için izin sorabilir → **İzin ver**.

## Bağlantı kopması davranışı
- Bir sekme kapanır/koparsa oyun **kilitlenmez**: hazır-kapıları sadece bağlı
  oyuncuları bekler.
- **Host** düşerse host, odadaki en eski bağlı oyuncuya **otomatik devredilir**.
- Oyuncu **round ortasında** düşerse beklenmez; o ana kadarki skoru **korunur**.
- Aynı **oda kodu + aynı takma ad** ile geri girince slot geri alınır (yeniden bağlanma).
- Oda tamamen boşalınca kapatılır.

## Mimari (özet)
- **Server-authoritative:** tüm oyun state'i server'daki `Room` nesnesinde. Client
  sadece input yollar, `room:state` broadcast'ini çizer.
- **Backend:** Node.js + Express (statik dosya) + Socket.io (gerçek zamanlı, oda mantığı).
- **Frontend:** vanilla HTML/CSS/JS, build step yok.

```
server/
  index.js            Express + Socket.io kablolama, olay yönlendirme
  RoomManager.js      Odalar, benzersiz kod üretimi, katılma/yeniden bağlanma
  Room.js             Durum makinesi (lobby/playing/roundResult/gameOver), skorlama bağlama
  scoring.js          Sıralama puanı (tie-aware)
  minigames/
    Minigame.js       Kontrat (base class + dokümantasyon)
    registry.js       register / pickRandom(excludeId)
    index.js          Minigame'lerin kaydedildiği yer
    PlaceholderGame.js  Örnek/geçici minigame
public/
  index.html, styles.css, client.js
```

## Yeni bir minigame nasıl eklenir (sonraki oturumlar)
1. `server/minigames/` altında `Minigame`'den türeyen bir class yaz:
   ```js
   import Minigame from './Minigame.js';
   export default class OkTusuYarisi extends Minigame {
     static id = 'ok-tusu';
     static displayName = 'Ok Tuşu Yarışı';
     start() { /* ctx.players, timer kur */ }
     handleInput(playerId, input) { /* ... */ }
     getView() { return { /* client'a gidecek state */ }; }
     onPlayerLeave(playerId) { /* beklemeyi bırak, skoru koru */ }
     stop() { /* timer temizle */ }
     // bittiğinde: this.ctx.end({ [playerId]: rawScore, ... })  (yüksek = iyi)
   }
   ```
2. `server/minigames/index.js` içinde import edip `register(OkTusuYarisi)` ekle.
3. `public/client.js` içindeki `minigameRenderers`'a `'ok-tusu'(view){...}` çizicisini,
   gerekiyorsa `bindMinigame`'e buton bağlamasını ekle.

Bu kadar — Room döngüsü, skorlama ve round sonucu ekranları otomatik çalışır.

## Kontrat detayı
- `ctx.players`: `[{ id, nickname }]` — round başındaki katılımcılar (sabit).
- `ctx.random()`: 0..1 arası sayı.
- `ctx.broadcastView()`: view değişince tüm oyunculara güncel state yollar.
- `ctx.end(rawScores)`: minigame biter. `rawScores` = `{ [playerId]: sayı }`, yüksek = iyi.
  Room bunu sıralama puanına çevirir (N oyuncu → 1.'ye N, sonuncuya 1; beraberlikte
  ikisi de üst puanı alır) ve round sonucu ekranına geçer.
