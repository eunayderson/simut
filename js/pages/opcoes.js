// Opções (provisória): nuvem, diagnóstico e apagar dados deste aparelho.

import { h, icon } from "../ui/dom.js?v=10";
import { pageHead, card } from "../ui/page.js?v=10";
import { on } from "../state.js?v=10";
import { mount as mountCloudPanel } from "../ui/cloud-panel.js?v=10";
import { subscribe as onLog, logText } from "../log.js?v=10";
import { confirmModal } from "../ui/modal.js?v=10";
import { toast } from "../ui/toast.js?v=10";
import { modalUi } from "./avancado.js?v=10";

export function mount(el, ctx) {
  const { state, animal, app } = ctx;
  const cloudHost = h("div", { class: "cloud-panel" });
  const pre = h("pre", { class: "log", tabindex: "0", "aria-label": "Registro de diagnóstico" });

  el.append(
    pageHead(animal.name, "Opções"),
    h("div", { class: "page-grid" },
      card({ title: "Nuvem", span: 12 }, cloudHost),
      card({ title: "Diagnóstico", span: 12 }, pre),
      card({ title: "Zona de atenção", span: 12, cls: "danger-zone" },
        h("button", { class: "btn danger", type: "button", onclick: clear }, icon("trash"), "Apagar dados deste aparelho"))),
  );

  const panel = mountCloudPanel(cloudHost, { state, sync: () => app.cloudSync(), ui: modalUi, showInline: true });
  const offCloud = on((r) => { if (r === "cloud") panel.setStatus(state.cloud.text, state.cloud.ok); });
  panel.setStatus(state.cloud.text, state.cloud.ok);

  pre.textContent = logText();
  const offLog = onLog((_, lines) => { pre.textContent = lines.join("\n"); });

  async function clear() {
    const ok = await confirmModal("Apagar todos os downloads guardados neste navegador? Isso não tem volta neste aparelho. A nuvem não é afetada.", { title: "Apagar dados deste aparelho", confirmLabel: "Apagar", danger: true });
    if (!ok) return;
    await app.clearLocal();
    toast("Dados deste aparelho apagados.", { kind: "success" });
  }

  return { unmount() { offCloud(); offLog(); panel.unmount(); } };
}
