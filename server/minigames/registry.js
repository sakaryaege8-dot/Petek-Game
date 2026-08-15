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

// Rastgele bir minigame seç. Mümkünse bir önceki round'da oynanan (excludeId)
// arka arkaya tekrar seçilmez. Havuzda tek minigame varsa yine onu döndürür.
export function pickRandom(excludeId) {
  let pool = registry;
  if (registry.length > 1 && excludeId) {
    pool = registry.filter((c) => c.id !== excludeId);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
