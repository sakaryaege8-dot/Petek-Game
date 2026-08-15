// Type Race kelime havuzu — yaygın, günlük Türkçe kelimeler (4-8 harf).
// Genişletmek için sona kelime eklemen yeterli (4-8 harf, günlük kullanım öner).
// Not: karşılaştırma Türkçe karakter farkını yok sayar (ı/i, ş/s, ç/c, ö/o, ü/u, ğ/g),
// o yüzden burada kelimeleri DOĞRU Türkçe yazımıyla tut; ekranda böyle gösterilir.
export const TURKISH_WORDS = [
  // yiyecek-içecek
  'elma', 'armut', 'çilek', 'kiraz', 'karpuz', 'kavun', 'portakal', 'şeftali', 'kayısı', 'erik',
  'incir', 'üzüm', 'domates', 'biber', 'patlıcan', 'soğan', 'sarımsak', 'havuç', 'patates', 'ıspanak',
  'marul', 'maydanoz', 'peynir', 'zeytin', 'yumurta', 'ekmek', 'simit', 'poğaça', 'börek', 'köfte',
  'tavuk', 'balık', 'pilav', 'çorba', 'makarna', 'tatlı', 'baklava', 'şeker', 'reçel', 'kahve',
  'ayran', 'limon', 'salça', 'pirinç', 'mercimek', 'nohut', 'fasulye', 'bulgur', 'yoğurt', 'kaymak',
  // ev eşyaları
  'kalem', 'kitap', 'defter', 'silgi', 'cetvel', 'masa', 'sandalye', 'koltuk', 'dolap', 'yatak',
  'yorgan', 'yastık', 'çarşaf', 'perde', 'halı', 'kilim', 'lamba', 'ampul', 'priz', 'tabak',
  'bardak', 'kaşık', 'çatal', 'bıçak', 'tencere', 'tava', 'kapı', 'pencere', 'anahtar', 'kilit',
  'ayna', 'tarak', 'havlu', 'sabun', 'şampuan', 'fırça', 'makas', 'iğne', 'iplik', 'düğme',
  'çamaşır', 'süpürge', 'kova', 'paspas',
  // doğa - zaman
  'güneş', 'yıldız', 'gökyüzü', 'bulut', 'yağmur', 'rüzgar', 'fırtına', 'deniz', 'nehir', 'dere',
  'orman', 'ağaç', 'yaprak', 'çiçek', 'papatya', 'lale', 'toprak', 'çimen', 'köprü', 'sokak',
  'cadde', 'meydan', 'bahçe', 'park', 'sabah', 'akşam', 'gece', 'öğle', 'hafta', 'mevsim',
  'ilkbahar', 'sonbahar', 'bugün', 'yarın', 'zaman', 'saat', 'dakika', 'tepe', 'sahil',
  // hayvanlar
  'kedi', 'köpek', 'tavşan', 'aslan', 'kaplan', 'maymun', 'zürafa', 'zebra', 'kurt', 'tilki',
  'sincap', 'fare', 'balina', 'yunus', 'kartal', 'baykuş', 'horoz', 'ördek', 'inek', 'koyun',
  'keçi', 'eşek', 'deve', 'karınca', 'kelebek', 'örümcek', 'yılan', 'kurbağa',
  // vücut
  'kirpik', 'burun', 'ağız', 'dudak', 'kulak', 'yanak', 'çene', 'boyun', 'omuz', 'alın',
  'dirsek', 'bilek', 'parmak', 'tırnak', 'göğüs', 'karın', 'sırt', 'bacak', 'ayak', 'topuk',
  'kalp', 'beyin', 'ciğer',
  // nesneler - meslekler - okul
  'para', 'cüzdan', 'çanta', 'şemsiye', 'gözlük', 'telefon', 'radyo', 'kamera', 'fotoğraf', 'resim',
  'tablo', 'müzik', 'şarkı', 'gitar', 'piyano', 'keman', 'davul', 'oyun', 'oyuncak', 'bebek',
  'balon', 'uçurtma', 'bisiklet', 'araba', 'otobüs', 'tren', 'uçak', 'gemi', 'vapur', 'bilet',
  'yolcu', 'şoför', 'doktor', 'hemşire', 'öğretmen', 'öğrenci', 'asker', 'polis', 'pilot', 'berber',
  'terzi', 'fırın', 'market', 'manav', 'kasap', 'eczane', 'hastane', 'okul', 'sınıf', 'ders',
  'sınav', 'tahta', 'harita', 'bayrak', 'mektup', 'zarf', 'gazete', 'dergi', 'roman', 'hikaye',
  'masal', 'şiir',
  // renkler
  'beyaz', 'siyah', 'kırmızı', 'mavi', 'yeşil', 'sarı', 'turuncu', 'pembe', 'lacivert',
  // aile - insanlar
  'anne', 'baba', 'kardeş', 'abla', 'ağabey', 'teyze', 'hala', 'amca', 'dayı', 'dede',
  'nine', 'torun', 'gelin', 'damat', 'komşu', 'arkadaş', 'misafir', 'çocuk', 'insan', 'kadın',
  'erkek', 'adam', 'millet',
];
