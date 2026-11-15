import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../js/cloud-sync.js";

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
