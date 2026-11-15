// Onboarding (provisório até a tarefa 12).

import { h } from "../ui/dom.js?v=10";

export function mount(el) {
  el.append(h("div", { class: "page-head" }, h("h1", {}, "Cadastro em breve")),
    h("p", {}, h("a", { href: "#/animais" }, "Voltar para seus animais")));
}
