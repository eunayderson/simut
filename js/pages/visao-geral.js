// Visão Geral (plano, 5.3): faixa de estado, resumo do dia, actograma, tendência, perfil de 24 h,
// noite, momentos ativos e explicações. O dia selecionado é o mesmo no resumo, no actograma,
// na tendência e no perfil.

import { h, icon } from "../ui/dom.js?v=10";
import { pageHead, card, stat } from "../ui/page.js?v=10";
import { on, settingsFor, lastDownload } from "../state.js?v=10";
import { daySummary, nightSummary, trend, dayBouts, actogramRows, profile24 } from "../analysis.js?v=10";
import { fmtMin, hhmm, fmtWeekday, fmtDateTime, fmtDayMonth, isToday, plural } from "../format.js?v=10";
import { animalSubtitle } from "../animals.js?v=10";
import { marksOf } from "../validation.js?v=10";
import { animalAvatar } from "../ui/animal-art.js?v=10";
import { createActogram } from "../charts/actogram.js?v=10";
import { createTrend } from "../charts/trend.js?v=10";
import { createProfile24 } from "../charts/profile24.js?v=10";
import { animalPath } from "../router.js?v=10";
import { processedDetail, EXPLAIN } from "./explain.js?v=10";
import { badge, ORIGINS } from "../ui/badge.js?v=10";

const DAY = 86400000;
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Segmentado simples (7 ou 14 dias). onChange(valor)
export function daysToggle(value, onChange, label = "Período") {
  const wrap = h("div", { class: "segmented sm", role: "radiogroup", "aria-label": label });
  const btns = [7, 14].map((n) => h("button", { type: "button", class: "seg-btn", role: "radio", "aria-checked": String(n === value), tabindex: n === value ? "0" : "-1", dataset: { v: String(n) } }, `${n} dias`));
  const set = (n, focus = false) => {
    for (const b of btns) { const on2 = Number(b.dataset.v) === n; b.setAttribute("aria-checked", String(on2)); b.tabIndex = on2 ? 0 : -1; if (on2 && focus) b.focus(); }
    onChange(n);
  };
  btns.forEach((b) => {
    b.addEventListener("click", () => set(Number(b.dataset.v)));
    b.addEventListener("keydown", (e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); set(Number(b.dataset.v) === 7 ? 14 : 7, true); } });
  });
  wrap.append(...btns);
  return wrap;
}

