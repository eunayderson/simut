// Armazenamento local (IndexedDB). Cada sincronização guarda os pacotes brutos,
// para que a análise possa ser refeita quando a decodificação melhorar.

const DB = "simut";
// v2: syncs ganham campos opcionais (animalId, sensorName). O upgrade só garante o store;
// registros antigos ficam como estão e são migrados na leitura (ver animals.js).
const VERSION = 2;

export const BLOCKED_MESSAGE = "Outra aba do Simut está aberta com uma versão antiga. Feche as outras abas do Simut e recarregue.";

// Conexão única, reutilizada. Se outra aba pedir versão nova (versionchange), fecha na hora
// para não travar o upgrade dela; a próxima leitura reabre. Se uma aba antiga segurar a versão
// anterior (blocked), rejeita com mensagem clara em vez de ficar esperando para sempre.
let conn = null;
function open() {
  if (conn) return conn;
  let settled = false;
  conn = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("syncs")) db.createObjectStore("syncs", { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      const drop = () => { if (conn === p) conn = null; };
      db.onversionchange = () => { db.close(); drop(); };
      db.onclose = drop;
      if (settled) { db.close(); return; } // chegou depois do blocked: a próxima leitura abre de novo
      settled = true;
      resolve(db);
    };
    req.onerror = () => { settled = true; conn = null; reject(req.error); };
    req.onblocked = () => {
      if (settled) return;
      settled = true; conn = null;
      reject(new Error(BLOCKED_MESSAGE));
    };
  });
  const p = conn;
  return p;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction("syncs", mode);
    const out = fn(t.objectStore("syncs"));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

// sync: { id: ms, endAt: ms (hora do sensor no fim do download), source, packets: Uint8Array[],
//         sensor?: {info, status, clock}, animalId?: string (ausente = Simut), sensorName?: string }
export const saveSync = (sync) => tx("readwrite", (s) => s.put(sync));
export const clearAll = () => tx("readwrite", (s) => s.clear());

export async function loadSyncs() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction("syncs").objectStore("syncs").getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.id - b.id));
    req.onerror = () => reject(req.error);
  });
}

const SETTINGS_KEY = "simut.settings";
export const DEFAULT_SETTINGS = { hz: 32, epoch: 60, tLight: 40, tVig: 250, lsbPerG: 64 };

export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* modo privado */ }
}

// ---------- localStorage (JSON) ----------
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* modo privado */ }
}

// Perfil da pessoa: { name, createdAt, updatedAt, onboardingDone, onboardingFlow }
export const loadProfile = () => readJson("simut.profile", null);
export const saveProfile = (p) => writeJson("simut.profile", p);

// Animais: ver animals.js
export const loadAnimals = () => { const a = readJson("simut.animals", []); return Array.isArray(a) ? a : []; };
export const saveAnimals = (list) => writeJson("simut.animals", list);

export const loadLastAnimal = () => readJson("simut.lastAnimal", null);
export const saveLastAnimal = (id) => writeJson("simut.lastAnimal", id);

// Rascunho do onboarding: { flow, step, sub, answers, sessionId, startedAt }
export const loadDraft = () => readJson("simut.onboardingDraft", null);
export const saveDraft = (d) => writeJson("simut.onboardingDraft", d);
export const clearDraft = () => remove("simut.onboardingDraft");

// Eventos do onboarding (ver metrics.js)
export const loadOnboardingEvents = () => { const e = readJson("simut.onboardingEvents", []); return Array.isArray(e) ? e : []; };
export const saveOnboardingEvents = (list) => writeJson("simut.onboardingEvents", list);

export const loadNavCollapsed = () => readJson("simut.nav.collapsed", false) === true;
export const saveNavCollapsed = (v) => writeJson("simut.nav.collapsed", !!v);

// Último download, por animal. O valor antigo (simut.lastSync) pertence ao Simut.
const LAST_SYNC = "simut.lastSync";
export function getLastSync(animalId) {
  try {
    const v = localStorage.getItem(`${LAST_SYNC}.${animalId}`) ?? (animalId === "simut" ? localStorage.getItem(LAST_SYNC) : null);
    return v ? Number(v) : null;
  } catch { return null; }
}
export function setLastSync(animalId, t = Date.now()) {
  try { localStorage.setItem(`${LAST_SYNC}.${animalId}`, String(t)); } catch { /* modo privado */ }
}
// Copia o valor antigo para a chave do Simut (não apaga o antigo).
export function migrateLastSync() {
  try {
    const old = localStorage.getItem(LAST_SYNC);
    if (old && !localStorage.getItem(`${LAST_SYNC}.simut`)) localStorage.setItem(`${LAST_SYNC}.simut`, old);
  } catch { /* modo privado */ }
}
// Usado por "Apagar dados deste aparelho": remove os últimos downloads de todos os animais.
export function clearLastSyncs() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k === LAST_SYNC || k?.startsWith(`${LAST_SYNC}.`)) localStorage.removeItem(k);
    }
  } catch { /* modo privado */ }
}
