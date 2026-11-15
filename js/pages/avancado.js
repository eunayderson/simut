// Avançado (plano, 5.4): parâmetros de análise (globais do sensor e limiares deste animal),
// sessão de validação, estado da validação, modelos de ML (em desenvolvimento) e tabela de 14 dias.

import { h } from "../ui/dom.js?v=10";
import { pageHead, card } from "../ui/page.js?v=10";
import { badge } from "../ui/badge.js?v=10";
import { on, settingsFor, currentAnimal } from "../state.js?v=10";
import { mount as mountValidation } from "../ui/validation-session.js?v=10";
import { marksOf, validationStatus } from "../validation.js?v=10";
import { trend, nightSummary } from "../analysis.js?v=10";
import { confirmModal, alertModal, promptModal } from "../ui/modal.js?v=10";
import { toast } from "../ui/toast.js?v=10";
import { fmtMin, fmtWeekday } from "../format.js?v=10";
import { processedDetail } from "./explain.js?v=10";

const GLOBAL_FIELDS = [
  { name: "hz", label: "Taxa de amostragem (Hz)", min: 1, max: 400, step: 1 },
  { name: "epoch", label: "Janela de análise (s)", min: 5, max: 300, step: 5 },
  { name: "lsbPerG", label: "Unidades por g", min: 1, max: 4096, step: 1 },
];
const ANIMAL_FIELDS = [
  { name: "tLight", label: "Limiar leve (mg)", min: 1, max: 2000, step: 1 },
  { name: "tVig", label: "Limiar intenso (mg)", min: 1, max: 4000, step: 1 },
];

export const modalUi = {
  confirm: (text) => confirmModal(text),
  alert: (text) => alertModal(text),
  prompt: (text, value) => promptModal(text, { value: value || "", multiline: true, mono: true }),
};

const input = (f) => h("div", { class: "field" },
  h("label", { for: `set-${f.name}` }, f.label),
  h("input", { class: "input", id: `set-${f.name}`, type: "number", name: f.name, min: f.min, max: f.max, step: f.step, inputmode: "decimal", required: true }));

