// Avançado (provisória): parâmetros de análise e sessão de validação.

import { h } from "../ui/dom.js?v=10";
import { pageHead, card } from "../ui/page.js?v=10";
import { on, settingsFor } from "../state.js?v=10";
import { mount as mountValidation } from "../ui/validation-session.js?v=10";
import { confirmModal, alertModal, promptModal } from "../ui/modal.js?v=10";
import { toast } from "../ui/toast.js?v=10";

const FIELDS = [
  { name: "hz", label: "Taxa de amostragem (Hz)", min: 1, max: 400, step: 1 },
  { name: "epoch", label: "Janela de análise (s)", min: 5, max: 300, step: 5 },
  { name: "tLight", label: "Limiar leve (mg)", min: 1, max: 2000, step: 1 },
  { name: "tVig", label: "Limiar intenso (mg)", min: 1, max: 4000, step: 1 },
  { name: "lsbPerG", label: "Unidades por g", min: 1, max: 4096, step: 1 },
];

export const modalUi = {
  confirm: (text) => confirmModal(text),
  alert: (text) => alertModal(text),
  prompt: (text, value) => promptModal(text, { value: value || "", multiline: true, mono: true }),
};

export function mount(el, ctx) {
  const { state, animal, app, log } = ctx;

  const form = h("form", { class: "settings", novalidate: true },
    FIELDS.map((f) => h("div", { class: "field" },
      h("label", { for: `set-${f.name}` }, f.label),
      h("input", { class: "input", id: `set-${f.name}`, type: "number", name: f.name, min: f.min, max: f.max, step: f.step, inputmode: "decimal" }))),
    h("button", { class: "btn primary", type: "submit" }, "Salvar e recalcular"));
  const valHost = h("section", { class: "card span-12", "aria-label": "Sessão de validação" });

  el.append(
    pageHead(animal.name, "Avançado"),
    h("div", { class: "page-grid" },
      card({ title: "Parâmetros de análise", span: 12 },
        h("p", { class: "notice warning" }, `Os números deste painel ainda são provisórios. O formato interno do sensor foi decodificado por engenharia reversa e os limiares de repouso, leve e intenso precisam ser calibrados com vídeo de ${animal.name} antes de qualquer conclusão.`),
        form),
      valHost),
  );

  function fill() {
    const s = settingsFor(animal);
    for (const f of FIELDS) form.elements[f.name].value = s[f.name];
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const s = {};
    for (const f of FIELDS) s[f.name] = Number(form.elements[f.name].value) || state.settings[f.name];
    if (s.tVig <= s.tLight) { toast("O limiar intenso precisa ser maior que o leve.", { kind: "error" }); return; }
    app.updateSettings({ ...state.settings, ...s });
    toast("Parâmetros salvos. Painel recalculado.", { kind: "success" });
  });

  const validation = mountValidation(valHost, {
    state, animalId: animal.id, animalName: animal.name, log, ui: modalUi,
    getSettings: () => settingsFor(animal),
    onApplyThresholds: ({ tLight, tVig }) => { app.updateSettings({ ...state.settings, tLight, tVig }); fill(); },
  });

  const off = on((reason) => { if (reason === "data") validation.render(); if (reason === "settings") fill(); });
  fill();
  return { unmount() { off(); validation.unmount(); } };
}
