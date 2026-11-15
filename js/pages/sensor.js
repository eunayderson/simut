// Sensor (plano, 5.5): sincronizar (um toque: conecta, baixa, salva e desconecta), ajuda de Bluetooth,
// informações do dispositivo, nível (suspeita de bateria), sensores deste animal, sessões recentes
// e qualidade do sinal (em desenvolvimento).

import { h, icon } from "../ui/dom.js?v=10";
import { pageHead, card, kv } from "../ui/page.js?v=10";
import { badge } from "../ui/badge.js?v=10";
import { on, animalSyncs, lastDownload, currentAnimal } from "../state.js?v=10";
import { btHelp, canTryConnect } from "../ui/bt-help.js?v=10";
import { dissociateSensor } from "../animals.js?v=10";
import { confirmModal } from "../ui/modal.js?v=10";
import { toast } from "../ui/toast.js?v=10";
import { animalPath } from "../router.js?v=10";
import { fmtDateTime, fmtShort, fmtInt, fmtDate, plural } from "../format.js?v=10";

const PHASE = { off: "Desconectado", searching: "Procurando sensor...", syncing: "Sincronizando..." };

// Último byte da resposta do comando 05: suspeita de nível de bateria. Registrado a cada sincronização.
export function levelHistory(syncs) {
  return syncs.filter((x) => x.sensor?.info).map((x) => {
    const b = x.sensor.info.split(" ").map((v) => parseInt(v, 16));
    return { t: x.id, v: b[b.length - 1] };
  }).filter((r) => Number.isFinite(r.v));
}

function fmtOffset(ms) {
  const s = Math.round(ms / 1000);
  if (Math.abs(s) < 2) return "menos de 2 s";
  const a = Math.abs(s), sign = s > 0 ? "adiantado" : "atrasado";
  if (a < 120) return `${a} s ${sign}`;
  const m = Math.round(a / 60);
  if (m < 120) return `${m} min ${sign}`;
  return `${Math.round(m / 60)} h ${sign}`;
}

