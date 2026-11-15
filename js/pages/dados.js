// Dados (provisória): coletas do animal, exportar janelas (CSV) e importar .bin.

import { h, icon } from "../ui/dom.js?v=10";
import { pageHead, card } from "../ui/page.js?v=10";
import { on, animalSyncs } from "../state.js?v=10";
import { toCsv } from "../analysis.js?v=10";
import { fmtDateTime, fmtInt } from "../format.js?v=10";
import { toast } from "../ui/toast.js?v=10";

export function download(name, text, type = "text/csv") {
  const blob = new Blob([text], { type });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function mount(el, ctx) {
  const { state, animal, app } = ctx;
  const list = h("div");
  const file = h("input", { type: "file", accept: ".bin", class: "visually-hidden", id: "fileBin" });

  el.append(
    pageHead(animal.name, "Dados"),
    h("div", { class: "page-grid" },
      card({ title: "Exportar e importar", span: 12 },
        h("div", { class: "actions" },
          h("button", { class: "btn", type: "button", onclick: exportCsv }, icon("download"), "Exportar janelas (CSV)"),
          h("label", { class: "btn", for: "fileBin" }, icon("upload"), "Importar .bin do Mac"), file)),
      card({ title: "Histórico de coletas", span: 12 }, list)),
  );

  function exportCsv() {
    if (!state.epochs.length) { toast("Ainda não há dados para exportar."); return; }
    download(`simut-janelas-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(state.epochs));
  }
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    const n = await app.importBin(f);
    file.value = "";
    toast(n ? `${fmtInt(n)} pacotes importados para ${animal.name}.` : "Arquivo sem pacotes reconhecidos.", { kind: n ? "success" : "warning" });
  });

  function render() {
    const syncs = animalSyncs(animal.id).slice().reverse();
    list.replaceChildren(syncs.length
      ? h("ul", { class: "plain-list small" }, syncs.map((s) => h("li", {}, h("span", { class: "mono" }, fmtDateTime(s.id)), ` ${s.source}, ${fmtInt(s.packets.length)} pacotes`)))
      : h("p", { class: "small muted" }, "Nenhuma coleta ainda."));
  }
  const off = on((r) => { if (r === "data") render(); });
  render();
  return { unmount() { off(); } };
}
