import { test } from "node:test";
import assert from "node:assert/strict";

// IndexedDB falso: cada open() devolve um pedido; o teste decide se dispara blocked ou success.
function fakeIndexedDB({ mode = "success" } = {}) {
  const fake = { opens: 0, dbs: [] };
  fake.open = () => {
    fake.opens++;
    const req = {};
    const db = {
      closed: false, onversionchange: null,
      objectStoreNames: { contains: () => true },
      close() { this.closed = true; },
      transaction() {
        const t = { objectStore: () => ({ getAll() { const r = { result: [{ id: 2 }, { id: 1 }] }; setTimeout(() => r.onsuccess?.()); return r; } }) };
        return t;
      },
    };
    fake.dbs.push(db);
    setTimeout(() => {
      if (mode === "blocked") req.onblocked?.({});
      else { req.result = db; req.onsuccess?.(); }
    });
    return req;
  };
  return fake;
}

let n = 0;
const freshStore = () => import(`../js/store.js?t=${++n}`);

test("store: aba antiga segurando a versão anterior rejeita com mensagem clara (não fica pendurado)", { timeout: 2000 }, async () => {
  globalThis.indexedDB = fakeIndexedDB({ mode: "blocked" });
  const store = await freshStore();
  await assert.rejects(store.loadSyncs(), /Feche as outras abas do Simut e recarregue/);
});

test("store: conexão única reutilizada entre leituras", { timeout: 2000 }, async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake;
  const store = await freshStore();
  assert.deepEqual((await store.loadSyncs()).map((s) => s.id), [1, 2]);
  await store.loadSyncs();
  assert.equal(fake.opens, 1);
});

test("store: versionchange (outra aba atualizando) fecha a conexão e a próxima leitura reabre", { timeout: 2000 }, async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake;
  const store = await freshStore();
  await store.loadSyncs();
  assert.equal(typeof fake.dbs[0].onversionchange, "function");
  fake.dbs[0].onversionchange();
  assert.equal(fake.dbs[0].closed, true);
  await store.loadSyncs();
  assert.equal(fake.opens, 2);
});
