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

// ---------- junção com a nuvem (último a editar vence, por documento) ----------
const stamp = (x) => Number(x?.updatedAt) || 0;

// Junta animais locais e remotos por id. Devolve a lista final e os que precisam subir
// (só existem aqui ou são mais novos aqui). Ordem: locais primeiro, depois os que só existem lá.
export function mergeAnimals(local = [], remote = []) {
  const rById = new Map(remote.filter((a) => a?.id).map((a) => [a.id, a]));
  const animals = [], toPush = [];
  const seen = new Set();
  for (const l of local) {
    if (!l?.id || seen.has(l.id)) continue;
    seen.add(l.id);
    const r = rById.get(l.id);
    if (!r || stamp(l) > stamp(r)) { animals.push(l); toPush.push(l); }
    else if (stamp(r) > stamp(l)) animals.push(r);
    else animals.push(l);
  }
  for (const r of remote) if (r?.id && !seen.has(r.id)) { seen.add(r.id); animals.push(r); }
  return { animals, toPush };
}

// Perfil: o mais novo vence. push = o local precisa subir.
export function mergeProfile(local = null, remote = null) {
  if (!local && !remote) return { profile: null, push: false };
  if (!remote) return { profile: local, push: true };
  if (!local) return { profile: remote, push: false };
  if (stamp(local) > stamp(remote)) return { profile: local, push: true };
  return { profile: stamp(remote) > stamp(local) ? remote : local, push: false };
}

// ---------- respostas do onboarding <-> animal ----------
// As mesmas respostas servem para o onboarding e para editar o animal em Opções.

export const SEX_LABEL = { macho: "Macho", femea: "Fêmea", "nao-informar": "Prefiro não informar" };
export const ROUTINE = {
  environment: { label: "Ambiente", options: [["casa-quintal", "Casa com quintal"], ["apartamento", "Apartamento"], ["rural", "Sítio ou área rural"], ["outro", "Outro"]] },
  activity: { label: "Atividade", options: [["diario", "Passeia todo dia"], ["alguns-dias", "Passeia alguns dias na semana"], ["raro", "Raramente sai"], ["solto", "Vive solto"]] },
  restPlace: { label: "Descanso", options: [["caminha", "Caminha própria"], ["cama-familia", "Cama ou sofá da família"], ["chao", "Chão"], ["varia", "Varia"]] },
};
export const routineLabel = (key, value) => (ROUTINE[key]?.options.find(([v]) => v === value) || [null, ""])[1];

export const BREEDS = {
  cao: ["Shih Tzu", "Yorkshire", "Poodle", "Lhasa Apso", "Spitz Alemão", "Golden Retriever", "Labrador", "Bulldog Francês", "Dachshund", "Border Collie"],
  gato: ["Persa", "Siamês", "Maine Coon", "Ragdoll", "Angorá", "Sphynx", "British Shorthair", "Bengal", "Himalaio", "Exótico"],
  outro: [],
};

