// Nuvem (Firebase Firestore, plano gratuito). Sem login: o acesso é pela chave do Simut,
// um código secreto guardado só nos aparelhos (nunca no repositório).
// Estrutura (o nome "dogs" fica por compatibilidade, vale também para gatos e outros):
//   dogs/{chave}/syncs/{id}            -> { endAt, source, packets, chunks, sensor, at, animalId?, sensorName? }
//   dogs/{chave}/syncs/{id}/chunks/{i} -> { data: Bytes }  ([u16 tamanho][pacote] repetido)
//   dogs/{chave}/meta/marks            -> { list: [{t, s}], at }   (só o Simut; a versão 9 lê e regrava este)
//   dogs/{chave}/marks/{animalId}      -> { list: [{t, s, a}], at } (marcações dos outros animais)
//   dogs/{chave}/meta/marksDeleted     -> { list: [{k: "seg:estado:animal", at}], at }   (marcações desfeitas ou limpas)
//   dogs/{chave}/meta/profile          -> { name, createdAt, updatedAt, onboardingDone, onboardingFlow }
//   dogs/{chave}/meta/onboarding       -> { events: [...], at }   (junta por id de evento, máximo 2000)
//   dogs/{chave}/animals/{animalId}    -> animal completo (ver animals.js)
// Documentos antigos nunca são reescritos: syncs só sobem quando não existem lá.

import { mergeMarkLists, mergeTombstones, markAnimal } from "./validation.js?v=10";
import { mergeAnimals, mergeProfile, LEGACY_ANIMAL_ID } from "./animals.js?v=10";
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

// Troca o Firestore (testes usam um em memória: tests/fake-firestore.mjs).
export function useBackend(fsImpl, dbImpl) { fs = fsImpl; db = dbImpl; }

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
    if (s.source === "TESTE" || s.source === "simulado") continue; // teste e sensor simulado (?mock=1) nunca sobem
    if (!remote.has(String(s.id))) { await pushSync(key, s); up++; }
  }
  const localIds = new Set(localSyncs.map((s) => String(s.id)));
  const down = [];
  for (const [id, meta] of remote) if (!localIds.has(id)) down.push(await pullSync(key, id, meta));
  log(`nuvem: ${up} enviado(s), ${down.length} baixado(s), ${remote.size + up} no total`);
  return { up, down, total: remote.size + up };
}

// Sync já enviado que mudou de animal (modal "sensor de outro animal" respondido depois do
// download): regrava só o metadado com o outro animalId. Devolve false se ainda não está lá.
export async function reassignSync(key, id, animalId) {
  await init();
  const ref = fs.doc(db, "dogs", key, "syncs", String(id));
  return fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    tx.set(ref, { ...snap.data(), animalId });
    return true;
  });
}

// Marcações: junta as daqui com as de lá (sem repetir segundo, estado e animal), respeitando
// os tombstones (meta/marksDeleted), e grava. Ler, juntar e gravar numa transação por documento:
// nada de outro aparelho é apagado, e o que foi desfeito não volta. Devolve { marks, deleted }.
async function mergeDoc(ref, fn) {
  return fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data() : null;
    const next = fn(cur);
    if (next.write) tx.set(ref, next.doc);
    return next.value;
  });
}
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function syncMarks(key, localMarks = [], localDeleted = []) {
  await init();
  const deleted = await mergeDoc(fs.doc(db, "dogs", key, "meta", "marksDeleted"), (cur) => {
    const remote = cur?.list || [];
    const list = mergeTombstones(remote, localDeleted);
    return { value: list, write: !sameList(list, mergeTombstones(remote)), doc: { list, at: Date.now() } };
  });
  // meta/marks é lido também pela versão antiga (9), que regrava só {t, s}: lá ficam só as do Simut.
  // Os outros animais ficam em marks/{animalId}. Marcações de outros animais que já estejam em
  // meta/marks (gravadas antes desta divisão) são copiadas para marks/{animalId} antes de sair de lá.
  const metaRef = fs.doc(db, "dogs", key, "meta", "marks");
  const metaSnap = await fs.getDoc(metaRef);
  const strays = (metaSnap.exists() ? metaSnap.data().list || [] : []).filter((m) => markAnimal(m) !== LEGACY_ANIMAL_ID);
  const ids = new Set([...localMarks, ...strays].map(markAnimal).filter((id) => id !== LEGACY_ANIMAL_ID));
  for (const d of (await fs.getDocs(fs.collection(db, "dogs", key, "marks"))).docs) ids.add(d.id);
  const out = [];
  for (const id of ids) {
    const of = (list) => list.filter((m) => markAnimal(m) === id);
    out.push(...await mergeDoc(fs.doc(db, "dogs", key, "marks", id), (cur) => {
      const remote = cur?.list || [];
      const list = mergeMarkLists(remote, of(localMarks), of(strays), { deleted }).map((m) => ({ ...m, a: id }));
      return { value: list, write: !sameList(list, remote), doc: { list, at: Date.now() } };
    }));
  }
  out.push(...await mergeDoc(metaRef, (cur) => {
    const remote = cur?.list || [];
    const simut = (list) => list.filter((m) => markAnimal(m) === LEGACY_ANIMAL_ID);
    const list = mergeMarkLists(simut(remote), simut(localMarks), { deleted }).map((m) => ({ t: m.t, s: m.s }));
    return { value: list, write: !sameList(list, remote), doc: { list, at: Date.now() } };
  }));
  return { marks: mergeMarkLists(out), deleted };
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
  await fs.setDoc(fs.doc(db, "dogs", key, "animals", animal.id), clean({ ...animal, updatedAt: Number.isFinite(animal.updatedAt) ? animal.updatedAt : Date.now() }));
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
