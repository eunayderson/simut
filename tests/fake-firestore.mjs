// Firestore em memória com a mesma interface usada por js/cloud.js (doc, collection, getDoc,
// getDocs, setDoc, runTransaction, Bytes). Guarda cópias JSON para imitar a serialização.

export function fakeFirestore() {
  const docs = new Map(); // "a/b/c/d" -> dados
  const db = { docs, writes: [] };
  const join = (base, segs) => [...(base?.path || []), ...segs.map(String)];
  const snap = (ref) => {
    const k = ref.path.join("/");
    const has = docs.has(k);
    const v = has ? JSON.parse(JSON.stringify(docs.get(k))) : undefined;
    return { id: ref.path.at(-1), exists: () => has, data: () => v };
  };
  const fs = {
    doc: (base, ...segs) => ({ path: join(base === db ? null : base, segs) }),
    collection: (base, ...segs) => ({ path: join(base === db ? null : base, segs) }),
    async getDoc(ref) { return snap(ref); },
    async getDocs(col) {
      const prefix = col.path.join("/") + "/";
      const out = [];
      for (const k of docs.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (!rest.includes("/")) out.push(snap({ path: [...col.path, rest] }));
      }
      return { docs: out, size: out.length };
    },
    async setDoc(ref, data) {
      const k = ref.path.join("/");
      docs.set(k, JSON.parse(JSON.stringify(data)));
      db.writes.push(k);
    },
    async runTransaction(_db, fn) {
      return fn({ get: (ref) => fs.getDoc(ref), set: (ref, data) => { fs.setDoc(ref, data); } });
    },
    Bytes: { fromUint8Array: (u) => ({ toUint8Array: () => u }) },
  };
  const get = (...segs) => { const v = docs.get(segs.join("/")); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  const put = (data, ...segs) => docs.set(segs.join("/"), JSON.parse(JSON.stringify(data)));
  return { fs, db, get, put };
}
