// Sıralamaya göre puanlama (tie-aware).
//
// Kural: N oyuncu varsa 1.'ye N puan, sonuncuya 1 puan verilir.
// Beraberlik durumunda beraber olanların hepsi ÜST sıranın puanını alır.
//
// Uygulama: her oyuncunun puanı = N - (kendisinden KESİNLİKLE yüksek skora
// sahip oyuncu sayısı). Bu, "standard competition ranking" (1-2-2-4) mantığı.
//
// Örnek: N=4, rawScores = {a:10, b:10, c:5, d:3}
//   a: kendinden yüksek 0 -> 4 puan
//   b: kendinden yüksek 0 -> 4 puan
//   c: kendinden yüksek 2 -> 2 puan
//   d: kendinden yüksek 3 -> 1 puan
export function awardPoints(rawScores, playerIds) {
  const n = playerIds.length;
  const points = {};
  for (const id of playerIds) {
    const mine = rawScores[id] ?? 0;
    let strictlyGreater = 0;
    for (const other of playerIds) {
      if ((rawScores[other] ?? 0) > mine) strictlyGreater++;
    }
    points[id] = n - strictlyGreater;
  }
  return points;
}
