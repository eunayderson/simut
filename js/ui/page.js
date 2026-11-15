// Peças comuns das páginas: cabeçalho (h1 com o nome do animal e a seção) e card com selo e "?".

import { h } from "./dom.js?v=10";
import { badge, helpButton } from "./badge.js?v=10";

// pageHead("Simut", "Sensor", { sub, actions })
export function pageHead(title, section = "", { sub = "", actions = null } = {}) {
  return h("header", { class: "page-head" },
    h("div", { class: "page-title" },
      h("h1", {}, title, section ? h("small", {}, section) : null),
      sub ? h("p", { class: "page-sub" }, sub) : null),
    actions ? h("div", { class: "page-actions" }, actions) : null);
}

// card({ title, sub, origin: "processado" | { kind, detail }, help: { label, title, content }, tools, span, id, cls }, ...conteúdo)
export function card({ title, sub = "", origin = null, help = null, tools = null, span = 12, id = null, cls = "", level = "h2" } = {}, ...body) {
  const o = typeof origin === "string" ? { kind: origin } : origin;
  const head = title ? h("div", { class: "card-head" },
    h("div", { class: "card-title" },
      h(level, {}, title, help ? helpButton({ align: "left", ...help }) : null),
      sub ? h("p", { class: "card-sub" }, sub) : null),
    (o || tools) ? h("div", { class: "card-tools" }, tools, o ? badge(o.kind, { detail: o.detail || "" }) : null) : null) : null;
  return h("section", { class: `card span-${span}${cls ? ` ${cls}` : ""}`, id }, head, body);
}

// stat("Repouso", "2h 10", "rest") ou stat("Repouso", null) -> "sem dados"
export function stat(label, value, cls = "") {
  const none = value === null || value === undefined;
  return h("div", { class: `stat${cls ? ` ${cls}` : ""}` },
    h("span", { class: "label" }, label),
    h("span", { class: `value${none ? " none" : ""}` }, none ? "sem dados" : value));
}

// Lista de definições (chave e valor) em grade.
export function kv(items) {
  return h("dl", { class: "kv" }, items.filter(Boolean).map(([k, v, extra = {}]) =>
    h("div", { class: extra.wide ? "wide" : "" }, h("dt", {}, k, extra.badge || null), h("dd", { class: extra.mono ? "mono" : "", id: extra.id || null }, v))));
}