export function mount(el, ctx) {
  const { state, app, log } = ctx;
  const animal = () => currentAnimal() || ctx.animal;
  const a0 = animal();

  const calibNote = h("p", { class: "small muted" });
  const useGlobal = h("button", { class: "btn sm ghost", type: "button" }, "Usar os globais");
  const form = h("form", { class: "params", novalidate: true },
    h("fieldset", {}, h("legend", {}, "Do sensor (valem para todos os animais)"), h("div", { class: "settings" }, GLOBAL_FIELDS.map(input))),
    h("fieldset", {}, h("legend", {}, `Limiares de ${a0.name}`), h("div", { class: "settings" }, ANIMAL_FIELDS.map(input)), h("div", { class: "row" }, calibNote, useGlobal)),
    h("p", { class: "error", id: "params-err", "aria-live": "polite" }),
    h("button", { class: "btn primary", type: "submit" }, "Salvar e recalcular"));
  const valHost = h("section", { class: "card span-12", "aria-label": "Sessão de validação" });
  const statusBox = h("div");
  const statusBadge = h("span", { class: "card-tools" });
  const tableBox = h("div");

  el.append(
    pageHead(a0.name, "Avançado"),
    h("div", { class: "page-grid" },
      card({ title: "Parâmetros de análise", span: 12, origin: { kind: "estimado", detail: "Taxa de amostragem e limiares ainda não foram confirmados. Mudar aqui recalcula todo o painel a partir dos pacotes brutos guardados." } },
        h("p", { class: "notice warning" }, `Os números deste painel ainda são provisórios. O formato interno do sensor foi decodificado por engenharia reversa e os limiares de repouso, leve e intenso precisam ser calibrados com vídeo de ${a0.name} antes de qualquer conclusão.`),
        form),
      valHost,
      h("section", { class: "card span-6", "aria-labelledby": "valstate-h" },
        h("div", { class: "card-head" }, h("div", { class: "card-title" }, h("h2", { id: "valstate-h" }, "Estado da validação")), statusBadge),
        statusBox),
      card({ title: "Modelos de machine learning", span: 6, origin: "ml" },
        h("p", {}, "Ainda não há modelo treinado. Os pacotes brutos ficam guardados para isso."),
        h("p", { class: "small muted" }, "Quando houver sessões de validação suficientes, elas servirão de exemplo para treinar e testar um classificador. Nenhum resultado de ML é mostrado antes disso.")),
      card({ title: "Padrões dos últimos 14 dias", span: 12, sub: "Minutos por classe em cada dia, só nos trechos medidos. Despertares contam a noite que termina às 6h do dia.", origin: { kind: "processado", detail: processedDetail(settingsFor(a0)) } }, tableBox)),
  );

  function fill() {
    const s = settingsFor(animal());
    for (const f of [...GLOBAL_FIELDS, ...ANIMAL_FIELDS]) form.elements[f.name].value = s[f.name];
    const c = animal().calibration;
    const own = c && (Number.isFinite(c.tLight) || Number.isFinite(c.tVig));
    calibNote.textContent = own ? `Limiares próprios de ${animal().name}. Os globais são ${state.settings.tLight} e ${state.settings.tVig} mg.` : "Usando os limiares globais.";
    useGlobal.hidden = !own;
  }

  useGlobal.addEventListener("click", () => {
    const a = { ...animal() };
    delete a.calibration;
    app.saveAnimal(a);
    fill();
    toast("Limiares globais em uso. Painel recalculado.", { kind: "success" });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("#params-err");
    err.textContent = "";
    const v = {};
    for (const f of [...GLOBAL_FIELDS, ...ANIMAL_FIELDS]) {
      const n = Number(form.elements[f.name].value);
      if (!Number.isFinite(n) || n < f.min || n > f.max) {
        err.textContent = `${f.label}: use um valor entre ${f.min} e ${f.max}.`;
        form.elements[f.name].setAttribute("aria-invalid", "true"); form.elements[f.name].focus();
        return;
      }
      form.elements[f.name].removeAttribute("aria-invalid");
      v[f.name] = n;
    }
    if (v.tVig <= v.tLight) { err.textContent = "O limiar intenso precisa ser maior que o leve."; form.elements.tVig.focus(); return; }
    const g = { ...state.settings, hz: v.hz, epoch: v.epoch, lsbPerG: v.lsbPerG };
    const same = v.tLight === g.tLight && v.tVig === g.tVig;
    const a = { ...animal() };
    if (same) delete a.calibration; else a.calibration = { tLight: v.tLight, tVig: v.tVig };
    app.updateSettings(g);
    app.saveAnimal(a);
    fill();
    toast("Parâmetros salvos. Painel recalculado.", { kind: "success" });
  });

  const validation = mountValidation(valHost, {
    state, animalId: a0.id, animalName: a0.name, log, ui: modalUi, onMarksChanged: app.cloudMarks,
    getSettings: () => settingsFor(animal()),
    onApplyThresholds: ({ tLight, tVig }) => { app.saveAnimal({ ...animal(), calibration: { tLight, tVig } }); fill(); },
  });
  // selos da sessão: marcações são observadas, a análise é processada
  valHost.querySelector(".card-head")?.append(h("span", { class: "card-tools" }, badge("observado", { label: "Marcações: observado" }), badge("processado", { label: "Resultado: processado" })));

  function renderStatus() {
    const s = settingsFor(animal());
    const st = validationStatus(marksOf(state.marks, animal().id), state.epochs, s);
    statusBadge.replaceChildren(st.validated
      ? badge("validado")
      : badge("estimado", { label: `Estimado, ${st.completed} de ${st.needed} sessões`, detail: "Os limiares só passam a validados com duas sessões concluídas e kappa a partir de 0,6 na mais recente." }));
    const kTxt = st.lastKappa === null || !Number.isFinite(st.lastKappa) ? "-" : st.lastKappa.toFixed(2).replace(".", ",");
    statusBox.replaceChildren(
      h("p", { class: "val-count" }, h("span", { class: "big-num" }, `${Math.min(st.completed, st.needed)} de ${st.needed}`), h("span", { class: "small muted" }, " sessões concluídas")),
      h("p", { class: "small" }, st.completed
        ? `Última sessão: kappa ${kTxt}, ${st.sessions[st.sessions.length - 1].n} janelas comparadas.`
        : "Uma sessão conta como concluída quando termina com \"Encerrar\" e tem pelo menos 5 janelas do sensor no mesmo horário."),
      h("p", { class: "small muted" }, st.validated
        ? "Validado: duas sessões concluídas e concordância substancial na mais recente."
        : "Para validar: faça uma sessão, aplique os limiares sugeridos e confirme numa segunda sessão com kappa a partir de 0,6."));
  }

  function renderTable() {
    const s = settingsFor(animal());
    const rows = trend(state.epochs, Date.now(), s, 14).reverse();
    const cell = (label, v, cls = "num") => h("td", { "data-label": label, class: cls }, v);
    tableBox.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "table table--cards" },
      h("caption", { class: "visually-hidden" }, `Padrões de ${animal().name} nos últimos 14 dias`),
      h("thead", {}, h("tr", {}, ["Dia", "Cobertura", "Repouso", "Leve", "Intenso", "Despertares"].map((t, i) => h("th", { scope: "col", class: i ? "num" : "" }, t)))),
      h("tbody", {}, rows.map((r) => {
        const n = nightSummary(state.epochs, r.day, s);
        const none = () => h("span", { class: "muted" }, "sem dados");
        return h("tr", { class: r.covered ? "" : "row-none" },
          h("th", { scope: "row", "data-label": "Dia" }, fmtWeekday(r.day)),
          cell("Cobertura", r.covered ? fmtMin(r.covered) : none()),
          cell("Repouso", r.covered ? fmtMin(r.rest) : none()),
          cell("Leve", r.covered ? fmtMin(r.light) : none()),
          cell("Intenso", r.covered ? fmtMin(r.vig) : none()),
          cell("Despertares", n ? String(n.wakes) : none()));
      })))));
  }

  const off = on((reason) => {
    if (reason === "data") { validation.render(); renderStatus(); renderTable(); }
    if (reason === "settings" || reason === "animals") fill();
  });
  fill(); renderStatus(); renderTable();
  return { unmount() { off(); validation.unmount(); } };
}
