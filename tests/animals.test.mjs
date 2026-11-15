import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_ANIMAL_ID, LEGACY_ANIMAL, migrateLocal, effectiveAnimalId, effectiveSettings,
  findBySensor, newAnimalId, syncsFor, marksFor, ageLabel, animalSubtitle,
} from "../js/animals.js";

const NOW = 1_800_000_000_000;

test("migrateLocal: aparelho sem dados não cria animal", () => {
  const r = migrateLocal({ now: NOW });
  assert.equal(r.hasLegacyData, false);
  assert.equal(r.changed, false);
  assert.deepEqual(r.animals, []);
});

test("migrateLocal: syncs sem animalId criam o Simut com createdAt do sync mais antigo", () => {
  const syncs = [{ id: 1_700_000_500_000, packets: [] }, { id: 1_700_000_000_000, packets: [] }];
  const r = migrateLocal({ syncs, now: NOW });
  assert.equal(r.hasLegacyData, true);
  assert.equal(r.changed, true);
  assert.equal(r.animals.length, 1);
  const a = r.animals[0];
  assert.equal(a.id, LEGACY_ANIMAL_ID);
  assert.equal(a.name, "Simut");
  assert.equal(a.breed, "Shih Tzu");
  assert.deepEqual(a.age, { years: 12 });
  assert.equal(a.sex, "macho");
  assert.deepEqual(a.sensors, [{ name: "Persono-8154CC", since: 0 }]);
  assert.equal(a.createdAt, 1_700_000_000_000);
  // todos os syncs antigos pertencem ao Simut
  assert.equal(syncsFor(syncs, "simut").length, 2);
});

test("migrateLocal: só marcações também contam como dado legado", () => {
  const r = migrateLocal({ marks: [{ t: 1, s: "deitado" }], now: NOW });
  assert.equal(r.animals[0].id, "simut");
  assert.equal(r.animals[0].createdAt, NOW);
});

test("migrateLocal: com chave da nuvem e sem syncs cria o Simut", () => {
  const r = migrateLocal({ hasCloudKey: true, now: NOW });
  assert.equal(r.hasLegacyData, true);
  assert.equal(r.animals.length, 1);
  assert.equal(r.animals[0].createdAt, NOW);
});

test("migrateLocal: idempotente quando o Simut já existe", () => {
  const first = migrateLocal({ syncs: [{ id: 5 }], now: NOW });
  const edited = first.animals.map((a) => ({ ...a, weightKg: 7.5 }));
  const second = migrateLocal({ syncs: [{ id: 5 }], animals: edited, now: NOW + 1 });
  assert.equal(second.changed, false);
  assert.equal(second.animals.length, 1);
  assert.equal(second.animals[0].weightKg, 7.5);
  const third = migrateLocal({ syncs: [{ id: 5 }], animals: second.animals, hasCloudKey: true });
  assert.deepEqual(third.animals, second.animals);
});

test("migrateLocal: mantém outros animais e põe o Simut primeiro", () => {
  const other = { id: "a-x-1234", name: "Luna", species: "gato", sensors: [] };
  const r = migrateLocal({ syncs: [{ id: 9 }], animals: [other], now: NOW });
  assert.deepEqual(r.animals.map((a) => a.id), ["simut", "a-x-1234"]);
});

test("migrateLocal: não altera a constante LEGACY_ANIMAL", () => {
  const r = migrateLocal({ syncs: [{ id: 9 }] });
  r.animals[0].sensors.push({ name: "X", since: 1 });
  r.animals[0].age.years = 13;
  assert.equal(LEGACY_ANIMAL.sensors.length, 1);
  assert.equal(LEGACY_ANIMAL.age.years, 12);
});

test("effectiveAnimalId: ausente é o Simut", () => {
  assert.equal(effectiveAnimalId({ id: 1 }), "simut");
  assert.equal(effectiveAnimalId({ id: 1, animalId: "a-1" }), "a-1");
  assert.equal(effectiveAnimalId({ t: 1, s: "deitado" }), "simut");
  assert.equal(effectiveAnimalId({ t: 1, s: "deitado", a: "a-2" }), "a-2");
});

test("marksFor e syncsFor filtram por animal", () => {
  const marks = [{ t: 1, s: "deitado" }, { t: 2, s: "andando", a: "a-2" }, { t: 3, s: "fim", a: "simut" }];
  assert.deepEqual(marksFor(marks, "simut").map((m) => m.t), [1, 3]);
  assert.deepEqual(marksFor(marks, "a-2").map((m) => m.t), [2]);
  const syncs = [{ id: 1 }, { id: 2, animalId: "a-2" }];
  assert.deepEqual(syncsFor(syncs, "a-2").map((s) => s.id), [2]);
});

test("effectiveSettings: calibração do animal sobrescreve só os limiares", () => {
  const g = { hz: 32, epoch: 60, tLight: 40, tVig: 250, lsbPerG: 64 };
  assert.deepEqual(effectiveSettings(g, null), g);
  assert.deepEqual(effectiveSettings(g, { calibration: { tLight: 55 } }), { ...g, tLight: 55 });
  assert.deepEqual(effectiveSettings(g, { calibration: { tLight: 55, tVig: 300, hz: 99 } }), { ...g, tLight: 55, tVig: 300 });
  assert.equal(g.tLight, 40);
});

test("findBySensor encontra o animal pelo nome BLE", () => {
  const animals = [
    { id: "simut", sensors: [{ name: "Persono-8154CC", since: 0 }] },
    { id: "a-2", sensors: [{ name: "Persono-AAAA", since: 1 }] },
    { id: "a-3", archived: true, sensors: [{ name: "Persono-BBBB", since: 1 }] },
  ];
  assert.equal(findBySensor(animals, "Persono-8154CC").id, "simut");
  assert.equal(findBySensor(animals, "Persono-AAAA").id, "a-2");
  assert.equal(findBySensor(animals, "Persono-BBBB"), null);
  assert.equal(findBySensor(animals, "Persono-ZZZZ"), null);
  assert.equal(findBySensor(animals, null), null);
});

test("newAnimalId: formato a-<base36>-<4> e únicos", () => {
  const id = newAnimalId(NOW, () => 0.5);
  assert.match(id, /^a-[0-9a-z]+-[0-9a-z]{4}$/);
  assert.equal(id, `a-${NOW.toString(36)}-iiii`);
  const ids = new Set(Array.from({ length: 200 }, () => newAnimalId()));
  assert.ok(ids.size > 190);
  assert.notEqual(newAnimalId(), LEGACY_ANIMAL_ID);
});

test("ageLabel e animalSubtitle", () => {
  const now = new Date(2026, 10, 15).getTime();
  assert.equal(ageLabel({ years: 12 }, now), "cerca de 12 anos");
  assert.equal(ageLabel({ months: 5 }, now), "cerca de 5 meses");
  assert.equal(ageLabel({ birthDate: "2025-11-20" }, now), "11 meses");
  assert.equal(ageLabel(null, now), "");
  assert.equal(animalSubtitle({ species: "cao", breed: "Shih Tzu", age: { years: 12 } }, now), "Cão, Shih Tzu, 12 anos");
  assert.equal(animalSubtitle({ species: "outro", speciesOther: "Coelho", breed: "srd" }, now), "Coelho, SRD");
});
