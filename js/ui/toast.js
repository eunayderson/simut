// Avisos não bloqueantes (substituem alert em casos não destrutivos).
// A região tem role=status e aria-live=polite: o leitor de tela lê sem interromper.

import { h, icon } from "./dom.js?v=10";

let region = null;

function getRegion() {
  if (region && document.body.contains(region)) return region;
  region = document.getElementById("toastRegion") || h("div", { id: "toastRegion", class: "toast-region", role: "status", "aria-live": "polite", "aria-atomic": "false" });
  if (!region.isConnected) document.body.append(region);
  return region;
}

// toast("Texto", { kind: "info"|"success"|"warning"|"error", timeout: ms, persistent: bool, progress: 0..100 })
// Devolve { el, update(msg, opts), progress(pct, text), close() }.
export function toast(message, { kind = "info", timeout = 4500, persistent = false, progress = null } = {}) {
  const msg = h("div", { class: "toast-msg" }, message);
  const closeBtn = h("button", { class: "toast-close", type: "button", "aria-label": "Fechar aviso" }, icon("close"));
  const el = h("div", { class: "toast", dataset: { kind } }, msg, closeBtn);
  let bar = null, barText = null, timer = null;

  const close = () => { clearTimeout(timer); el.remove(); };
  const arm = (ms) => { clearTimeout(timer); if (ms > 0) timer = setTimeout(close, ms); };
  closeBtn.addEventListener("click", close);

  const api = {
    el,
    close,
    update(text, opts = {}) {
      msg.textContent = text;
      if (opts.kind) el.dataset.kind = opts.kind;
      if (opts.persistent === false || opts.timeout) arm(opts.timeout ?? 4500);
      return api;
    },
    progress(pct, text) {
      if (!bar) {
        barText = h("p");
        bar = h("span");
        el.append(h("div", { class: "progress" }, h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "Progresso" }, bar), barText));
      }
      const v = Math.max(0, Math.min(100, Number(pct) || 0));
      bar.style.width = `${v}%`;
      bar.parentElement.setAttribute("aria-valuenow", String(Math.round(v)));
      if (text !== undefined) barText.textContent = text;
      return api;
    },
  };

  getRegion().append(el);
  if (progress !== null) api.progress(progress);
  if (!persistent) arm(timeout);
  return api;
}
