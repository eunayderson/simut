// Sensor (provisória): sincronizar, progresso, ajuda de Bluetooth, informações e nível.

import { h, icon } from "../ui/dom.js?v=10";
import { pageHead, card, kv } from "../ui/page.js?v=10";
import { on, animalSyncs, lastDownload } from "../state.js?v=10";
import { btHelp, canTryConnect } from "../ui/bt-help.js?v=10";
import { fmtDateTime, fmtShort, fmtInt } from "../format.js?v=10";

const PHASE_TEXT = { off: "Desconectado", searching: "Procurando...", syncing: "Sincronizando..." };

export function mount(el, ctx) {
  const { state, animal, app } = ctx;

  const pill = h("p", { class: "pill", "aria-live": "polite" }, h("span", { class: "dot", "aria-hidden": "true" }), h("span", {}));
  const syncBtn = h("button", { class: "btn primary lg", type: "button", onclick: () => app.syncSensor() }, icon("sync"), "Sincronizar sensor");
  const bar = h("span");
  const progressText = h("p");
  const progress = h("div", { class: "progress", hidden: true }, h("div", { class: "bar", role: "progressbar", "aria-label": "Progresso do download", "aria-valuemin": "0", "aria-valuemax": "100" }, bar), progressText);
  const help = h("div");
  const lastP = h("p", { class: "small muted" });
  const info = h("div");
  const level = h("div");

  el.append(
    pageHead(animal.name, "Sensor"),
    h("div", { class: "page-grid" },
      card({ title: "Sincronizar", span: 12, tools: pill },
        lastP,
        h("div", { class: "actions" }, syncBtn),
        progress, help,
        h("p", { class: "hint small" }, "Mexa no sensor antes: ele só aparece acordado. Depois de baixar, o painel desconecta sozinho para poupar a bateria. Deixe o Bluetooth do celular desligado ao sincronizar pelo computador: o sensor aceita só uma conexão por vez.")),
      card({ title: "Informações do dispositivo", span: 6 }, info),
      card({ title: "Nível", sub: "Suspeita de bateria (último byte do comando 05)", span: 6 }, level)),
  );

  function levels() {
    return animalSyncs(animal.id).filter((x) => x.sensor?.info).map((x) => {
      const b = x.sensor.info.split(" ").map((v) => parseInt(v, 16));
      return { t: x.id, v: b[b.length - 1] };
    });
  }

  function render() {
    const ui = state.sensorUi;
    pill.dataset.state = ui.phase === "off" ? "off" : "busy";
    pill.lastChild.textContent = ui.phase === "off" ? "Sensor desconectado" : ui.text || PHASE_TEXT[ui.phase];
    syncBtn.disabled = ui.busy || !canTryConnect(state.bt);
    progress.hidden = !ui.progress;
    progressText.textContent = ui.progress || "";
    if (ui.pct !== null && ui.pct !== undefined) { bar.style.width = `${ui.pct}%`; bar.parentElement.setAttribute("aria-valuenow", String(Math.round(ui.pct))); }
    help.replaceChildren(...[btHelp(state.bt)].filter(Boolean));
    const last = lastDownload(animal.id);
    lastP.textContent = last ? `Último download: ${fmtDateTime(last)}` : "Nunca sincronizado";

    const syncs = animalSyncs(animal.id);
    const lv = levels();
    const lastLv = ui.level ?? (lv.length ? lv[lv.length - 1].v : null);
    info.replaceChildren(kv([
      ["Relógio do sensor", ui.clock ? fmtDateTime(ui.clock) : "-"],
      ["Nível (provisório)", lastLv === null ? "-" : String(lastLv)],
      ["Pacotes guardados", fmtInt(syncs.reduce((a, x) => a + x.packets.length, 0))],
      ["Amostras decodificadas", fmtInt(state.samples)],
      ["Nuvem", state.cloud.text, { wide: true }],
    ]));
    level.replaceChildren(lv.length
      ? h("ul", { class: "level-list small" }, lv.slice(-8).reverse().map((r) => h("li", {}, h("span", { class: "mono" }, fmtShort(r.t)), h("b", {}, String(r.v)))))
      : h("p", { class: "small muted" }, "O histórico do nível começa a ser registrado na próxima sincronização."));
  }

  const off = on((reason) => { if (["sensor", "data", "cloud"].includes(reason)) render(); });
  render();
  return { unmount() { off(); } };
}
