import { test } from "node:test";
import assert from "node:assert/strict";
import { syncMeta, syncFromMeta } from "../js/cloud.js";
import { mergeMarkLists } from "../js/validation.js";
import { mergeAnimals, mergeProfile } from "../js/animals.js";

test("syncMeta: docs novos ganham animalId e sensorName; antigos ficam no formato de sempre", () => {
  const old = { id: 1, endAt: 10, source: "bluetooth", packets: [new Uint8Array(9)], sensor: { info: "01" } };
  assert.deepEqual(syncMeta(old, 1, 99), { endAt: 10, source: "bluetooth", packets: 1, chunks: 1, sensor: { info: "01" }, at: 99 });
  const novo = { ...old, animalId: "a-2", sensorName: "Persono-8154CC" };
  assert.deepEqual(syncMeta(novo, 2, 5), { endAt: 10, source: "bluetooth", packets: 1, chunks: 2, sensor: { info: "01" }, at: 5, animalId: "a-2", sensorName: "Persono-8154CC" });
  assert.deepEqual(syncMeta({ id: 1, endAt: 1, packets: [] }, 0, 1), { endAt: 1, source: "", packets: 0, chunks: 0, sensor: null, at: 1 });
});

test("syncFromMeta devolve animalId e sensorName quando existem", () => {
  const p = [new Uint8Array([1])];
  assert.deepEqual(syncFromMeta("123", { endAt: 5, source: "x", chunks: 1 }, p), { id: 123, endAt: 5, source: "x", sensor: null, packets: p });
  assert.deepEqual(syncFromMeta("7", { endAt: 5, source: "x", sensor: { info: "aa" }, animalId: "a-9", sensorName: "Persono-1" }, p),
    { id: 7, endAt: 5, source: "x", sensor: { info: "aa" }, packets: p, animalId: "a-9", sensorName: "Persono-1" });
});

test("mergeMarkLists: dedupe por t:s:a, mantém o a só quando existe", () => {
  const remote = [{ t: 1000, s: "deitado" }, { t: 5000, s: "andando", a: "a-2" }];
  const local = [{ t: 1200, s: "deitado", a: "simut" }, { t: 5000, s: "andando" }, { t: 9000, s: "fim", a: "a-2" }];
  const m = mergeMarkLists(remote, local);
  assert.deepEqual(m, [
    { t: 1000, s: "deitado" },             // legado e simut explícito no mesmo segundo: um só
    { t: 5000, s: "andando", a: "a-2" },   // mesmo horário, animais diferentes: os dois ficam
    { t: 5000, s: "andando" },
    { t: 9000, s: "fim", a: "a-2" },
  ]);
  assert.deepEqual(mergeMarkLists([], []), []);
  assert.deepEqual(mergeMarkLists([{ t: 1, s: "x", extra: 1 }]), [{ t: 1, s: "x" }]);
});

test("mergeAnimals: mais novo vence, só sobe o que é mais novo aqui ou não existe lá", () => {
  const local = [
    { id: "simut", name: "Simut", updatedAt: 10 },
    { id: "a-1", name: "Luna local", updatedAt: 50 },
    { id: "a-2", name: "Bob local", updatedAt: 5 },
    { id: "a-3", name: "Novo", updatedAt: 7 },
  ];
  const remote = [
    { id: "simut", name: "Simut", updatedAt: 10 },
    { id: "a-1", name: "Luna nuvem", updatedAt: 40 },
    { id: "a-2", name: "Bob nuvem", updatedAt: 9 },
    { id: "a-4", name: "Só na nuvem", updatedAt: 1 },
  ];
  const r = mergeAnimals(local, remote);
  assert.deepEqual(r.animals.map((a) => a.name), ["Simut", "Luna local", "Bob nuvem", "Novo", "Só na nuvem"]);
  assert.deepEqual(r.toPush.map((a) => a.id), ["a-1", "a-3"]);
  assert.deepEqual(mergeAnimals([], remote).toPush, []);
  assert.equal(mergeAnimals([], remote).animals.length, 4);
});

test("mergeAnimals: Simut criado offline em dois aparelhos não duplica", () => {
  const legacy = { id: "simut", name: "Simut", createdAt: 100, updatedAt: 100 };
  const r = mergeAnimals([legacy], [{ ...legacy, weightKg: 7, updatedAt: 200 }]);
  assert.equal(r.animals.length, 1);
  assert.equal(r.animals[0].weightKg, 7);
  assert.deepEqual(r.toPush, []);
});

test("mergeProfile", () => {
  assert.deepEqual(mergeProfile(null, null), { profile: null, push: false });
  assert.deepEqual(mergeProfile({ name: "A", updatedAt: 1 }, null), { profile: { name: "A", updatedAt: 1 }, push: true });
  assert.deepEqual(mergeProfile(null, { name: "B", updatedAt: 1 }), { profile: { name: "B", updatedAt: 1 }, push: false });
  assert.equal(mergeProfile({ name: "A", updatedAt: 5 }, { name: "B", updatedAt: 3 }).profile.name, "A");
  assert.equal(mergeProfile({ name: "A", updatedAt: 5 }, { name: "B", updatedAt: 3 }).push, true);
  assert.equal(mergeProfile({ name: "A", updatedAt: 2 }, { name: "B", updatedAt: 3 }).profile.name, "B");
  assert.equal(mergeProfile({ name: "A", updatedAt: 3 }, { name: "B", updatedAt: 3 }).push, false);
});
