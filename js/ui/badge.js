// Selo de origem do dado (plano, seção 7.6) e popover de explicação ("?").
// O selo sempre tem texto e ícone, nunca só cor.

import { h, icon, uniqueId } from "./dom.js?v=10";
import { placePopover } from "./place.js?v=10";

export const ORIGINS = {
  observado: {
    label: "Observado", icon: "eye",
    text: "Registrado diretamente: pacotes brutos do sensor, relógio do sensor, nome Bluetooth ou marcações feitas por você. Nada foi calculado.",
  },
  processado: {
    label: "Processado", icon: "gear",
    text: "Calculado a partir dos dados brutos (janelas de 60 s, classes, resumos). Depende de parâmetros ainda provisórios: taxa de amostragem e limiares. Estimativa, não diagnóstico.",
  },
  estimado: {
    label: "Estimado", icon: "approx",
    text: "Valor suposto ou aproximado, ainda sem confirmação: taxa de amostragem, limiares, nível de bateria, durações reconstruídas.",
  },
  ausente: {
    label: "Sem dados", icon: "empty",
    text: "Não há medição neste período. Ausência de dados não é repouso nem zero: aparece hachurada.",
  },
  ml: {
    label: "ML, em desenvolvimento", icon: "spark",
    text: "Modelos de machine learning ainda não existem. Os pacotes brutos ficam guardados para treiná-los no futuro.",
  },
  validado: {
    label: "Validado", icon: "shield",
    text: "Conferido contra observação direta em pelo menos duas sessões de validação, com concordância substancial (kappa a partir de 0,6).",
  },
};

let openPop = null;

// Popover em position: fixed, preso à tela (ui/place.js): nunca sai pela lateral nem por baixo.
function position() {
  if (!openPop) return;
  const { btn, pop } = openPop;
  const b = btn.getBoundingClientRect();
  const vp = { width: document.documentElement.clientWidth, height: window.innerHeight };
  const p = placePopover(b, { width: pop.offsetWidth, height: pop.offsetHeight }, vp);
  pop.style.left = `${p.left}px`;
  pop.style.top = `${p.top}px`;
  pop.classList.toggle("above", p.above);
}
window.addEventListener("resize", position);
window.addEventListener("scroll", position, { passive: true, capture: true });

function closeOpen(restoreFocus = false) {
  if (!openPop) return;
  const { btn, pop } = openPop;
  pop.hidden = true;
  btn.setAttribute("aria-expanded", "false");
  openPop = null;
  if (restoreFocus) btn.focus();
}

document.addEventListener("click", (e) => {
  if (openPop && !openPop.wrap.contains(e.target)) closeOpen();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openPop) { e.stopPropagation(); closeOpen(true); }
});

// Botão "?" com popover. content: texto, nó ou lista de parágrafos.
// helpButton({ label: "O que é um actograma?", title, content })
export function helpButton({ label, title = "", content }) {
  const popId = uniqueId("pop");
  const paras = Array.isArray(content) ? content : [content];
  const pop = h("div", { class: "popover", id: popId, role: "note", hidden: true },
    title ? h("p", { class: "popover-title" }, title) : null,
    paras.map((p) => (p instanceof Node ? p : h("p", {}, p))),
  );
  const btn = h("button", { type: "button", class: "help-btn", "aria-expanded": "false", "aria-controls": popId, "aria-label": label }, "?");
  const wrap = h("span", { class: "popover-wrap" }, btn, pop);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = openPop?.btn === btn;
    closeOpen();
    if (!isOpen) {
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      openPop = { btn, pop, wrap };
      position();
    }
  });
  return wrap;
}

// badge("estimado", { detail: "Taxa de 32 Hz suposta." , help: true })
export function badge(kind, { detail = "", help = true, label = null } = {}) {
  const o = ORIGINS[kind] || ORIGINS.processado;
  const text = label || o.label;
  const el = h("span", { class: "badge-origin", dataset: { kind } }, icon(o.icon), h("span", {}, text));
  if (help) {
    el.append(helpButton({
      label: `O que significa "${text}"?`,
      title: text,
      content: detail ? [o.text, detail] : [o.text],
    }));
  }
  return el;
}
