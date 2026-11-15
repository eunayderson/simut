import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_ANIMAL_ID, LEGACY_ANIMAL, migrateLocal, mergeLegacyAnswers, effectiveAnimalId, effectiveSettings,
  findBySensor, newAnimalId, syncsFor, marksFor, ageLabel, animalSubtitle, mergeAnimals,
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

import { animalFromAnswers, answersFromAnimal, parseDecimal, routineLabel } from "../js/animals.js";

test("parseDecimal aceita vírgula e rejeita vazio", () => {
  assert.equal(parseDecimal("12,5"), 12.5);
  assert.equal(parseDecimal(" 7.25 "), 7.25);
  assert.equal(parseDecimal(""), null);
  assert.equal(parseDecimal("abc"), null);
});

test("animalFromAnswers: só o obrigatório (espécie e nome); opcionais ficam ausentes", () => {
  const a = animalFromAnswers({ species: "gato", name: " Mia " }, { id: "a-1" }, NOW);
  assert.equal(a.id, "a-1");
  assert.equal(a.species, "gato");
  assert.equal(a.name, "Mia");
  for (const k of ["breed", "age", "weightKg", "sex", "neutered", "routine", "speciesOther"]) assert.equal(k in a, false, k);
  assert.deepEqual(a.sensors, []);
  assert.equal(a.createdAt, NOW);
  assert.equal(a.updatedAt, NOW);
});

test("animalFromAnswers: Não sei vira null (diferente de não respondido)", () => {
  const a = animalFromAnswers({ species: "cao", name: "Rex", breedChoice: "nao-sei", ageUnknown: true, weightUnknown: true, sex: "macho", neutered: "nao-sei" }, {}, NOW);
  assert.equal(a.breed, null);
  assert.equal(a.age, null);
  assert.equal(a.weightKg, null);
  assert.equal(a.neutered, null);
});

test("animalFromAnswers: raça, idade aproximada ou por data, peso decimal, sexo e castração", () => {
  const a = animalFromAnswers({ species: "cao", name: "Rex", breedChoice: "srd", ageMode: "aprox", ageValue: "8", ageUnit: "meses", weight: "4,35", sex: "femea", neutered: "sim", environment: "apartamento", activity: "diario" }, {}, NOW);
  assert.equal(a.breed, "srd");
  assert.deepEqual(a.age, { months: 8 });
  assert.equal(a.weightKg, 4.4);
  assert.equal(a.sex, "femea");
  assert.equal(a.neutered, true);
  assert.deepEqual(a.routine, { environment: "apartamento", activity: "diario" });
  const b = animalFromAnswers({ species: "outro", speciesOther: "Coelho", name: "Bolt", ageMode: "nasc", birthDate: "2020-05-01", sex: "nao-informar", neutered: "sim" }, {}, NOW);
  assert.equal(b.speciesOther, "Coelho");
  assert.deepEqual(b.age, { birthDate: "2020-05-01" });
  assert.equal("neutered" in b, false);
});

test("animalFromAnswers mantém sensores, calibração e criação do animal existente", () => {
  const base = { ...LEGACY_ANIMAL, calibration: { tLight: 50 }, createdAt: 123 };
  const a = animalFromAnswers({ ...answersFromAnimal(base), weight: "6,2" }, base, NOW);
  assert.equal(a.id, "simut");
  assert.deepEqual(a.sensors, LEGACY_ANIMAL.sensors);
  assert.deepEqual(a.calibration, { tLight: 50 });
  assert.equal(a.createdAt, 123);
  assert.equal(a.breed, "Shih Tzu");
  assert.deepEqual(a.age, { years: 12 });
  assert.equal(a.weightKg, 6.2);
  assert.equal(a.sex, "macho");
});

test("answersFromAnimal e animalFromAnswers são inversas nos campos do onboarding", () => {
  const orig = { id: "a-2", species: "gato", name: "Mia", breed: null, age: { birthDate: "2019-02-03" }, weightKg: 3.5, sex: "femea", neutered: false, routine: { restPlace: "chao" }, sensors: [], createdAt: 1 };
  const back = animalFromAnswers(answersFromAnimal(orig), orig, NOW);
  assert.deepEqual({ ...back, updatedAt: 0 }, { ...orig, updatedAt: 0 });
  assert.equal(routineLabel("restPlace", "chao"), "Chão");
});

import { associateSensor, dissociateSensor, sensorDecision, hasSensor } from "../js/animals.js";

test("associateSensor adiciona uma vez só; dissociateSensor remove", () => {
  const a = { id: "a-1", name: "Mia", sensors: [] };
  const b = associateSensor(a, "Persono-AAA", NOW);
  assert.deepEqual(b.sensors, [{ name: "Persono-AAA", since: NOW }]);
  assert.equal(b.updatedAt, NOW);
  assert.equal(associateSensor(b, "Persono-AAA", NOW + 1), b);
  assert.equal(hasSensor(b, "Persono-AAA"), true);
  const c = dissociateSensor(b, "Persono-AAA", NOW + 2);
  assert.deepEqual(c.sensors, []);
  assert.equal(dissociateSensor(c, "Persono-AAA"), c);
  assert.equal(associateSensor(a, null), a);
});

