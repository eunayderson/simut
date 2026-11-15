// Junção do estado local com o que voltou da nuvem (puro, testado em tests/cloud-sync.test.mjs).
// O sync da nuvem leva segundos; o que a pessoa fizer nesse meio tempo (marcar, desfazer,
// editar, adicionar animal) está em "current" e não pode ser revertido pelo resultado antigo.

import { mergeMarkLists } from "./validation.js?v=10";

// current: estado atual (depois do await). fetched: o que a nuvem devolveu.
export function reconcile(current, fetched) {
  return {
    marks: mergeMarkLists(fetched.marks || [], current.marks || []),
  };
}
