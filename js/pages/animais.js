// Seus animais (provisória): lista simples com link para a Visão Geral de cada um.

import { h } from "../ui/dom.js?v=10";
import { activeAnimals } from "../state.js?v=10";
import { animalPath } from "../router.js?v=10";

export function mount(el) {
  const list = activeAnimals();
  el.append(
    h("header", { class: "page-head" }, h("div", { class: "page-title" }, h("h1", {}, "Seus animais"))),
    list.length
      ? h("ul", { class: "plain-list" }, list.map((a) => h("li", {}, h("a", { href: animalPath(a.id) }, a.name))))
      : h("p", { class: "muted" }, "Nenhum animal cadastrado neste aparelho ainda."),
  );
}