test("sensorDecision: sem dono associa, do próprio segue, de outro dá conflito", () => {
  const simut = { ...LEGACY_ANIMAL };
  const mia = { id: "a-1", name: "Mia", sensors: [] };
  const animals = [simut, mia];
  assert.deepEqual(sensorDecision(animals, "Persono-8154CC", "simut"), { action: "ok" });
  assert.deepEqual(sensorDecision(animals, "Persono-NOVO", "a-1"), { action: "associate" });
  const d = sensorDecision(animals, "Persono-8154CC", "a-1");
  assert.equal(d.action, "conflict");
  assert.equal(d.owner.id, "simut");
  // depois de "Salvar para Mia" o sensor é dos dois: segue sem perguntar
  const both = [simut, associateSensor(mia, "Persono-8154CC", NOW)];
  assert.deepEqual(sensorDecision(both, "Persono-8154CC", "a-1"), { action: "ok" });
  // animal arquivado não conta como dono
  assert.deepEqual(sensorDecision([{ ...simut, archived: true }, mia], "Persono-8154CC", "a-1"), { action: "associate" });
  assert.deepEqual(sensorDecision(animals, null, "a-1"), { action: "ok" });
});

test("migrateLocal: o Simut migrado nasce com updatedAt 0 (qualquer versão da nuvem vence)", () => {
  for (const input of [{ hasCloudKey: true }, { syncs: [{ id: 1_700_000_000_000 }] }, { marks: [{ t: 1, s: "deitado" }] }]) {
    const r = migrateLocal({ ...input, now: NOW });
    assert.equal(r.animals[0].updatedAt, 0);
  }
  const remote = [{ id: "simut", name: "Simut Jr", weightKg: 7.2, calibration: { tLight: 30 }, updatedAt: 5 }];
  const m = mergeAnimals(migrateLocal({ hasCloudKey: true, now: NOW }).animals, remote);
  assert.equal(m.animals[0].name, "Simut Jr");
  assert.deepEqual(m.toPush, []);
});

test("mergeLegacyAnswers: respostas que a pessoa não mexeu ficam com o que o Simut já tem (nuvem)", () => {
  const prefill = answersFromAnimal(LEGACY_ANIMAL);
  const current = { ...LEGACY_ANIMAL, name: "Simut Jr", weightKg: 7.2, breed: "Shih Tzu", calibration: { tLight: 30 }, archived: false, updatedAt: 9 };
  // pessoa só trocou o sexo; o resto veio do pré-preenchimento antigo
  const ans = { ...prefill, sex: "femea" };
  const merged = mergeLegacyAnswers(ans, prefill, current);
  const a = animalFromAnswers(merged, current, NOW);
  assert.equal(a.name, "Simut Jr");
  assert.equal(a.weightKg, 7.2);
  assert.equal(a.sex, "femea");
  assert.deepEqual(a.calibration, { tLight: 30 });
  // pessoa mudou o nome: vale o que ela digitou
  assert.equal(animalFromAnswers(mergeLegacyAnswers({ ...prefill, name: "Bidu" }, prefill, current), current, NOW).name, "Bidu");
});

test("birthDateError: data futura, inválida ou absurda dá erro; hoje e passado valem", async () => {
  const { birthDateError } = await import("../js/animals.js");
  const now = new Date(2026, 10, 15, 10).getTime();
  assert.equal(birthDateError("2026-11-15", now), null);
  assert.equal(birthDateError("2020-01-01", now), null);
  assert.equal(birthDateError("", now), null); // vazio é opcional
  assert.match(birthDateError("2030-01-01", now), /futuro/);
  assert.match(birthDateError("2026-11-16", now), /futuro/);
  assert.match(birthDateError("1900-01-01", now), /40 anos/);
  assert.match(birthDateError("2026-02-31", now), /inválida/);
});

test("nameWithArticle e ofName: artigo conforme o sexo, sem presumir quando não informado", async () => {
  const { nameWithArticle, ofName } = await import("../js/animals.js");
  assert.equal(nameWithArticle({ name: "Simut", sex: "macho" }), "o Simut");
  assert.equal(nameWithArticle({ name: "Luna", sex: "femea" }), "a Luna");
  assert.equal(nameWithArticle({ name: "Bidu" }), "Bidu");
  assert.equal(nameWithArticle({ name: "Bidu", sex: "nao-informar" }), "Bidu");
  assert.equal(ofName({ name: "Simut", sex: "macho" }), "do Simut");
  assert.equal(ofName({ name: "Luna", sex: "femea" }), "da Luna");
  assert.equal(ofName({ name: "Bidu" }), "de Bidu");
});
