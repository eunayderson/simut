// Armazenamento local (IndexedDB). Cada sincronização guarda os pacotes brutos,
// para que a análise possa ser refeita quando a decodificação melhorar.

const DB = "simut";
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("syncs")) db.createObjectStore("syncs", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

// sync: { id: ms, endAt: ms (hora do sensor no fim do download), source, packets: Uint8Array[] }
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
