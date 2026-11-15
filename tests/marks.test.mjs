import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMarkLists, mergeTombstones, undoLast, clearMarksOf, markKey } from "../js/validation.js";
import { fakeFirestore } from "./fake-firestore.mjs";
import { useBackend, syncMarks } from "../js/cloud.js";

const KEY = "chave-ficticia-ok-marcacoes-0123456789abc";

test("mergeMarkLists: tombstones (desfeitas) não voltam no merge", () => {
  const a = [{ t: 1000, s: "deitado" }, { t: 2000, s: "andando", a: "a-2" }];
  const b = [{ t: 3000, s: "brincando" }];
  const deleted = [{ k: markKey({ t: 1000, s: "deitado" }), at: 5 }];
  assert.deepEqual(mergeMarkLists(a, b, { deleted }), [{ t: 2000, s: "andando", a: "a-2" }, { t: 3000, s: "brincando" }]);
  // sem opções continua igual
  assert.equal(mergeMarkLists(a, b).length, 3);
});

test("mergeTombstones: união por chave, sem repetir", () => {
  const t = mergeTombstones([{ k: "1:deitado:simut", at: 1 }], [{ k: "1:deitado:simut", at: 2 }, { k: "2:fim:a-2", at: 3 }]);
  assert.deepEqual(t.map((x) => x.k).sort(), ["1:deitado:simut", "2:fim:a-2"]);
});

test("undoLast: tira só a última do animal e devolve o tombstone", () => {
  const marks = [{ t: 1000, s: "deitado" }, { t: 2000, s: "andando", a: "a-2" }, { t: 3000, s: "fim", a: "a-2" }, { t: 4000, s: "pausa" }];
  const r = undoLast(marks, "a-2", 99);
  assert.deepEqual(r.marks.map((m) => m.t), [1000, 2000, 4000]);
  assert.deepEqual(r.tombstones, [{ k: "3:fim:a-2", at: 99 }]);
  assert.deepEqual(undoLast([], "a-2").tombstones, []);
});

test("clearMarksOf: tira só as do animal atual", () => {
  const marks = [{ t: 1000, s: "deitado" }, { t: 2000, s: "andando", a: "a-2" }, { t: 4000, s: "pausa", a: "simut" }];
  const r = clearMarksOf(marks, "simut", 7);
  assert.deepEqual(r.marks, [{ t: 2000, s: "andando", a: "a-2" }]);
  assert.deepEqual(r.tombstones.map((x) => x.k), ["1:deitado:simut", "4:pausa:simut"]);
});

test("nuvem: desfazer num aparelho não apaga marcações de outros aparelhos e animais, e a desfeita não volta", async () => {
  const f = fakeFirestore();
  useBackend(f.fs, f.db);
  // aparelho B já gravou duas marcações do Simut
  const b = [{ t: 1000, s: "deitado" }, { t: 2000, s: "andando" }];
  await syncMarks(KEY, b, []);
  // aparelho A tem uma do Luna e uma do Simut; desfaz a do Simut
  let a = [{ t: 5000, s: "brincando", a: "a-luna" }, { t: 6000, s: "pausa", a: "simut" }];
  await syncMarks(KEY, a, []);
  const u = undoLast(a, "simut", 50);
  const ra = await syncMarks(KEY, u.marks, u.tombstones);
  assert.deepEqual(ra.marks.map((m) => m.t), [1000, 2000, 5000]);
  // B ainda tem a marcação 6000 (veio do merge anterior) e sincroniza: ela não volta
  const rb = await syncMarks(KEY, [...b, { t: 6000, s: "pausa" }], []);
  assert.deepEqual(rb.marks.map((m) => m.t), [1000, 2000, 5000]);
  assert.deepEqual(rb.deleted.map((x) => x.k), ["6:pausa:simut"]);
});

test("nuvem: limpar só apaga as marcações do animal atual", async () => {
  const f = fakeFirestore();
  useBackend(f.fs, f.db);
  const all = [{ t: 1000, s: "deitado" }, { t: 5000, s: "brincando", a: "a-luna" }];
  await syncMarks(KEY, all, []);
  const c = clearMarksOf([{ t: 5000, s: "brincando", a: "a-luna" }], "a-luna", 9); // este aparelho só tem a do Luna
  const r = await syncMarks(KEY, c.marks, c.tombstones);
  assert.deepEqual(r.marks, [{ t: 1000, s: "deitado" }]);
});

// Aba antiga (versão 9, em main): lê meta/marks, junta deduplicando por t:s e regrava só {t, s}.
function abaAntigaRegrava(f, key, local = []) {
  const remote = f.get("dogs", key, "meta", "marks")?.list || [];
  const seen = new Set(), list = [];
  for (const m of [...remote, ...local].sort((a, b) => a.t - b.t)) {
    const k = `${Math.round(m.t / 1000)}:${m.s}`;
    if (seen.has(k)) continue;
    seen.add(k); list.push({ t: m.t, s: m.s });
  }
  f.put({ list, at: 1 }, "dogs", key, "meta", "marks");
}

test("nuvem: meta/marks fica só com o Simut; outros animais em marks/{animalId}", async () => {
  const f = fakeFirestore();
  useBackend(f.fs, f.db);
  await syncMarks(KEY, [{ t: 1000, s: "deitado", a: "simut" }, { t: 1000, s: "deitado", a: "a-luna" }, { t: 2000, s: "fim" }], []);
  assert.deepEqual(f.get("dogs", KEY, "meta", "marks").list, [{ t: 1000, s: "deitado" }, { t: 2000, s: "fim" }]);
  assert.deepEqual(f.get("dogs", KEY, "marks", "a-luna").list, [{ t: 1000, s: "deitado", a: "a-luna" }]);
});

test("nuvem: aba antiga regravando meta/marks não transforma marcações de outro animal em Simut", async () => {
  const f = fakeFirestore();
  useBackend(f.fs, f.db);
  await syncMarks(KEY, [{ t: 1000, s: "deitado" }, { t: 1000, s: "deitado", a: "a-luna" }, { t: 3000, s: "andando", a: "a-luna" }], []);
  abaAntigaRegrava(f, KEY, [{ t: 4000, s: "pausa" }]);
  const r = await syncMarks(KEY, [], []); // aparelho novo, sem nada local
  assert.deepEqual(r.marks.filter((m) => (m.a ?? "simut") === "simut").map((m) => m.t), [1000, 4000]);
  assert.deepEqual(r.marks.filter((m) => m.a === "a-luna").map((m) => m.t), [1000, 3000]);
});

test("nuvem: marcações de outros animais já gravadas em meta/marks migram para marks/{animalId}", async () => {
  const f = fakeFirestore();
  useBackend(f.fs, f.db);
  f.put({ list: [{ t: 1000, s: "deitado" }, { t: 5000, s: "brincando", a: "a-luna" }], at: 1 }, "dogs", KEY, "meta", "marks");
  const r = await syncMarks(KEY, [], []);
  assert.deepEqual(r.marks.map((m) => m.t), [1000, 5000]);
  assert.deepEqual(f.get("dogs", KEY, "meta", "marks").list, [{ t: 1000, s: "deitado" }]);
  assert.deepEqual(f.get("dogs", KEY, "marks", "a-luna").list, [{ t: 5000, s: "brincando", a: "a-luna" }]);
});