export function mount(el, ctx) {
  const { state, animal, app, navigate } = ctx;
  let actoDays = 7, trendDays = 7, range = null;

  // ---------- faixa de estado ----------
  const syncBtn = h("button", { class: "btn primary", type: "button", onclick: () => app.syncSensor({ withToast: true }) }, icon("sync"), "Sincronizar sensor");
  const sensorChip = h("span", { class: "chip static mono" });
  const lastP = h("span", {});
  const cloudP = h("span", { class: "cloud-state" });

  // ---------- resumo do dia ----------
  const dayLabel = h("span", { class: "day-label", "aria-live": "polite" });
  const prev = h("button", { class: "icon-btn", type: "button", "aria-label": "Dia anterior", onclick: () => setDay(state.day - DAY) }, icon("chevronLeft"));
  const next = h("button", { class: "icon-btn", type: "button", "aria-label": "Próximo dia", onclick: () => { if (!isToday(state.day)) setDay(state.day + DAY); } }, icon("chevronRight"));
  const todayBtn = h("button", { class: "btn sm ghost", type: "button", onclick: () => setDay(Date.now()) }, "Hoje");
  const sentence = h("p", { class: "summary" });
  const stats = h("div", { class: "stats" });

  // ---------- actograma ----------
  const actoHost = h("div");
  const selPanel = h("div", { class: "sel-panel", hidden: true, "aria-live": "polite" });
  const legend = h("ul", { class: "legend" },
    h("li", {}, h("span", { class: "sw rest", "aria-hidden": "true" }), "Repouso"),
    h("li", {}, h("span", { class: "sw light", "aria-hidden": "true" }), "Leve"),
    h("li", {}, h("span", { class: "sw vig", "aria-hidden": "true" }), "Intenso"),
    h("li", {}, h("span", { class: "sw none", "aria-hidden": "true" }), "Sem dados"),
    h("li", {}, h("span", { class: "sw line", "aria-hidden": "true" }), "Agora"));

  const trendHost = h("div");
  const profHost = h("div");
  const night = h("div", { class: "stats three" });
  const nightSub = h("p", { class: "card-sub" });
  const bouts = h("ul", { class: "bouts" });

  const s0 = settingsFor(animal);
  el.append(
    pageHead(animal.name, "Visão Geral"),
    h("div", { class: "page-grid" },
      h("section", { class: "card span-12 status-strip", "aria-label": "Estado do monitoramento" },
        animalAvatar(animal, { size: 56 }),
        h("div", { class: "strip-text" },
          h("p", { class: "strip-name" }, animal.name),
          h("p", { class: "small muted" }, animalSubtitle(animal) || "Sem detalhes cadastrados"),
          h("p", { class: "small strip-meta" }, sensorChip, lastP, cloudP)),
        syncBtn),
      card({ title: "Resumo do dia", span: 12, sub: `Minutos por classe no dia, só nos trechos medidos. Janelas de ${s0.epoch} s.`, origin: { kind: "processado", detail: processedDetail(s0) }, tools: h("div", { class: "daynav" }, prev, dayLabel, next, todayBtn) }, sentence, stats),
      card({
        title: "Actograma", span: 12, id: "actograma",
        sub: `Atividade por hora, um dia por linha (hoje embaixo). Janelas de ${s0.epoch} s, horário do aparelho.`,
        help: { label: "O que é um actograma?", title: "O que é um actograma?", content: EXPLAIN.actogram },
        origin: { kind: "processado", detail: processedDetail(s0) },
        tools: daysToggle(actoDays, (n) => { actoDays = n; renderActo(); }, "Dias no actograma"),
      }, actoHost, legend, selPanel),
      card({
        title: "Tendência", span: 7, sub: "Minutos ativos (leve mais intenso) por dia, janelas de 60 s. A faixa cinza embaixo mostra quanto do dia foi medido.",
        help: { label: "Como ler a tendência?", title: "Tendência", content: EXPLAIN.trend },
        origin: { kind: "processado", detail: processedDetail(s0) },
        tools: daysToggle(trendDays, (n) => { trendDays = n; renderTrend(); }, "Dias na tendência"),
      }, trendHost),
      card({
        title: "Perfil de 24 horas", span: 5, sub: "Intensidade média (mg) a cada 30 min nos últimos 7 dias; a linha é o dia selecionado.",
        help: { label: "Como ler o perfil de 24 horas?", title: "Perfil de 24 horas", content: EXPLAIN.profile },
        origin: { kind: "processado", detail: processedDetail(s0) },
      }, profHost),
      card({ title: "Noite", span: 4, origin: { kind: "processado", detail: processedDetail(s0) } }, nightSub, night),
      card({ title: "Momentos ativos", sub: `Trechos de 2 minutos ou mais em movimento no dia selecionado (janelas de ${s0.epoch} s, pausas de até 2 janelas).`, span: 8, origin: { kind: "processado", detail: processedDetail(s0) } }, bouts),
      h("section", { class: "card span-12 explain", "aria-labelledby": "explain-h" },
        h("h2", { id: "explain-h" }, "Explicações"),
        EXPLAIN.panels.map(([q, paras]) => h("details", {}, h("summary", {}, q), paras.map((p) => h("p", {}, p)))),
        h("details", {}, h("summary", {}, "O que significam os selos de origem?"),
          h("ul", { class: "origin-legend" }, Object.keys(ORIGINS).map((k) => h("li", {}, badge(k, { help: false }), h("span", { class: "small" }, ORIGINS[k].text)))))),
    ),
  );

  const acto = createActogram(actoHost, {
    label: `Actograma de ${animal.name}`,
    onSelectDay: (d) => { if (dayStart(state.day) !== d) { state.day = d; renderDay(); renderTrend(); renderProfile(); } },
    onSelectRange: (r) => { range = r; renderSelection(); },
  });
  const tr = createTrend(trendHost, { onSelectDay: (d) => setDay(d) });
  const pf = createProfile24(profHost);

  function setDay(t) {
    state.day = Math.min(Date.now(), t);
    range = null;
    acto.clearSelection();
    renderAll();
  }

  function summarySentence(day, tot, covered) {
    if (!covered) return `Sem dados neste dia. Ausência de dados não é repouso: sincronize o sensor para ver como ${animal.name} passou o dia.`;
    const active = tot.light + tot.vig;
    const nb = dayBouts(state.epochs, day, settingsFor(animal)).length;
    const quando = isToday(day) ? "Hoje" : "Neste dia";
    return `${quando}, em ${fmtMin(covered)} medidos, ${animal.name} ficou ${fmtMin(tot.rest)} em repouso e ${fmtMin(active)} em movimento${tot.vig ? ` (${fmtMin(tot.vig)} intenso)` : ""}, com ${plural(nb, "momento ativo", "momentos ativos")}. O resto do dia não foi medido. Estimativa, não diagnóstico.`;
  }

  function renderStrip() {
    const sn = (animal.sensors || [])[0]?.name;
    sensorChip.replaceChildren(icon("sensor"), sn || "Sem sensor");
    sensorChip.classList.toggle("muted-chip", !sn);
    const last = lastDownload(animal.id);
    lastP.textContent = last ? `Último download: ${fmtDateTime(last)}` : "Nenhum download ainda";
    cloudP.textContent = `Nuvem: ${state.cloud.text}`;
    cloudP.dataset.ok = state.cloud.ok === null ? "" : String(state.cloud.ok);
    syncBtn.disabled = state.sensorUi.busy;
  }

  function renderDay() {
    const s = settingsFor(animal);
    dayLabel.textContent = isToday(state.day) ? "Hoje" : fmtWeekday(state.day);
    next.disabled = isToday(state.day);
    todayBtn.hidden = isToday(state.day);
    const d = daySummary(state.epochs, state.day, s);
    const has = d.coveredMin > 0;
    stats.replaceChildren(
      stat("Repouso", has ? fmtMin(d.tot.rest) : null, "rest"),
      stat("Leve", has ? fmtMin(d.tot.light) : null, "light"),
      stat("Intenso", has ? fmtMin(d.tot.vig) : null, "vig"),
      stat("Tempo medido", has ? `${fmtMin(d.coveredMin)} de 24h` : null, "cov"));
    sentence.textContent = summarySentence(state.day, d.tot, d.coveredMin);

    const n = nightSummary(state.epochs, state.day, s);
    const prevDay = new Date(dayStart(state.day) - DAY);
    nightSub.textContent = `Das 22h de ${fmtDayMonth(prevDay)} às 6h de ${fmtDayMonth(state.day)}, janelas de ${s.epoch} s${n ? `, em ${fmtMin(n.coveredMin)} medidos` : ", sem medição"}.`;
    night.replaceChildren(
      stat("Tempo em repouso", n ? `${Math.round((n.restMin / n.coveredMin) * 100)}%` : null),
      stat("Despertares", n ? String(n.wakes) : null),
      stat("Maior repouso contínuo", n ? fmtMin(n.longestMin) : null));

    const list = dayBouts(state.epochs, state.day, s);
    bouts.replaceChildren(...(list.length ? list.reverse().map((b) => {
      const min = Math.round((b.end - b.start) / 60000);
      const intense = b.vig / (b.active || 1) >= 0.3;
      return h("li", {}, h("span", { class: `b-dot ${intense ? "vig" : "light"}`, "aria-hidden": "true" }),
        h("span", { class: "b-time" }, `${hhmm(b.start)} às ${hhmm(b.end)}`),
        h("span", { class: "b-dur" }, fmtMin(min)),
        h("span", { class: "b-kind" }, intense ? "intenso" : "leve"));
    }) : [h("li", { class: "empty-li" }, d.coveredMin ? "Nenhum momento ativo de 2 minutos ou mais nos trechos medidos." : "Sem dados neste dia.")]));
  }

  function renderActo() {
    const s = settingsFor(animal);
    acto.update({ rows: actogramRows(state.epochs, Date.now(), s, actoDays), selectedDay: dayStart(state.day), epochSec: s.epoch });
  }
  function renderTrend() {
    tr.update({ rows: trend(state.epochs, Date.now(), settingsFor(animal), trendDays), selectedDay: dayStart(state.day) });
  }
  function renderProfile() {
    const to = dayStart(Date.now()) + DAY, from = to - 7 * DAY;
    const d0 = dayStart(state.day);
    pf.update({
      period: profile24(state.epochs, { from, to, binMin: 30 }),
      day: profile24(state.epochs, { from: d0, to: d0 + DAY, binMin: 30 }),
      periodLabel: "últimos 7 dias", dayLabel: fmtDayMonth(d0),
    });
  }

  function renderSelection() {
    if (!range) { selPanel.hidden = true; selPanel.replaceChildren(); return; }
    const s = settingsFor(animal);
    const min = s.epoch / 60;
    const tot = { rest: 0, light: 0, vig: 0 };
    for (const e of state.epochs) if (e.t >= range.from && e.t < range.to) tot[e.cls] += min;
    const covered = tot.rest + tot.light + tot.vig;
    const span = Math.max(1, Math.round((range.to - range.from) / 60000));
    const marks = marksOf(state.marks, animal.id).filter((m) => m.t >= range.from && m.t < range.to);
    selPanel.hidden = false;
    selPanel.replaceChildren(...[
      h("div", { class: "sel-head" },
        h("p", { class: "sel-title" }, `Período selecionado: ${fmtDayMonth(range.day)}, ${hhmm(range.from)} a ${hhmm(range.to)}`),
        h("button", { type: "button", class: "btn sm ghost", onclick: () => { acto.clearSelection(); } }, icon("close"), "Limpar seleção")),
      covered
        ? h("div", { class: "stats" },
          stat("Repouso", fmtMin(tot.rest), "rest"), stat("Leve", fmtMin(tot.light), "light"), stat("Intenso", fmtMin(tot.vig), "vig"),
          stat("Cobertura", `${Math.round((covered / span) * 100)}% de ${fmtMin(span)}`, "cov"))
        : h("p", { class: "small" }, `Sem dados entre ${hhmm(range.from)} e ${hhmm(range.to)}. Ausência não é repouso.`),
      marks.length
        ? h("p", { class: "small" }, `${plural(marks.length, "marcação", "marcações")} de validação neste período. `,
          h("a", { href: animalPath(animal.id, "avancado"), onclick: (e) => { e.preventDefault(); navigate(animalPath(animal.id, "avancado")); } }, "Ver na sessão de validação"))
        : null].filter(Boolean));
  }

  function renderAll() { renderStrip(); renderDay(); renderActo(); renderTrend(); renderProfile(); renderSelection(); }

  const off = on((reason) => {
    if (reason === "cloud" || reason === "sensor" || reason === "animals") renderStrip();
    else if (reason === "data") renderAll();
  });
  renderAll();
  return { unmount() { off(); acto.destroy(); tr.destroy(); pf.destroy(); } };
}
