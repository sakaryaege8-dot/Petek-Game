// Minigame kayıt defteri.
// index.js buraya minigame class'larını register eder; Room round başında
// pickRandom ile rastgele birini seçer.
const registry = [];

export function register(cls) {
  if (!registry.some((c) => c.id === cls.id)) registry.push(cls);
}

export function count() {
  return registry.length;
}

// Kayıtlı tüm minigame'lerin kataloğu (lobide seçim ekranı için).
export function list() {
  return registry.map((c) => ({ id: c.id, displayName: c.displayName }));
}

// Rastgele bir minigame seç. Mümkünse bir önceki round'da oynanan (excludeId)
// arka arkaya tekrar seçilmez. enabledIds verilirse SADECE o havuzdan seçilir
// (lobide host'un seçtiği oyunlar). Seçili havuzda tek oyun varsa yine onu döndürür.
export function pickRandom(excludeId, enabledIds) {
  let pool = registry;
  if (enabledIds) {
    const set = enabledIds instanceof Set ? enabledIds : new Set(enabledIds);
    const filtered = registry.filter((c) => set.has(c.id));
    if (filtered.length > 0) pool = filtered; // boşsa güvenlik için tüm havuza düş
  }
  if (pool.length > 1 && excludeId) {
    const noRepeat = pool.filter((c) => c.id !== excludeId);
    if (noRepeat.length > 0) pool = noRepeat;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