export function mount(el, ctx) {
  const { state, app, navigate } = ctx;
  const animal = () => currentAnimal() || ctx.animal;

  const pill = h("p", { class: "pill", "aria-live": "polite" }, h("span", { class: "dot", "aria-hidden": "true" }), h("span", {}));
  const syncBtn = h("button", { class: "btn primary lg", type: "button", onclick: () => app.syncSensor() }, icon("sync"), "Sincronizar sensor");
  const bar = h("span");
  const progressText = h("p");
  const progress = h("div", { class: "progress", hidden: true }, h("div", { class: "bar", role: "progressbar", "aria-label": "Progresso do download", "aria-valuemin": "0", "aria-valuemax": "100" }, bar), progressText);
  const help = h("div");
  const lastP = h("p", { class: "small muted" });
  const info = h("div");
  const level = h("div");
  const sensors = h("div");
  const sessions = h("div");

  el.append(
    pageHead(animal().name, "Sensor"),
    h("div", { class: "page-grid" },
      card({ title: "Sincronizar", span: 12, tools: pill, cls: "sync-card" },
        lastP,
        h("div", { class: "actions" }, syncBtn),
        progress, help,
        h("p", { class: "hint small" }, "Mexa no sensor antes: ele só aparece acordado. Depois de baixar, o painel desconecta sozinho para poupar a bateria. Deixe o Bluetooth do celular desligado ao sincronizar pelo computador: o sensor aceita só uma conexão por vez."),
        h("p", { class: "hint small" }, "Cada download traz só os últimos 20 a 25 minutos de movimento guardados no sensor (cerca de 128 KB).")),
      card({ title: "Informações do dispositivo", span: 6, origin: { kind: "observado", detail: "Nome Bluetooth e relógio lidos do sensor. As amostras decodificadas dependem da decodificação provisória." } }, info),
      card({ title: "Nível", sub: "Suspeita de bateria: último byte do comando 05, registrado a cada sincronização.", span: 6, origin: { kind: "estimado", detail: "Ainda não confirmamos que este número é a bateria. Acompanhe a tendência, não o valor exato." } }, level),
      card({ title: "Sensores deste animal", span: 6, origin: "observado" }, sensors),
      card({ title: "Sessões recentes", sub: "Últimos 10 downloads deste animal.", span: 6, origin: "observado" }, sessions),
      card({ title: "Qualidade do sinal", span: 12, origin: { kind: "ausente", label: "Em desenvolvimento", detail: "Recurso ainda não implementado: não há medida de qualidade do sinal." } },
        h("p", { class: "small" }, "Ainda não há uma medida de qualidade do sinal. Ela depende de confirmar a taxa de amostragem e o formato dos pacotes. Até lá, nada é mostrado aqui para não inventar números."))),
  );

  async function removeSensor(name) {
    const a = animal();
    const ok = await confirmModal(`Remover a associação do sensor ${name} com ${a.name}? Os downloads já feitos continuam com ${a.name}.`, { title: "Remover associação", confirmLabel: "Remover" });
    if (!ok) return;
    app.saveAnimal(dissociateSensor(a, name));
    toast(`Sensor ${name} desassociado de ${a.name}.`);
  }

  function render() {
    const a = animal();
    const ui = state.sensorUi;
    pill.dataset.state = ui.phase === "off" ? "off" : "busy";
    pill.lastChild.textContent = ui.phase === "off" ? "Sensor desconectado" : PHASE[ui.phase] || ui.text;
    syncBtn.disabled = ui.busy || !canTryConnect(state.bt);
    progress.hidden = !ui.progress;
    progressText.textContent = ui.progress || "";
    if (ui.pct !== null && ui.pct !== undefined) { bar.style.width = `${ui.pct}%`; bar.parentElement.setAttribute("aria-valuenow", String(Math.round(ui.pct))); }
    help.replaceChildren(...[btHelp(state.bt)].filter(Boolean));
    const last = lastDownload(a.id);
    lastP.textContent = last ? `Último download: ${fmtDateTime(last)}` : "Nunca sincronizado";

    const syncs = animalSyncs(a.id);
    const lastBt = [...syncs].reverse().find((x) => x.source === "bluetooth");
    const clock = ui.clock ?? lastBt?.sensor?.clock ?? null;
    const lv = levelHistory(syncs);
    const name = lastBt?.sensorName || (a.sensors || [])[0]?.name || null;
    info.replaceChildren(kv([
      ["Nome Bluetooth", name || "-", { mono: true }],
      ["Relógio do sensor (última leitura)", clock ? fmtDateTime(clock) : "-", { mono: true }],
      ["Diferença para o relógio do aparelho", lastBt?.sensor?.clock ? fmtOffset(lastBt.endAt - lastBt.id) : "-"],
      ["Pacotes guardados", fmtInt(syncs.reduce((s, x) => s + x.packets.length, 0))],
      ["Amostras decodificadas", fmtInt(state.samples), { badge: badge("estimado", { help: false }) }],
      ["Último download", last ? fmtDateTime(last) : "-"],
    ]));

    const cur = ui.level ?? (lv.length ? lv[lv.length - 1].v : null);
    if (!lv.length && cur === null) level.replaceChildren(h("p", { class: "small muted" }, "O histórico do nível começa a ser registrado na próxima sincronização."));
    else {
      const last8 = lv.slice(-8);
      const max = Math.max(100, ...last8.map((r) => r.v));
      level.replaceChildren(
        h("p", { class: "level-now" }, h("span", { class: "big-num" }, cur === null ? "-" : String(cur)), h("span", { class: "small muted" }, " valor bruto, de 0 a 255 (provavelmente %)")),
        h("div", { class: "level-bars", role: "img", "aria-label": `Nível nas últimas ${last8.length} sincronizações: ${last8.map((r) => r.v).join(", ")}` },
          last8.map((r) => h("div", { class: "lb" }, h("span", { class: "lb-bar", style: { height: `${Math.max(4, (r.v / max) * 100)}%` } }), h("span", { class: "lb-v" }, String(r.v)), h("span", { class: "lb-t" }, fmtDate(r.t).slice(0, 5))))),
        h("ul", { class: "level-list small" }, last8.slice().reverse().map((r) => h("li", {}, h("span", { class: "mono" }, fmtShort(r.t)), h("b", {}, String(r.v))))));
    }

    const list = a.sensors || [];
    sensors.replaceChildren(list.length
      ? h("ul", { class: "sensor-list" }, list.map((s) => h("li", {},
        h("div", {}, h("span", { class: "mono" }, s.name), h("span", { class: "small muted" }, s.since ? ` desde ${fmtDate(s.since)}` : " (cadastro original)")),
        h("button", { type: "button", class: "btn sm ghost danger", onclick: () => removeSensor(s.name) }, "Remover associação"))))
      : h("p", { class: "small muted" }, "Nenhum sensor associado. O primeiro sensor sincronizado aqui fica associado a este animal."));

    const recent = syncs.slice(-10).reverse();
    sessions.replaceChildren(recent.length
      ? h("div", {},
        h("ul", { class: "session-list small" }, recent.map((x) => h("li", {},
          h("span", { class: "mono" }, fmtShort(x.id)),
          h("span", {}, x.source === "bluetooth" ? `Bluetooth${x.sensorName ? `, ${x.sensorName}` : ""}` : x.source),
          h("span", { class: "num" }, plural(x.packets.length, "pacote"))))),
        h("p", { class: "small" }, h("a", { href: animalPath(a.id, "dados"), onclick: (e) => { e.preventDefault(); navigate(animalPath(a.id, "dados")); } }, `Ver todos (${syncs.length}) em Dados`)))
      : h("p", { class: "small muted" }, "Nenhum download ainda."));
  }

  const off = on((reason) => { if (["sensor", "data", "cloud", "animals"].includes(reason)) render(); });
  render();
  return { unmount() { off(); } };
}
