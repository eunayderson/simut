// Seus animais (plano, 5.2): grade de cards. Aparece sempre que a pessoa entra (mesmo com um animal só).
// O último animal usado vem primeiro, com o destaque "Continuar". O último card leva ao onboarding
// para adicionar um animal (sem perguntar o nome da pessoa de novo).

import { h, icon } from "../ui/dom.js?v=10";
import { on, lastDownload } from "../state.js?v=10";
import { animalPath } from "../router.js?v=10";
import { loadLastAnimal } from "../store.js?v=10";
import { SPECIES, breedLabel } from "../animals.js?v=10";
import { animalAvatar } from "../ui/animal-art.js?v=10";
import { fmtDate } from "../format.js?v=10";

export function mount(el, ctx) {
  const { state } = ctx;
  let showArchived = false;
  const grid = h("ul", { class: "animal-grid", role: "list" });
  const hello = h("p", { class: "page-sub" });
  const optLink = h("a", { class: "btn sm ghost", href: "#/animais" }, icon("sliders"), h("span", {}, "Opções gerais"));
  const who = h("span", { class: "gt-user" });
  const filterBox = h("div", { class: "grid-filter" });

  el.append(
    h("div", { class: "grid-top" },
      h("a", { class: "logo", href: "#/animais", "aria-label": "SIMUT, início" }, h("span", { class: "logo-mark", "aria-hidden": "true" }, "S"), h("span", { class: "logo-text" }, "SIMUT")),
      h("div", { class: "gt-right" }, who, optLink)),
    h("header", { class: "page-head" }, h("div", { class: "page-title" }, h("h1", {}, "Seus animais"), hello), filterBox),
    grid,
  );

  function sensorChip(a) {
    const s = (a.sensors || [])[0];
    return s
      ? h("span", { class: "chip static mono" }, icon("sensor"), s.name)
      : h("span", { class: "chip static muted-chip" }, "Sem sensor");
  }

  function animalCard(a, isLast) {
    const sp = a.species === "outro" ? (a.speciesOther || SPECIES.outro) : SPECIES[a.species] || "";
    const desc = [sp, breedLabel(a.breed)].filter(Boolean).join(", ");
    const last = lastDownload(a.id);
    const id = `ac-${a.id}`;
    return h("li", {},
      h("a", { class: `animal-card${isLast ? " is-last" : ""}${a.archived ? " is-archived" : ""}`, href: animalPath(a.id), "aria-labelledby": isLast ? `${id} ${id}-c` : id, "aria-describedby": `${id}-d` },
        isLast ? h("span", { class: "continue-badge", id: `${id}-c` }, "Continuar") : null,
        animalAvatar(a, { size: 72 }),
        h("span", { class: "ac-name", id }, a.name),
        h("span", { class: "ac-desc", id: `${id}-d` },
          desc || "Sem detalhes",
          h("br"),
          last ? `Último download: ${fmtDate(last)}` : "Sem downloads",
          a.archived ? h("span", {}, h("br"), "Arquivado") : null),
        sensorChip(a)));
  }

  function render() {
    const name = state.profile?.name;
    hello.textContent = name ? `Olá, ${name}. Escolha quem você quer acompanhar.` : "Escolha quem você quer acompanhar.";
    who.textContent = name || "";
    const lastId = loadLastAnimal();
    const archivedCount = state.animals.filter((a) => a.archived).length;
    const list = state.animals.filter((a) => showArchived || !a.archived);
    // último usado primeiro; os demais na ordem de cadastro
    list.sort((a, b) => (b.id === lastId) - (a.id === lastId));
    const firstActive = list.find((a) => !a.archived);
    optLink.href = firstActive ? animalPath(firstActive.id, "opcoes") : "#/animais";
    optLink.hidden = !firstActive;

    filterBox.replaceChildren();
    if (archivedCount) {
      const cb = h("input", { type: "checkbox", id: "showArchived", checked: showArchived, onchange: (e) => { showArchived = e.target.checked; render(); } });
      filterBox.append(h("label", { class: "check", for: "showArchived" }, cb, `Mostrar arquivados (${archivedCount})`));
    }

    grid.replaceChildren(
      ...list.map((a) => animalCard(a, a.id === lastId && !a.archived)),
      h("li", {}, h("a", { class: "animal-card add-card", href: "#/onboarding?fluxo=adicionar" },
        h("span", { class: "add-icon", "aria-hidden": "true" }, icon("plus")),
        h("span", { class: "ac-name" }, "Adicionar animal"),
        h("span", { class: "ac-desc" }, "Cadastre outro animal para acompanhar"))),
    );
  }

  const off = on((r) => { if (r === "animals" || r === "data") render(); });
  render();
  return { unmount() { off(); } };
}
