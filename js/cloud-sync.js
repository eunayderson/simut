// Junção do estado local com o que voltou da nuvem (puro, testado em tests/cloud-sync.test.mjs).
// O sync da nuvem leva segundos; o que a pessoa fizer nesse meio tempo (marcar, desfazer,
// editar, adicionar animal) está em "current" e não pode ser revertido pelo resultado antigo.

import { mergeMarkLists, mergeTombstones } from "./validation.js?v=10";
import { mergeAnimals, mergeProfile } from "./animals.js?v=10";
import { mergeEvents } from "./metrics.js?v=10";

// current: estado atual (depois do await). fetched: o que a nuvem devolveu.
// toPush e pushProfile dizem o que mudou aqui no meio e ainda precisa subir (próxima rodada).
export function reconcile(current, fetched) {
  const deleted = mergeTombstones(current.deleted || [], fetched.deleted || []);
  const out = { deleted, marks: mergeMarkLists(fetched.marks || [], current.marks || [], { deleted }) };
  if ("animals" in fetched) {
    const a = mergeAnimals(current.animals || [], fetched.animals || []);
    out.animals = a.animals;
    out.toPush = a.toPush;
  }
  if ("profile" in fetched) {
    const p = mergeProfile(current.profile || null, fetched.profile || null);
    out.profile = p.profile;
    out.pushProfile = p.push;
  }
  if ("events" in fetched) out.events = mergeEvents(fetched.events || [], current.events || []);
  return out;
}

// Fila de 1: chamar durante uma execução agenda uma (só uma) nova execução logo depois.
// run.idle() resolve quando não há nada rodando nem agendado.
export function coalesce(fn) {
  let running = null, again = false;
  const run = () => {
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do { again = false; try { await fn(); } catch { /* fn trata os próprios erros */ } } while (again);
      } finally { running = null; }
    })();
    return running;
  };
  run.idle = () => running || Promise.resolve();
  return run;
}
