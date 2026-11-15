import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, guard, animalPath, SECTIONS } from "../js/router.js";

test("parse: hash vazio, só # e #/ são vazios", () => {
  for (const h of ["", "#", "#/", undefined]) assert.deepEqual(parse(h), { name: "empty" });
});

test("parse: #k=CHAVE não é rota (a chave é lida antes pelo cloud.getKey)", () => {
  assert.deepEqual(parse("#k=abcdefghijklmnopqrstuvwxyz0123456789"), { name: "empty" });
});

test("parse: onboarding com e sem etapa e fluxo adicionar", () => {
  assert.deepEqual(parse("#/onboarding"), { name: "onboarding", step: null, flow: null });
  assert.deepEqual(parse("#/onboarding/3"), { name: "onboarding", step: 3, flow: null });
  assert.deepEqual(parse("#/onboarding?fluxo=adicionar"), { name: "onboarding", step: null, flow: "adicionar" });
  assert.deepEqual(parse("#/onboarding/2?fluxo=adicionar"), { name: "onboarding", step: 2, flow: "adicionar" });
  assert.equal(parse("#/onboarding/5").name, "unknown");
  assert.equal(parse("#/onboarding/x").name, "unknown");
});

test("parse: grade e seções do animal", () => {
  assert.deepEqual(parse("#/animais"), { name: "animais" });
  for (const s of SECTIONS) assert.deepEqual(parse(`#/a/simut/${s}`), { name: "animal", animalId: "simut", section: s });
  assert.deepEqual(parse("#/a/a-lz3k-ab12"), { name: "animal", animalId: "a-lz3k-ab12", section: "visao-geral" });
  assert.equal(parse("#/a/simut/inexistente").name, "unknown");
  assert.equal(parse("#/qualquer").name, "unknown");
});

test("animalPath monta o hash da seção", () => {
  assert.equal(animalPath("simut"), "#/a/simut/visao-geral");
  assert.equal(animalPath("simut", "sensor"), "#/a/simut/sensor");
  assert.equal(parse(animalPath("a-1-x", "dados")).animalId, "a-1-x");
});

const SIMUT = { id: "simut", name: "Simut" };
const DONE = { name: "Ana", onboardingDone: true };

test("guard: sem onboarding concluído vai para o onboarding", () => {
  assert.equal(guard(parse(""), { profile: null }), "#/onboarding");
  assert.equal(guard(parse("#/animais"), { profile: { name: "Ana", onboardingDone: false } }), "#/onboarding");
  assert.equal(guard(parse("#/a/simut/sensor"), { profile: null, animals: [SIMUT] }), "#/onboarding");
  assert.equal(guard(parse("#/onboarding/2"), { profile: null }), null);
});

test("guard: quem já fez onboarding entra na grade e nunca vê o formulário de novo", () => {
  assert.equal(guard(parse(""), { profile: DONE, animals: [SIMUT] }), "#/animais");
  assert.equal(guard(parse("#/xyz"), { profile: DONE, animals: [SIMUT] }), "#/animais");
  assert.equal(guard(parse("#/animais"), { profile: DONE, animals: [SIMUT] }), null);
  assert.equal(guard(parse("#/onboarding"), { profile: DONE, animals: [SIMUT] }), "#/animais");
  assert.equal(guard(parse("#/onboarding/1"), { profile: DONE, animals: [SIMUT] }), "#/animais");
});

test("guard: adicionar animal é liberado depois do onboarding (pela URL ou pelo rascunho)", () => {
  assert.equal(guard(parse("#/onboarding?fluxo=adicionar"), { profile: DONE, animals: [SIMUT] }), null);
  assert.equal(guard(parse("#/onboarding/4"), { profile: DONE, animals: [SIMUT], draft: { flow: "adicionar" } }), null);
});

test("guard: animal inexistente volta para a grade", () => {
  assert.equal(guard(parse("#/a/simut/dados"), { profile: DONE, animals: [SIMUT] }), null);
  assert.equal(guard(parse("#/a/outro/dados"), { profile: DONE, animals: [SIMUT] }), "#/animais");
});

test("guard: com o onboarding desligado a entrada vai para a grade", () => {
  assert.equal(guard(parse(""), { profile: null, onboarding: false }), "#/animais");
  assert.equal(guard(parse("#/onboarding"), { profile: null, onboarding: false }), null);
  assert.equal(guard(parse("#/a/simut"), { profile: null, animals: [SIMUT], onboarding: false }), null);
});

test("guard: com chave e perfil da nuvem ainda não lido, não decide pelo onboarding", () => {
  const pending = { profile: null, animals: [SIMUT], cloudPending: true };
  assert.equal(guard(parse(""), pending), "#/animais");
  assert.equal(guard(parse("#/animais"), pending), null);
  assert.equal(guard(parse("#/onboarding"), pending), "#/animais");
  assert.equal(guard(parse("#/onboarding/4"), pending), "#/animais");
  assert.equal(guard(parse("#/a/simut/dados"), pending), null);
  // perfil local concluído: segue normal
  assert.equal(guard(parse("#/onboarding"), { ...pending, profile: DONE }), "#/animais");
});

test("startRouter: #k= colado na aba já aberta é lido antes do guard trocar o hash", async () => {
  const { startRouter } = await import("../js/router.js");
  const { getKey } = await import("../js/cloud.js");
  const listeners = {};
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.location = { hash: "", pathname: "/simut/", search: "" };
  globalThis.history = { replaceState: (_s, _t, url) => { const i = url.indexOf("#"); location.hash = i >= 0 ? url.slice(i) : ""; } };
  globalThis.window = { addEventListener: (t, fn) => { listeners[t] = fn; }, scrollTo: () => {} };
  const view = { replaceChildren: () => {} };
  const page = { mount: () => null };
  const keys = [];
  const router = startRouter({
    view, resolve: () => ({ page, ctx: {} }),
    guardCtx: () => ({ profile: DONE, animals: [SIMUT] }),
    readKey: () => { const k = getKey(); if (k) keys.push(k); },
  });
  router.start();
  assert.equal(location.hash, "#/animais");
  // a pessoa cola o link com a chave na mesma aba
  const KEY = "chave-ficticia-ok-0123456789abcdefghij";
  location.hash = `#k=${KEY}`;
  listeners.hashchange();
  assert.deepEqual(keys, [KEY]);
  assert.equal(store.get("simut.cloudKey"), KEY);
  assert.equal(location.hash, "#/animais");
});