// "12,5" ou "12.5" -> 12.5; vazio ou inválido -> null
export function parseDecimal(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Respostas (rascunho) a partir de um animal já cadastrado.
export function answersFromAnimal(a = {}) {
  const out = { species: a.species || null, speciesOther: a.speciesOther || "", name: a.name || "" };
  if (a.breed === "srd" || a.breed === "mestico") out.breedChoice = a.breed;
  else if (a.breed === null) out.breedChoice = "nao-sei";
  else out.breed = a.breed || "";
  if (a.age === null) out.ageUnknown = true;
  else if (a.age?.birthDate) { out.ageMode = "nasc"; out.birthDate = a.age.birthDate; }
  else if (a.age && (a.age.years || a.age.months)) {
    out.ageMode = "aprox";
    if (a.age.years) { out.ageValue = String(a.age.years); out.ageUnit = "anos"; } else { out.ageValue = String(a.age.months); out.ageUnit = "meses"; }
  }
  if (a.weightKg === null) out.weightUnknown = true;
  else if (Number.isFinite(a.weightKg)) out.weight = String(a.weightKg).replace(".", ",");
  if (a.sex) out.sex = a.sex;
  if (a.neutered === true) out.neutered = "sim";
  else if (a.neutered === false) out.neutered = "nao";
  else if (a.neutered === null) out.neutered = "nao-sei";
  const r = a.routine || {};
  for (const k of Object.keys(ROUTINE)) if (r[k]) out[k] = r[k];
  return out;
}

// Animal a partir das respostas. base: animal existente (mantém id, sensores, calibração, createdAt).
// Campos opcionais não respondidos ficam ausentes; "Não sei" vira null.
export function animalFromAnswers(ans = {}, base = {}, now = Date.now()) {
  const a = { ...base };
  a.species = ans.species || base.species || "outro";
  if (a.species === "outro" && String(ans.speciesOther || "").trim()) a.speciesOther = String(ans.speciesOther).trim().slice(0, 40);
  else delete a.speciesOther;
  a.name = String(ans.name || "").trim().slice(0, 60);

  if (ans.breedChoice === "srd" || ans.breedChoice === "mestico") a.breed = ans.breedChoice;
  else if (ans.breedChoice === "nao-sei") a.breed = null;
  else if (String(ans.breed || "").trim()) a.breed = String(ans.breed).trim().slice(0, 60);
  else delete a.breed;

  const n = parseDecimal(ans.ageValue);
  if (ans.ageUnknown) a.age = null;
  else if (ans.ageMode === "nasc" && /^\d{4}-\d{2}-\d{2}$/.test(ans.birthDate || "")) a.age = { birthDate: ans.birthDate };
  else if (ans.ageMode !== "nasc" && n !== null && n > 0) a.age = ans.ageUnit === "meses" ? { months: Math.round(n) } : { years: Math.round(n * 10) / 10 };
  else delete a.age;

  const w = parseDecimal(ans.weight);
  if (ans.weightUnknown) a.weightKg = null;
  else if (w !== null && w > 0) a.weightKg = Math.round(w * 10) / 10;
  else delete a.weightKg;

  if (ans.sex) a.sex = ans.sex; else delete a.sex;
  if (ans.sex === "macho" || ans.sex === "femea") {
    if (ans.neutered === "sim") a.neutered = true;
    else if (ans.neutered === "nao") a.neutered = false;
    else if (ans.neutered === "nao-sei") a.neutered = null;
    else delete a.neutered;
  } else delete a.neutered;

  const routine = {};
  for (const k of Object.keys(ROUTINE)) if (ans[k]) routine[k] = ans[k];
  if (Object.keys(routine).length) a.routine = routine; else delete a.routine;

  a.sensors = Array.isArray(base.sensors) ? base.sensors : [];
  a.createdAt = base.createdAt || now;
  a.updatedAt = now;
  return a;
}

// ---------- sensor e animal (plano, 3.3) ----------
export const hasSensor = (animal, name) => !!name && (animal?.sensors || []).some((s) => s.name === name);

// Associa o sensor ao animal (sem duplicar). Devolve um novo animal.
export function associateSensor(animal, name, now = Date.now()) {
  if (!name || hasSensor(animal, name)) return animal;
  return { ...animal, sensors: [...(animal.sensors || []), { name, since: now }], updatedAt: now };
}

// Remove a associação (os downloads continuam com o animal que tinham).
export function dissociateSensor(animal, name, now = Date.now()) {
  if (!hasSensor(animal, name)) return animal;
  return { ...animal, sensors: animal.sensors.filter((s) => s.name !== name), updatedAt: now };
}

// O que fazer ao sincronizar o sensor "name" no contexto do animal "animalId":
//   { action: "ok" }                 o sensor já é deste animal
//   { action: "associate" }          sensor sem dono: associar a este animal
//   { action: "conflict", owner }    sensor associado a outro animal: perguntar (nunca descartar o download)
export function sensorDecision(animals, name, animalId) {
  const me = findAnimal(animals, animalId);
  if (!name || hasSensor(me, name)) return { action: "ok" };
  const owner = animals.find((a) => a.id !== animalId && !a.archived && hasSensor(a, name)) || null;
  return owner ? { action: "conflict", owner } : { action: "associate" };
}
