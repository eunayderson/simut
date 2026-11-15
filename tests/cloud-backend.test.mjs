import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeFirestore } from "./fake-firestore.mjs";
import { useBackend, syncProfileAndAnimals } from "../js/cloud.js";
import { migrateLocal } from "../js/animals.js";

const KEY = "teste-dev-apagar-0123456789abcdefghij";

test("nuvem: Simut migrado offline não sobrescreve o Simut da nuvem (calibração, peso, nome, arquivado)", async () => {
  const f = fakeFirestore();
  useBackend(f.fs, f.db);
  const remote = { id: "simut", name: "Simut Jr", weightKg: 7.2, calibration: { tLight: 30, tVig: 200 }, archived: true, sensors: [{ name: "Persono-1", since: 1 }], updatedAt: 1_700_000_000_000 };
  f.put(remote, "dogs", KEY, "animals", "simut");
  const local = migrateLocal({ hasCloudKey: true, now: Date.now() }).animals;
  const r = await syncProfileAndAnimals(KEY, { profile: null, animals: local });
  assert.deepEqual(f.get("dogs", KEY, "animals", "simut"), remote);
  assert.equal(r.animals[0].name, "Simut Jr");
});

test("nuvem: Simut migrado sobe com updatedAt 0 quando a nuvem não tem nenhum", async () => {
  const f = fakeFirestore();
  useBackend(f.fs, f.db);
  const local = migrateLocal({ hasCloudKey: true, now: Date.now() }).animals;
  await syncProfileAndAnimals(KEY, { profile: null, animals: local });
  assert.equal(f.get("dogs", KEY, "animals", "simut").updatedAt, 0);
});
