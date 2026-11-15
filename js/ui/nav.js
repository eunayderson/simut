// Navegação por seção (plano, 7.5): sidebar no desktop (expandida, recolhível), sidebar compacta
// no tablet (expande como overlay), topbar e barra inferior no mobile. Onboarding e grade não têm navegação.
//
// const nav = createNav({ navigate }); nav.update({ route, animal })

import { h, icon, trapFocus } from "./dom.js?v=10";
import { SECTIONS, SECTION_LABEL, animalPath } from "../router.js?v=10";
import { loadNavCollapsed, saveNavCollapsed } from "../store.js?v=10";
import { animalAvatar } from "./animal-art.js?v=10";

const SECTION_ICON = { "visao-geral": "overview", avancado: "flask", sensor: "sensor", dados: "database", opcoes: "sliders" };
const SHORT = { "visao-geral": "Geral", avancado: "Avançado", sensor: "Sensor", dados: "Dados", opcoes: "Opções" };

const mqTablet = window.matchMedia("(min-width: 768px)");
const mqDesktop = window.matchMedia("(min-width: 1024px)");
const mode = () => (mqDesktop.matches ? "desktop" : mqTablet.matches ? "tablet" : "mobile");

export function createNav() {
  const body = document.body;
  const sidebar = document.getElementById("sidebar");
  const topbar = document.getElementById("topbar");
  const bottombar = document.getElementById("bottombar");
  const backdrop = document.getElementById("navBackdrop");

  let collapsed = loadNavCollapsed();
  let open = false;           // overlay no tablet
  let releaseTrap = null;
  let current = { route: null, animal: null };

  const links = (cls) => SECTIONS.map((s) => {
    const a = h("a", { class: cls, href: "#", dataset: { section: s } },
      icon(SECTION_ICON[s]),
      h("span", { class: "nav-label" }, SECTION_LABEL[s]),
      h("span", { class: "nav-short", "aria-hidden": "true" }, SHORT[s]));
    return a;
  });

  // ---------- sidebar ----------
  const toggleBtn = h("button", { type: "button", class: "sb-toggle icon-btn", "aria-controls": "sidebar" });
  const sbName = h("span", { class: "sb-animal-name" });
  const sbArt = h("div", { class: "sb-art", "aria-hidden": "true" });
  const sbAvatar = h("span", { class: "sb-avatar", "aria-hidden": "true" });
  const sbLinks = links("sb-link");
  sidebar.replaceChildren(
    h("div", { class: "sb-top" },
      h("a", { class: "logo", href: "#/animais", "aria-label": "SIMUT, ir para seus animais" }, h("span", { class: "logo-mark", "aria-hidden": "true" }, "S"), h("span", { class: "logo-text" }, "SIMUT")),
      toggleBtn),
    h("div", { class: "sb-animal" }, sbAvatar,
      h("div", { class: "sb-animal-text" }, sbName,
        h("a", { class: "sb-switch", href: "#/animais" }, icon("swap"), h("span", {}, "Trocar animal")))),
    h("nav", { class: "sb-nav", "aria-label": "Seções" }, h("ul", {}, sbLinks.map((a) => h("li", {}, a)))),
    sbArt,
  );

  // ---------- topbar (mobile) ----------
  const tbName = h("span", { class: "tb-name" });
  topbar.replaceChildren(
    h("a", { class: "logo", href: "#/animais", "aria-label": "SIMUT, ir para seus animais" }, h("span", { class: "logo-mark", "aria-hidden": "true" }, "S"), h("span", { class: "logo-text" }, "SIMUT")),
    tbName,
    h("a", { class: "btn sm ghost tb-switch", href: "#/animais" }, icon("swap"), h("span", {}, "Trocar")),
  );

  // ---------- barra inferior (mobile) ----------
  const bbLinks = links("bb-link");
  bottombar.replaceChildren(h("ul", {}, bbLinks.map((a) => h("li", {}, a))));

  function applyLayout() {
    const m = mode();
    if (m !== "tablet" && open) setOpen(false, false);
    const sb = m === "mobile" ? "none" : m === "tablet" ? (open ? "overlay" : "compact") : (collapsed ? "compact" : "expanded");
    body.dataset.sidebar = sb;
    backdrop.hidden = sb !== "overlay";
    if (m === "tablet") {
      toggleBtn.replaceChildren(icon(open ? "close" : "menu"));
      toggleBtn.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
      toggleBtn.setAttribute("aria-expanded", String(open));
    } else {
      toggleBtn.replaceChildren(icon(collapsed ? "chevronRight" : "chevronLeft"));
      toggleBtn.setAttribute("aria-label", collapsed ? "Expandir menu" : "Recolher menu");
      toggleBtn.setAttribute("aria-expanded", String(!collapsed));
    }
  }

  function setOpen(v, focus = true) {
    open = v;
    releaseTrap?.(); releaseTrap = null;
    if (open) {
      releaseTrap = trapFocus(sidebar);
      applyLayout();
      if (focus) sidebar.querySelector(".sb-link[aria-current='page']")?.focus();
    } else {
      applyLayout();
      if (focus) toggleBtn.focus();
    }
  }

  toggleBtn.addEventListener("click", () => {
    if (mode() === "tablet") setOpen(!open);
    else { collapsed = !collapsed; saveNavCollapsed(collapsed); applyLayout(); }
  });
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open && !document.querySelector("dialog[open]")) setOpen(false);
  });
  sidebar.addEventListener("click", (e) => { if (open && e.target.closest("a")) setOpen(false, false); });
  mqTablet.addEventListener("change", applyLayout);
  mqDesktop.addEventListener("change", applyLayout);

  function update({ route, animal }) {
    current = { route, animal };
    const app = route?.name === "animal" && !!animal;
    body.dataset.layout = app ? "app" : "plain";
    if (!app) { if (open) setOpen(false, false); applyLayout(); return; }
    for (const a of [...sbLinks, ...bbLinks]) {
      const s = a.dataset.section;
      a.href = animalPath(animal.id, s);
      if (s === route.section) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      a.title = SECTION_LABEL[s];
    }
    sbName.textContent = animal.name;
    tbName.textContent = animal.name;
    sbAvatar.replaceChildren(animalAvatar(animal, { size: 40 }));
    sbArt.replaceChildren(animalAvatar(animal, { size: 160, art: true }));
    applyLayout();
  }

  applyLayout();
  return { update, get state() { return { ...current, collapsed, open }; } };
}
