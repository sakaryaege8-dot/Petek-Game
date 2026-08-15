// Seçilebilir karakterlerin SABİT kataloğu (server-authoritative).
// Görseller public/characters/<file> altında; client 'characters/<file>' ile çeker.
// Yeni karakter eklemek için: 1) public/characters/ içine PNG koy, 2) buraya bir satır ekle.
export const CHARACTERS = [
  { id: 'petek', name: 'Petek', file: 'petek.png' },
  { id: 'tuvalet', name: 'Tuvalet', file: 'tuvalet.png' },
  { id: 'lamba', name: 'Lamba', file: 'lamba.png' },
  { id: 'camasir-makinesi', name: 'Çamaşır Makinesi', file: 'camasir-makinesi.png' },
  { id: 'duvar-saati', name: 'Duvar Saati', file: 'duvar-saati.png' },
  { id: 'musluk', name: 'Musluk', file: 'musluk.png' },
  { id: 'priz', name: 'Priz', file: 'priz.png' },
  { id: 'cop-kutusu', name: 'Çöp Kutusu', file: 'cop-kutusu.png' },
];

const CHARACTER_IDS = new Set(CHARACTERS.map((c) => c.id));

export function isValidCharacter(id) {
  return CHARACTER_IDS.has(id);
}
