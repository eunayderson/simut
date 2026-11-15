// Visão Geral (provisória): faixa de estado, resumo do dia, noite, momentos ativos e tendência.

import { h, icon } from "../ui/dom.js?v=10";
import { pageHead, card, stat } from "../ui/page.js?v=10";
import { on, settingsFor, lastDownload } from "../state.js?v=10";
import { daySummary, nightSummary, trend, dayBouts } from "../analysis.js?v=10";
import { fmtMin, hhmm, fmtWeekday, fmtDateTime, isToday } from "../format.js?v=10";
import { animalSubtitle } from "../animals.js?v=10";
import { animalAvatar } from "../ui/animal-art.js?v=10";
import { createTrend } from "../charts/trend.js?v=10";

export function mount(el, ctx) {
  const { state, animal, app } = ctx;
  const DAY = 86400000;

  const syncBtn = h("button", { class: "btn primary", type: "button", onclick: () => app.syncSensor({ withToast: true }) }, icon("sync"), "Sincronizar sensor");
  const lastP = h("span", {});
  const cloudP = h("span", {});
  const dayLabel = h("span", { class: "day-label", "aria-live": "polite" });
  const prev = h("button", { class: "icon-btn", type: "button", "aria-label": "Dia anterior", onclick: () => { state.day -= DAY; render(); } }, icon("chevronLeft"));
  const next = h("button", { class: "icon-btn", type: "button", "aria-label": "Próximo dia", onclick: () => { if (!isToday(state.day)) { state.day += DAY; render(); } } }, icon("chevronRight"));
  const sentence = h("p", { class: "summary" });
  const stats = h("div", { class: "stats" });
  const night = h("div", { class: "stats three" });
  const bouts = h("ul", { class: "bouts" });
  const trendHost = h("div");

  el.append(
    pageHead(animal.name, "Visão Geral"),
    h("div", { class: "page-grid" },
      h("section", { class: "card span-12 status-strip" },
        animalAvatar(animal, { size: 56 }),
        h("div", { class: "strip-text" },
          h("p", { class: "strip-name" }, animal.name),
          h("p", { class: "small muted" }, animalSubtitle(animal) || "Sem detalhes cadastrados"),
          h("p", { class: "small strip-meta" }, lastP, cloudP)),
        syncBtn),
      card({ title: "Resumo do dia", span: 12, tools: h("div", { class: "daynav" }, prev, dayLabel, next) }, sentence, stats),
      card({ title: "Noite", sub: "22h às 6h", span: 4 }, night),
      card({ title: "Momentos ativos", sub: "2 minutos ou mais", span: 8 }, bouts),
      card({ title: "Últimos 14 dias", sub: "minutos ativos por dia", span: 12 }, trendHost)),
  );

  const tr = createTrend(trendHost, { onSelectDay: (d) => { state.day = d; render(); } });

  function summarySentence(day, tot, covered) {
    if (!covered) return `Sem dados neste dia. Sincronize o sensor para ver como ${animal.name} passou o dia.`;
    const active = tot.light + tot.vig;
    const nb = dayBouts(state.epochs, day, settingsFor(animal)).length;
    const quando = isToday(day) ? "Hoje" : "Neste dia";
    return `${quando}, em ${fmtMin(covered)} medidos, ${animal.name} ficou ${fmtMin(tot.rest)} em repouso e ${fmtMin(active)} em movimento${tot.vig ? ` (${fmtMin(tot.vig)} intenso)` : ""}, com ${nb} ${nb === 1 ? "momento ativo" : "momentos ativos"}.`;
  }

  function render() {
    const s = settingsFor(animal);
    const last = lastDownload(animal.id);
    lastP.textContent = last ? `Último download: ${fmtDateTime(last)}. ` : "Nenhum download ainda. ";
    cloudP.textContent = `Nuvem: ${state.cloud.text}`;
    syncBtn.disabled = state.sensorUi.busy;
    dayLabel.textContent = isToday(state.day) ? "Hoje" : fmtWeekday(state.day);
    next.disabled = isToday(state.day);

    const d = daySummary(state.epochs, state.day, s);
    const has = d.coveredMin > 0;
    stats.replaceChildren(
      stat("Repouso", has ? fmtMin(d.tot.rest) : null, "rest"),
      stat("Leve", has ? fmtMin(d.tot.light) : null, "light"),
      stat("Intenso", has ? fmtMin(d.tot.vig) : null, "vig"),
      stat("Tempo medido", has ? fmtMin(d.coveredMin) : null, "cov"));
    sentence.textContent = summarySentence(state.day, d.tot, d.coveredMin);

    const n = nightSummary(state.epochs, state.day, s);
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
    }) : [h("li", { class: "empty-li" }, "Nenhum momento ativo de 2 minutos ou mais neste dia.")]));

    tr.update({ rows: trend(state.epochs, Date.now(), s, 14), selectedDay: new Date(state.day).setHours(0, 0, 0, 0) });
  }

  const off = on((reason) => { if (reason !== "settings") render(); });
  render();
  return { unmount() { off(); tr.destroy(); } };
}
