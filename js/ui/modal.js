// Confirmações e perguntas em <dialog> (substituem confirm/prompt).
// Foco preso dentro do modal, Esc fecha (resolve com o valor de dispensa),
// e o foco volta para quem abriu.

import { h, trapFocus, uniqueId } from "./dom.js?v=10";

// Safari e Firefox no Mac não dão foco ao botão clicado: guarda o último gatilho tocado
// para devolver o foco a ele quando o modal fecha (Esc, fundo ou botão).
let lastTrigger = null;
document.addEventListener("pointerdown", (e) => { lastTrigger = e.target.closest?.("button, a[href], [tabindex]:not([tabindex='-1']), input, select, textarea") || null; }, true);

// openModal({ title, body, actions: [{ label, value, kind, autofocus }], dismissValue })
// body: texto, nó ou função (dialog) => nó. Resolve com o value da ação escolhida.
export function openModal({ title, body, actions = [{ label: "Fechar", value: null, kind: "primary" }], dismissValue = null, onSubmit } = {}) {
  return new Promise((resolve) => {
    const active = document.activeElement;
    const opener = active && active !== document.body && !active.matches?.("h1, h2, [tabindex='-1']") ? active : lastTrigger || active;
    const titleId = uniqueId("modal-title");
    const bodyId = uniqueId("modal-body");
    const dlg = h("dialog", { class: "modal", "aria-labelledby": titleId, "aria-describedby": bodyId });
    const bodyNode = typeof body === "function" ? body(dlg) : body;
    const form = h("form", { class: "modal-inner", method: "dialog", novalidate: true },
      h("h2", { class: "modal-title", id: titleId }, title || ""),
      h("div", { class: "modal-body", id: bodyId }, typeof bodyNode === "string" ? h("p", {}, bodyNode) : bodyNode),
      h("div", { class: "modal-actions" }, actions.map((a, i) => h("button", {
        type: a.submit ? "submit" : "button",
        class: `btn ${a.kind === "danger" ? "danger primary" : a.kind || "secondary"}`,
        dataset: { idx: String(i) },
        autofocus: !!a.autofocus,
      }, a.label))),
    );
    dlg.append(form);
    document.body.append(dlg);

    let done = false;
    const release = trapFocus(dlg);
    const finish = (value) => {
      if (done) return;
      done = true;
      release();
      if (dlg.open) dlg.close();
      dlg.remove();
      if (opener && typeof opener.focus === "function" && opener.isConnected) opener.focus();
      resolve(value);
    };

    form.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-idx]");
      if (!b || b.type === "submit") return;
      finish(actions[Number(b.dataset.idx)].value);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const b = e.submitter || form.querySelector('button[type="submit"]');
      const a = b ? actions[Number(b.dataset.idx)] : null;
      if (onSubmit) {
        const r = onSubmit(a?.value, dlg);
        if (r === false) return; // validação falhou: mantém aberto
        finish(r === undefined ? a?.value : r);
      } else finish(a?.value);
    });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(dismissValue); });
    // clique no fundo fecha como dispensa
    dlg.addEventListener("click", (e) => { if (e.target === dlg) finish(dismissValue); });

    dlg.showModal();
    const auto = dlg.querySelector("[autofocus]") || dlg.querySelector(".modal-body input, .modal-body select, .modal-body textarea") || dlg.querySelector(".modal-actions .btn");
    auto?.focus();
  });
}

export function confirmModal(text, { title = "Confirmar", confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger = false } = {}) {
  return openModal({
    title, body: text, dismissValue: false,
    actions: [
      { label: cancelLabel, value: false, kind: "secondary" },
      { label: confirmLabel, value: true, kind: danger ? "danger" : "primary", autofocus: !danger },
    ],
  });
}

export function alertModal(text, { title = "Aviso", okLabel = "Entendi" } = {}) {
  return openModal({ title, body: text, dismissValue: undefined, actions: [{ label: okLabel, value: undefined, kind: "primary", autofocus: true }] });
}

// promptModal("Rótulo", { title, value, placeholder, help, validate: (v) => mensagemDeErro|"" , multiline })
// Resolve com o texto digitado ou null.
export function promptModal(label, { title = "", value = "", placeholder = "", help = "", validate = null, multiline = false, okLabel = "Confirmar", cancelLabel = "Cancelar", mono = false } = {}) {
  const inputId = uniqueId("prompt");
  const errId = `${inputId}-err`, helpId = `${inputId}-help`;
  const input = h(multiline ? "textarea" : "input", {
    id: inputId, class: `${multiline ? "textarea" : "input"}${mono ? " mono" : ""}`, placeholder, autocomplete: "off",
    "aria-describedby": [help ? helpId : "", errId].filter(Boolean).join(" "), rows: multiline ? "4" : null,
  });
  input.value = value;
  const err = h("p", { class: "error", id: errId, "aria-live": "polite" });
  const body = h("div", { class: "field" }, h("label", { for: inputId }, label), help ? h("p", { class: "help", id: helpId }, help) : null, input, err);
  return openModal({
    title: title || label, body, dismissValue: null,
    actions: [
      { label: cancelLabel, value: null, kind: "secondary" },
      { label: okLabel, value: "ok", kind: "primary", submit: true },
    ],
    onSubmit: () => {
      const v = input.value;
      const msg = validate ? validate(v) : "";
      if (msg) { err.textContent = msg; input.setAttribute("aria-invalid", "true"); input.focus(); return false; }
      return v;
    },
  });
}
