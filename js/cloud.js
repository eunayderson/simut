// Nuvem (Firebase Firestore, plano gratuito). Sem login: o acesso é pela chave do Simut,
// um código secreto guardado só nos aparelhos (nunca no repositório).
// Estrutura (o nome "dogs" fica por compatibilidade, vale também para gatos e outros):
//   dogs/{chave}/syncs/{id}            -> { endAt, source, packets, chunks, sensor, at, animalId?, sensorName? }
//   dogs/{chave}/syncs/{id}/chunks/{i} -> { data: Bytes }  ([u16 tamanho][pacote] repetido)
//   dogs/{chave}/meta/marks            -> { list: [{t, s, a?}], at }
//   dogs/{chave}/meta/profile          -> { name, createdAt, updatedAt, onboardingDone, onboardingFlow }
//   dogs/{chave}/meta/onboarding       -> { events: [...], at }   (junta por id de evento, máximo 2000)
//   dogs/{chave}/animals/{animalId}    -> animal completo (ver animals.js)
// Documentos antigos nunca são reescritos: syncs só sobem quando não existem lá.

import { mergeMarkLists } from "./validation.js?v=10";
import { mergeAnimals, mergeProfile } from "./animals.js?v=10";
import { mergeEvents } from "./metrics.js?v=10";

const V = "11.0.2";
const CONFIG = {
  apiKey: "AIzaSyCy76rREDYIfGPCNS65LJIAD2Lb8w_UEus",
  authDomain: "simuts-b74ce.firebaseapp.com",
  projectId: "simuts-b74ce",
  storageBucket: "simuts-b74ce.firebasestorage.app",
  messagingSenderId: "554275378871",
  appId: "1:554275378871:web:e50193964ffbcb43ac1f32",
};
const CHUNK = 900_000;
const KEY_STORE = "simut.cloudKey";

let fs = null, db = null;

export function getKey() {
  const m = location.hash.match(/k=([A-Za-z0-9_-]{30,})/) || location.search.match(/[?&]k=([A-Za-z0-9_-]{30,})/);
  if (m) {
    try { localStorage.setItem(KEY_STORE, m[1]); } catch { /* ignore */ }
    history.replaceState(null, "", location.pathname);
    return m[1];
  }
  try { return localStorage.getItem(KEY_STORE); } catch { return null; }
}
export function setKey(k) { try { localStorage.setItem(KEY_STORE, k); } catch { /* ignore */ } }
export function forgetKey() { try { localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } }

async function init() {
  if (db) return;
  const app = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  db = fs.getFirestore(app.initializeApp(CONFIG));
}

const pack = (packets) => {
  const total = packets.reduce((a, p) => a + p.length + 2, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of packets) { out[o] = p.length & 0xff; out[o + 1] = p.length >> 8; out.set(p, o + 2); o += p.length + 2; }
  return out;
};
const unpack = (buf) => {
  const out = [];
  for (let i = 0; i + 2 <= buf.length;) {
    const n = buf[i] | (buf[i + 1] << 8); i += 2;
    if (!n || i + n > buf.length) break;
    out.push(buf.slice(i, i + n)); i += n;
  }
  return out;
};

