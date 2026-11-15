// Ilustração do animal: o Simut tem desenho próprio; os demais usam o ícone da espécie
// em um círculo sage (discreto, sem infantilizar).

import { h, icon } from "./dom.js?v=10";
import { LEGACY_ANIMAL_ID } from "../animals.js?v=10";

export const SPECIES_ICON = { cao: "dog", gato: "cat", outro: "paw" };

// animalAvatar(animal, { size, art }) art = versão decorativa da sidebar (mais clara)
export function animalAvatar(animal, { size = 48, art = false } = {}) {
  const cls = `animal-avatar${art ? " art" : ""}`;
  if (animal?.id === LEGACY_ANIMAL_ID) {
    return h("img", { class: `${cls} photo`, src: "img/simut.svg", alt: "", width: String(size), height: String(size), style: { width: `${size}px`, height: `${size}px` } });
  }
  const el = h("span", { class: `${cls} species`, style: { width: `${size}px`, height: `${size}px` } }, icon(SPECIES_ICON[animal?.species] || "paw"));
  return el;
}
