// Perfil da pessoa e animais monitorados. Funções puras (testadas em tests/animals.test.mjs).
//
// Dados antigos (antes da plataforma multi-animal) não têm animalId: pertencem ao Simut,
// que usa o id fixo "simut". Assim dois aparelhos migrando offline geram o mesmo animal
// e nada se duplica na nuvem. A migração acontece só na leitura: nada é apagado nem reescrito.

export const LEGACY_ANIMAL_ID = "simut";
export const LEGACY_ANIMAL = Object.freeze({
  id: LEGACY_ANIMAL_ID, species: "cao", name: "Simut", breed: "Shih Tzu",
  age: { years: 12 }, sex: "macho", sensors: [{ name: "Persono-8154CC", since: 0 }],
});

export const SPECIES = { cao: "Cão", gato: "Gato", outro: "Outro" };

// "a-<base36 ms>-<4 aleatórios>"
export function newAnimalId(now = Date.now(), rand = Math.random) {
  let tail = "";
  for (let i = 0; i < 4; i++) tail += Math.floor(rand() * 36).toString(36);
  return `a-${now.toString(36)}-${tail}`;
}

// Animal dono de um sync ({animalId}) ou de uma marcação ({a}); ausente = legado.
export const effectiveAnimalId = (item) => item?.animalId ?? item?.a ?? LEGACY_ANIMAL_ID;

export const syncsFor = (syncs, animalId) => syncs.filter((s) => effectiveAnimalId(s) === animalId);
export const marksFor = (marks, animalId) => marks.filter((m) => (m.a ?? LEGACY_ANIMAL_ID) === animalId);

// Limiares são do animal (calibração), o resto é do sensor (global).
export function effectiveSettings(global, animal) {
  const c = animal?.calibration || {};
  const out = { ...global };
  for (const k of ["tLight", "tVig"]) if (Number.isFinite(c[k])) out[k] = c[k];
  return out;
}

export const findAnimal = (animals, id) => animals.find((a) => a.id === id) || null;

// Animal ao qual o sensor (nome BLE) está associado, ou null.
export function findBySensor(animals, name) {
  if (!name) return null;
  return animals.find((a) => !a.archived && (a.sensors || []).some((s) => s.name === name)) || null;
}

// Migração local (pura). Entrada: o que está guardado neste aparelho.
// Saída: { animals, profile, hasLegacyData, changed }.
export function migrateLocal({ syncs = [], marks = [], animals = [], profile = null, hasCloudKey = false, now = Date.now() } = {}) {
  const hasLegacyData = syncs.length > 0 || marks.length > 0 || !!hasCloudKey;
  const out = animals.map((a) => ({ ...a }));
  let changed = false;
  if (hasLegacyData && !out.some((a) => a.id === LEGACY_ANIMAL_ID)) {
    const ids = syncs.map((s) => Number(s.id)).filter(Number.isFinite);
    const createdAt = ids.length ? Math.min(...ids) : now;
    out.unshift({
      ...LEGACY_ANIMAL,
      age: { ...LEGACY_ANIMAL.age },
      sensors: LEGACY_ANIMAL.sensors.map((s) => ({ ...s })),
      createdAt, updatedAt: createdAt,
    });
    changed = true;
  }
  return { animals: out, profile, hasLegacyData, changed };
}

// Idade legível: { years, months } ou { birthDate }.
export function ageInMonths(age, now = Date.now()) {
  if (!age) return null;
  if (age.birthDate) {
    const b = new Date(`${age.birthDate}T12:00:00`);
    if (Number.isNaN(b.getTime())) return null;
    const n = new Date(now);
    let m = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
    if (n.getDate() < b.getDate()) m--;
    return Math.max(0, m);
  }
  const y = Number(age.years) || 0, mo = Number(age.months) || 0;
  return y || mo ? y * 12 + mo : null;
}

export function ageLabel(age, now = Date.now()) {
  const m = ageInMonths(age, now);
  if (m === null) return "";
  const approx = age.birthDate ? "" : "cerca de ";
  if (m < 12) return `${approx}${m} ${m === 1 ? "mês" : "meses"}`;
  const y = Math.floor(m / 12);
  return `${approx}${y} ${y === 1 ? "ano" : "anos"}`;
}

export function breedLabel(breed) {
  if (breed === "srd") return "SRD";
  if (breed === "mestico") return "Mestiço";
  return breed || "";
}

// "Cão, Shih Tzu, 12 anos" (sem partes desconhecidas)
export function animalSubtitle(a, now = Date.now()) {
  const sp = a.species === "outro" ? (a.speciesOther || SPECIES.outro) : SPECIES[a.species] || "";
  const age = ageLabel(a.age, now).replace(/^cerca de /, "");
  return [sp, breedLabel(a.breed), age].filter(Boolean).join(", ");
}