async function cloudSyncIds(key) {
  const snap = await fs.getDocs(fs.collection(db, "dogs", key, "syncs"));
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

async function pushSync(key, sync) {
  const raw = pack(sync.packets);
  const chunks = [];
  for (let i = 0; i < raw.length; i += CHUNK) chunks.push(raw.subarray(i, i + CHUNK));
  const base = fs.doc(db, "dogs", key, "syncs", String(sync.id));
  // pacotes primeiro, metadado por último: só existe "sync completo" na nuvem se tudo subiu
  for (let i = 0; i < chunks.length; i++) {
    await fs.setDoc(fs.doc(base, "chunks", String(i)), { data: fs.Bytes.fromUint8Array(chunks[i]) });
  }
  await fs.setDoc(base, syncMeta(sync, chunks.length, Date.now()));
}

// Metadado do sync na nuvem. animalId e sensorName só entram quando existem (docs novos).
export function syncMeta(sync, chunks, at) {
  const meta = { endAt: sync.endAt, source: sync.source || "", packets: sync.packets.length, chunks, sensor: sync.sensor || null, at };
  if (sync.animalId) meta.animalId = sync.animalId;
  if (sync.sensorName) meta.sensorName = sync.sensorName;
  return meta;
}

// Sync local a partir do metadado e dos pacotes baixados (sem animalId = Simut, resolvido na leitura).
export function syncFromMeta(id, meta, packets) {
  const sync = { id: Number(id), endAt: meta.endAt, source: meta.source, sensor: meta.sensor || null, packets };
  if (meta.animalId) sync.animalId = meta.animalId;
  if (meta.sensorName) sync.sensorName = meta.sensorName;
  return sync;
}

async function pullSync(key, id, meta) {
  const parts = [];
  for (let i = 0; i < meta.chunks; i++) {
    const d = await fs.getDoc(fs.doc(db, "dogs", key, "syncs", id, "chunks", String(i)));
    if (!d.exists()) throw new Error(`parte ${i} faltando no sync ${id}`);
    parts.push(d.data().data.toUint8Array());
  }
  const raw = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { raw.set(p, o); o += p.length; }
  return syncFromMeta(id, meta, unpack(raw));
}

// Sobe o que só existe aqui, baixa o que só existe lá. Retorna os syncs novos baixados.
export async function syncAll(key, localSyncs, log = () => {}) {
  await init();
  const remote = await cloudSyncIds(key);
  let up = 0;
  for (const s of localSyncs) {
    if (s.source === "TESTE") continue;
    if (!remote.has(String(s.id))) { await pushSync(key, s); up++; }
  }
  const localIds = new Set(localSyncs.map((s) => String(s.id)));
  const down = [];
  for (const [id, meta] of remote) if (!localIds.has(id)) down.push(await pullSync(key, id, meta));
  log(`nuvem: ${up} enviado(s), ${down.length} baixado(s), ${remote.size + up} no total`);
  return { up, down, total: remote.size + up };
}

// Junta as marcações daqui com as de lá (sem repetir segundo, estado e animal) e grava a lista.
export async function mergeMarks(key, localMarks) {
  await init();
  const ref = fs.doc(db, "dogs", key, "meta", "marks");
  const snap = await fs.getDoc(ref);
  const merged = mergeMarkLists(snap.exists() ? snap.data().list || [] : [], localMarks);
  await fs.setDoc(ref, { list: merged, at: Date.now() });
  return merged;
}

export async function replaceMarks(key, marks) {
  await init();
  await fs.setDoc(fs.doc(db, "dogs", key, "meta", "marks"), { list: marks, at: Date.now() });
}

// ---------- perfil, animais e métricas do onboarding ----------
// Firestore não aceita undefined: limpa antes de gravar.
const clean = (o) => JSON.parse(JSON.stringify(o));

function withTimeout(promise, ms, what) {
  if (!ms) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: tempo esgotado (${ms} ms)`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Lê perfil e animais da nuvem. Usado no início (antes de decidir se mostra o onboarding).
export function pullProfileAndAnimals(key, { timeoutMs = 4000 } = {}) {
  return withTimeout((async () => {
    await init();
    const [p, a] = await Promise.all([
      fs.getDoc(fs.doc(db, "dogs", key, "meta", "profile")),
      fs.getDocs(fs.collection(db, "dogs", key, "animals")),
    ]);
    return { profile: p.exists() ? p.data() : null, animals: a.docs.map((d) => ({ ...d.data(), id: d.id })) };
  })(), timeoutMs, "nuvem (perfil)");
}

export async function pushProfile(key, profile) {
  await init();
  await fs.setDoc(fs.doc(db, "dogs", key, "meta", "profile"), clean(profile));
}

export async function pushAnimal(key, animal) {
  await init();
  if (!animal?.id) throw new Error("animal sem id");
  await fs.setDoc(fs.doc(db, "dogs", key, "animals", animal.id), clean({ ...animal, updatedAt: animal.updatedAt || Date.now() }));
}

// Junta perfil e animais daqui e de lá (o mais novo vence) e sobe o que for mais novo aqui.
export async function syncProfileAndAnimals(key, { profile = null, animals = [] } = {}, log = () => {}) {
  const remote = await pullProfileAndAnimals(key, { timeoutMs: 0 });
  const a = mergeAnimals(animals, remote.animals);
  for (const x of a.toPush) await pushAnimal(key, x);
  const p = mergeProfile(profile, remote.profile);
  if (p.push && p.profile) await pushProfile(key, p.profile);
  log(`nuvem: perfil ${p.push ? "enviado" : "ok"}, ${a.toPush.length} animal(is) enviado(s), ${a.animals.length} no total`);
  return { profile: p.profile, animals: a.animals };
}

// Junta os eventos do onboarding daqui e de lá (por id, máximo 2000) e grava a lista.
export async function mergeOnboarding(key, localEvents = []) {
  await init();
  const ref = fs.doc(db, "dogs", key, "meta", "onboarding");
  const snap = await fs.getDoc(ref);
  const remote = snap.exists() ? snap.data().events || [] : [];
  const merged = mergeEvents(remote, localEvents);
  const remoteIds = new Set(remote.map((e) => e.id));
  if (merged.length === remote.length && merged.every((e) => remoteIds.has(e.id))) return merged; // nada novo: não grava
  await fs.setDoc(ref, clean({ events: merged, at: Date.now() }));
  return merged;
}

// Só lê os eventos do onboarding guardados na nuvem (para a tabela de métricas em Opções).
export async function pullOnboarding(key) {
  await init();
  const snap = await fs.getDoc(fs.doc(db, "dogs", key, "meta", "onboarding"));
  return snap.exists() ? snap.data().events || [] : [];
}
