// Estado central do painel e emissor de mudanças.
// As páginas leem daqui e assinam on((motivo) => ...); ninguém guarda cópia global própria.
//
// motivo: "data" (syncs, janelas, marcações), "animals" (perfil e animais), "cloud" (estado da nuvem),
//         "sensor" (sincronização em andamento), "settings" (parâmetros de análise)

import { loadSettings, loadAnimals, loadProfile, saveAnimals, saveProfile, getLastSync } from "./store.js?v=10";
import { loadMarks } from "./validation.js?v=10";
import { findAnimal, syncsFor, effectiveSettings } from "./animals.js?v=10";
import { buildEpochs } from "./analysis.js?v=10";

export const state = {
  settings: loadSettings(),   // globais (propriedades do sensor + limiares padrão)
  syncs: [],                  // todos os downloads deste aparelho (todos os animais)
  marks: loadMarks(),         // todas as marcações de validação (todos os animais)
  animals: loadAnimals(),
  profile: loadProfile(),
  cloudKey: null,
  cloudBusy: false,
  cloudPending: false,        // há chave e o perfil da nuvem ainda não foi lido
  cloud: { text: "Desligada", ok: null },
  animalId: null,             // animal da rota atual
  epochs: [],                 // janelas do animal atual (settings efetivas)
  samples: 0,
  day: Date.now(),            // dia selecionado na Visão Geral
  bt: "ok",                   // resultado de bluetoothSupport()
  sensorUi: { phase: "off", text: "Sensor desconectado", pct: null, progress: "", clock: null, level: null, busy: false },
};

const subs = new Set();

export function on(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function emit(reason = "data") {
  for (const fn of [...subs]) {
    try { fn(reason, state); } catch (e) { setTimeout(() => { throw e; }); } // aparece no banner de erro
  }
}

export const currentAnimal = () => findAnimal(state.animals, state.animalId);
export const animalSyncs = (id = state.animalId) => syncsFor(state.syncs, id);
export const settingsFor = (animal = currentAnimal()) => effectiveSettings(state.settings, animal);
export const activeAnimals = () => state.animals.filter((a) => !a.archived);

// Último download do animal: o maior entre o registrado e o sync mais recente guardado.
export function lastDownload(id) {
  const reg = getLastSync(id) || 0;
  const list = syncsFor(state.syncs, id);
  const last = list.length ? Number(list[list.length - 1].id) : 0;
  return Math.max(reg, last) || null;
}

// Recalcula as janelas do animal atual (só os downloads dele, com os limiares dele).
export function recompute() {
  const a = currentAnimal();
  if (!a) { state.epochs = []; state.samples = 0; }
  else {
    const r = buildEpochs(animalSyncs(a.id), settingsFor(a));
    state.epochs = r.epochs; state.samples = r.totalSamples;
  }
  emit("data");
}

// Troca o animal atual. Devolve true se mudou.
export function setAnimal(id) {
  if (state.animalId === id) return false;
  state.animalId = id;
  state.day = Date.now();
  recompute();
  return true;
}

export function setAnimals(list) {
  state.animals = list;
  saveAnimals(list);
  emit("animals");
}

export function setProfile(p) {
  state.profile = p;
  saveProfile(p);
  emit("animals");
}

// Grava um animal (novo ou editado), carimbando updatedAt.
export function upsertAnimal(animal, now = Date.now()) {
  const a = { ...animal, updatedAt: now };
  const i = state.animals.findIndex((x) => x.id === a.id);
  const list = state.animals.slice();
  if (i >= 0) list[i] = a; else list.push(a);
  setAnimals(list);
  return a;
}
