import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, coalesce } from "../js/cloud-sync.js";

// O sync começou com "antes"; enquanto esperava a nuvem, a pessoa mexeu e o estado virou "agora".
const antes = {
  marks: [{ t: 1000, s: "deitado" }],
  animals: [{ id: "simut", name: "Simut", updatedAt: 5 }],
  profile: { name: "Ana", onboardingDone: true, updatedAt: 5 },
  events: [{ id: "s1-1", t: 1 }],
};
const daNuvem = {
  marks: [{ t: 1000, s: "deitado" }, { t: 2000, s: "andando" }],
  animals: [{ id: "simut", name: "Simut", updatedAt: 5 }],
  profile: { name: "Ana", onboardingDone: true, updatedAt: 5 },
  events: [{ id: "s1-1", t: 1 }, { id: "s0-1", t: 0 }],
};

test("reconcile: marcação feita durante o sync não some", () => {
  const agora = { ...antes, marks: [...antes.marks, { t: 3000, s: "brincando", a: "simut" }] };
  const r = reconcile(agora, daNuvem);
  assert.deepEqual(r.marks.map((m) => m.t), [1000, 2000, 3000]);
});

test("reconcile: animal adicionado e perfil editado durante o sync não são revertidos", () => {
  const novo = { id: "a-1", name: "Luna", updatedAt: 9 };
  const agora = { ...antes, animals: [...antes.animals, novo], profile: { ...antes.profile, name: "Ana Maria", updatedAt: 9 } };
  const r = reconcile(agora, daNuvem);
  assert.deepEqual(r.animals.map((a) => a.id), ["simut", "a-1"]);
  assert.equal(r.profile.name, "Ana Maria");
  assert.deepEqual(r.toPush.map((a) => a.id), ["a-1"]);
  assert.equal(r.pushProfile, true);
});

test("reconcile: evento do onboarding gravado durante o sync não some", () => {
  const agora = { ...antes, events: [...antes.events, { id: "s1-2", t: 2 }] };
  const r = reconcile(agora, daNuvem);
  assert.deepEqual(r.events.map((e) => e.id), ["s0-1", "s1-1", "s1-2"]);
});

test("coalesce: pedido feito durante uma execução roda de novo depois (fila de 1)", async () => {
  let runs = 0, release;
  const gate = () => new Promise((r) => { release = r; });
  const run = coalesce(async () => { runs++; if (runs === 1) await gate(); });
  const first = run();
  run(); run(); run(); // três pedidos no meio viram uma execução só
  release();
  await first;
  await run.idle();
  assert.equal(runs, 2);
});
