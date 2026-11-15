// Nuvem (Firebase Firestore, plano gratuito). Sem login: o acesso é pela chave do Simut,
// um código secreto guardado só nos aparelhos (nunca no repositório).
// Estrutura: dogs/{chave}/syncs/{id}            -> { endAt, source, packets, chunks }
//            dogs/{chave}/syncs/{id}/chunks/{i} -> { data: Bytes }  ([u16 tamanho][pacote] repetido)
//            dogs/{chave}/meta/marks             -> { list: [{t, s}] }

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
  await fs.setDoc(base, { endAt: sync.endAt, source: sync.source || "", packets: sync.packets.length, chunks: chunks.length, sensor: sync.sensor || null, at: Date.now() });
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
  return { id: Number(id), endAt: meta.endAt, source: meta.source, sensor: meta.sensor || null, packets: unpack(raw) };
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

export async function mergeMarks(key, localMarks) {
  await init();
  const ref = fs.doc(db, "dogs", key, "meta", "marks");
  const snap = await fs.getDoc(ref);
  const all = [...(snap.exists() ? snap.data().list : []), ...localMarks];
  const seen = new Set(), merged = [];
  for (const m of all.sort((a, b) => a.t - b.t)) {
    const k = `${Math.round(m.t / 1000)}:${m.s}`;
    if (!seen.has(k)) { seen.add(k); merged.push({ t: m.t, s: m.s }); }
  }
  await fs.setDoc(ref, { list: merged, at: Date.now() });
  return merged;
}

export async function replaceMarks(key, marks) {
  await init();
  await fs.setDoc(fs.doc(db, "dogs", key, "meta", "marks"), { list: marks, at: Date.now() });
}
