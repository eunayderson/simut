// Dados (plano, 5.6): histórico de coletas, actograma e tendência de 14 dias, exportações,
// importação de .bin e informação temporal.

import { h, icon } from "../ui/dom.js?v=10";
import { pageHead, card, kv } from "../ui/page.js?v=10";
import { badge } from "../ui/badge.js?v=10";
import { on, animalSyncs, settingsFor, currentAnimal } from "../state.js?v=10";
import { decodePayload, actogramRows, trend } from "../analysis.js?v=10";
import { exportMarks, marksOf } from "../validation.js?v=10";
import { slug, windowsCsv, marksCsv } from "../export.js?v=10";
import { createActogram } from "../charts/actogram.js?v=10";
import { createTrend } from "../charts/trend.js?v=10";
import { fmtDateTime, fmtShort, fmtInt, fmtDec } from "../format.js?v=10";
import { toast } from "../ui/toast.js?v=10";
import { promptModal } from "../ui/modal.js?v=10";
import { processedDetail } from "./explain.js?v=10";

export function download(name, text, type = "text/csv") {
  const blob = new Blob([text], { type });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Amostras decodificadas de um download (mesma decodificação provisória da análise).
const sampleCache = new Map();
function samplesOf(sync) {
  const k = `${sync.id}:${sync.packets.length}`;
  if (!sampleCache.has(k)) {
    let n = 0;
    for (const b of sync.packets) n += decodePayload(b.subarray(4, b.length - 4)).length / 3;
    sampleCache.set(k, n);
  }
  return sampleCache.get(k);
}

export function mount(el, ctx) {
  const { state, app } = ctx;
  const animal = () => currentAnimal() || ctx.animal;
  const a0 = animal();
  const s0 = settingsFor(a0);
  const history = h("div");
  const actoHost = h("div");
  const trendHost = h("div");
  const file = h("input", { type: "file", accept: ".bin", class: "visually-hidden", id: "fileBin", tabindex: "-1" });

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "desconhecido";
  const off = -new Date().getTimezoneOffset() / 60;

  el.append(
    pageHead(a0.name, "Dados"),
    h("div", { class: "page-grid" },
      card({ title: "Histórico de coletas", span: 12, sub: "Todos os downloads deste animal guardados neste aparelho (e na nuvem, se conectada). A duração é estimada pela taxa de amostragem suposta.", origin: "observado" }, history),
      card({ title: "Actograma, 14 dias", span: 12, sub: `Um dia por linha, hoje embaixo. Janelas de ${s0.epoch} s.`, origin: { kind: "processado", detail: processedDetail(s0) } },
        actoHost,
        h("ul", { class: "legend" },
          h("li", {}, h("span", { class: "sw rest", "aria-hidden": "true" }), "Repouso"),
          h("li", {}, h("span", { class: "sw light", "aria-hidden": "true" }), "Leve"),
          h("li", {}, h("span", { class: "sw vig", "aria-hidden": "true" }), "Intenso"),
          h("li", {}, h("span", { class: "sw none", "aria-hidden": "true" }), "Sem dados"))),
      card({ title: "Tendência, 14 dias", span: 12, sub: "Minutos ativos por dia (leve mais intenso), janelas de 60 s; faixa cinza = quanto do dia foi medido.", origin: { kind: "processado", detail: processedDetail(s0) } }, trendHost),
      card({ title: "Exportações", span: 6 },
        h("div", { class: "actions stack-actions" },
          h("button", { class: "btn", type: "button", onclick: exportWindows }, icon("download"), "Exportar janelas (CSV)"),
          h("button", { class: "btn", type: "button", onclick: exportMarksCsv }, icon("download"), "Exportar marcações (CSV)"),
          h("button", { class: "btn", type: "button", onclick: copyMarks }, icon("copy"), "Copiar marcações")),
        h("p", { class: "small muted" }, "O CSV de janelas mantém as colunas de sempre e acrescenta a coluna animal no fim. \"Copiar marcações\" gera o código SIMUT1 para colar em outro aparelho.")),
      card({ title: "Importar", span: 6 },
        h("p", { class: "small" }, `Arquivo .bin baixado pelo script do Mac (tools/baixar_sensor.py). Os pacotes ficam com ${a0.name}.`),
        h("label", { class: "btn", for: "fileBin", tabindex: "0", role: "button", onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } } }, icon("upload"), "Importar .bin do Mac"), file),
      card({ title: "Informação temporal", span: 12, origin: { kind: "estimado", detail: "O horário de cada janela é reconstruído a partir do relógio do sensor e da taxa de amostragem suposta." } },
        kv([
          ["Fuso do aparelho", `${tz} (UTC${off >= 0 ? "+" : ""}${fmtDec(off)})`],
          ["Taxa de amostragem em uso", `${s0.hz} Hz (suposição)`],
          ["Como o horário é reconstruído", "Cada download é ancorado no relógio do sensor ao fim do download e contado para trás pela taxa de amostragem. Se a taxa real for outra, os horários se deslocam proporcionalmente.", { wide: true }],
          ["Horários exibidos", "No fuso deste aparelho. O CSV traz também o horário em UTC (ISO 8601).", { wide: true }],
        ]))),
  );

  const acto = createActogram(actoHost, { interactive: false, label: `Actograma de 14 dias de ${a0.name}` });
  const tr = createTrend(trendHost, { label: "Tendência de 14 dias" });

  function exportWindows() {
    if (!state.epochs.length) { toast("Ainda não há dados para exportar."); return; }
    download(`simut-${slug(animal().name)}-janelas-${new Date().toISOString().slice(0, 10)}.csv`, windowsCsv(state.epochs, animal().id));
  }
  function exportMarksCsv() {
    const m = marksOf(state.marks, animal().id);
    if (!m.length) { toast("Nenhuma marcação de validação deste animal."); return; }
    download(`simut-${slug(animal().name)}-marcacoes-${new Date().toISOString().slice(0, 10)}.csv`, marksCsv(m));
  }
  async function copyMarks() {
    const m = marksOf(state.marks, animal().id);
    if (!m.length) { toast("Nenhuma marcação de validação deste animal."); return; }
    const code = exportMarks(m);
    try { await navigator.clipboard.writeText(code); toast("Marcações copiadas. Cole no outro aparelho em \"Colar marcações\" (Avançado).", { kind: "success" }); }
    catch { await promptModal("Copie este código:", { value: code, multiline: true, mono: true, okLabel: "Fechar" }); }
  }
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    const n = await app.importBin(f);
    file.value = "";
    toast(n ? `${fmtInt(n)} pacotes importados para ${animal().name}.` : "Arquivo sem pacotes reconhecidos.", { kind: n ? "success" : "warning" });
  });

  function renderHistory() {
    const s = settingsFor(animal());
    const syncs = animalSyncs(animal().id).slice().reverse();
    if (!syncs.length) { history.replaceChildren(h("p", { class: "small muted" }, "Nenhuma coleta ainda. Sincronize o sensor ou importe um arquivo .bin.")); return; }
    const cell = (label, v, cls = "") => h("td", { "data-label": label, class: cls }, v);
    history.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "table table--cards" },
      h("caption", { class: "visually-hidden" }, `Coletas de ${animal().name}`),
      h("thead", {}, h("tr", {},
        h("th", { scope: "col" }, "Download"), h("th", { scope: "col" }, "Sensor no fim"), h("th", { scope: "col" }, "Fonte"),
        h("th", { scope: "col" }, "Sensor"), h("th", { scope: "col", class: "num" }, "Pacotes"),
        h("th", { scope: "col", class: "num" }, "Duração", badge("estimado", { help: false, label: "Estimado" })))),
      h("tbody", {}, syncs.map((x) => {
        const min = samplesOf(x) / s.hz / 60;
        return h("tr", {},
          h("th", { scope: "row", "data-label": "Download", class: "mono" }, fmtShort(x.id)),
          cell("Sensor no fim", x.endAt ? fmtShort(x.endAt) : "-", "mono"),
          cell("Fonte", x.source === "bluetooth" ? "Bluetooth" : x.source),
          cell("Sensor", x.sensorName || "-", "mono"),
          cell("Pacotes", fmtInt(x.packets.length), "num"),
          cell("Duração", min ? `${fmtDec(min)} min` : "-", "num"));
      })))));
  }

  function renderCharts() {
    const s = settingsFor(animal());
    acto.update({ rows: actogramRows(state.epochs, Date.now(), s, 14), epochSec: s.epoch });
    tr.update({ rows: trend(state.epochs, Date.now(), s, 14) });
  }

  const offState = on((r) => { if (r === "data") { renderHistory(); renderCharts(); } });
  renderHistory(); renderCharts();
  return { unmount() { offState(); acto.destroy(); tr.destroy(); } };
}
