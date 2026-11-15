// Opções (plano, 5.7): perfil, este animal (editar, arquivar), nuvem, métricas do onboarding,
// diagnóstico, zona de atenção (apagar dados deste aparelho) e sobre.

import { h, icon, uniqueId } from "../ui/dom.js?v=10";
import { pageHead, card } from "../ui/page.js?v=10";
import { on, currentAnimal } from "../state.js?v=10";
import { mount as mountCloudPanel } from "../ui/cloud-panel.js?v=10";
import { subscribe as onLog, logText } from "../log.js?v=10";
import { confirmModal, promptModal } from "../ui/modal.js?v=10";
import { toast } from "../ui/toast.js?v=10";
import { modalUi } from "./avancado.js?v=10";
import { summarize, load as loadEvents } from "../metrics.js?v=10";
import { pullOnboarding } from "../cloud.js?v=10";
import { SPECIES, SEX_LABEL, ROUTINE, BREEDS, answersFromAnimal, animalFromAnswers, parseDecimal } from "../animals.js?v=10";
import { fmtDate, pct } from "../format.js?v=10";
import { VERSION } from "../version.js?v=10";

const REPO = "https://github.com/eunayderson/simut";
const FLOW_LABEL = { completo: "Primeira vez", legado: "Com dados do Simut", adicionar: "Adicionar animal" };
const STEP_LABEL = { 1: "Etapa 1 (você)", 2: "Etapa 2 (animal)", 3: "Etapa 3 (rotina)", 4: "Etapa 4 (resumo)", inicio: "Antes da etapa 1" };

const fmtMs = (ms) => {
  if (ms === null || ms === undefined) return "-";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};

// Tabela de métricas de um conjunto de eventos.
function metricsTable(events, caption) {
  const sum = summarize(events);
  const flows = Object.keys(sum);
  if (!flows.length) return h("p", { class: "small muted" }, `${caption}: nenhum onboarding registrado.`);
  const cell = (label, v, cls = "num") => h("td", { "data-label": label, class: cls }, v);
  return h("div", { class: "table-wrap" }, h("table", { class: "table table--cards" },
    h("caption", {}, caption),
    h("thead", {}, h("tr", {}, ["Fluxo", "Iniciados", "Concluídos", "Taxa de conclusão", "Tempo (mediana)", "Tempo (p90)", "Abandono por etapa"].map((t, i) => h("th", { scope: "col", class: i && i < 6 ? "num" : "" }, t)))),
    h("tbody", {}, flows.map((f) => {
      const m = sum[f];
      const ab = Object.entries(m.abandonByStep).map(([k, v]) => `${STEP_LABEL[k] || `Etapa ${k}`}: ${v.count} (${pct(v.pct)})`).join("; ") || "nenhum";
      return h("tr", {},
        h("th", { scope: "row", "data-label": "Fluxo" }, FLOW_LABEL[f] || f),
        cell("Iniciados", String(m.started)), cell("Concluídos", String(m.completed)),
        cell("Taxa de conclusão", pct(m.completionRate)), cell("Tempo (mediana)", fmtMs(m.timeMedianMs)), cell("Tempo (p90)", fmtMs(m.timeP90Ms)),
        cell("Abandono por etapa", ab, ""));
    }))));
}

export function mount(el, ctx) {
  const { state, app, navigate } = ctx;
  const animal = () => currentAnimal() || ctx.animal;
  const a0 = animal();

  // ---------- perfil ----------
  const pName = h("input", { class: "input", id: "opt-person", type: "text", maxlength: "60", autocomplete: "name" });
  const pErr = h("p", { class: "error", id: "opt-person-err", "aria-live": "polite" });
  pName.setAttribute("aria-describedby", "opt-person-err");
  const pCreated = h("p", { class: "small muted" });
  const profileForm = h("form", { class: "inline-form", novalidate: true },
    h("div", { class: "field grow" }, h("label", { for: "opt-person" }, "Seu nome"), pName, pErr),
    h("button", { class: "btn", type: "submit" }, "Salvar"));
  profileForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = pName.value.trim();
    if (!v) { pErr.textContent = "Escreva seu nome ou como prefere ser chamado."; pName.setAttribute("aria-invalid", "true"); pName.focus(); return; }
    pErr.textContent = ""; pName.removeAttribute("aria-invalid");
    app.saveProfile({ ...(state.profile || {}), name: v.slice(0, 60) });
    toast("Nome salvo.", { kind: "success" });
  });

  // ---------- este animal ----------
  const animalForm = h("form", { class: "animal-form", novalidate: true });
  const archiveBtn = h("button", { class: "btn ghost", type: "button", onclick: toggleArchive }, icon("archive"), h("span"));

  // ---------- nuvem, métricas, diagnóstico ----------
  const cloudHost = h("div", { class: "cloud-panel" });
  const metricsBox = h("div", { class: "metrics-grid" });
  const pre = h("pre", { class: "log", tabindex: "0", "aria-label": "Registro de diagnóstico" });

  el.append(
    pageHead(a0.name, "Opções"),
    h("div", { class: "page-grid" },
      card({ title: "Perfil", span: 6 }, profileForm, pCreated),
      card({ title: "Sobre", span: 6 },
        h("p", { class: "small" }, `SIMUT, versão ${VERSION}. Os dados ficam neste navegador e, com a chave, na nuvem.`),
        h("p", { class: "small" }, h("a", { href: REPO, target: "_blank", rel: "noopener" }, "Código e documentação (GitHub)"), ". ",
          h("a", { href: `${REPO}/blob/main/docs/validacao.md`, target: "_blank", rel: "noopener" }, "Protocolo de validação"), ".")),
      card({ title: `Dados de ${a0.name}`, span: 12, sub: "Os mesmos campos do cadastro. Só o nome é obrigatório." }, animalForm,
        h("div", { class: "row archive-row" }, archiveBtn, h("span", { class: "small muted" }, "Arquivar tira o animal da grade sem apagar nada. Dá para desfazer."))),
      card({ title: "Nuvem", span: 12 }, cloudHost),
      card({ title: "Métricas do onboarding", span: 12, sub: "Conclusão, tempo e abandono por etapa, a partir dos eventos registrados em cada cadastro.", origin: { kind: "observado", detail: "Eventos registrados pelo próprio painel (início, etapa vista, etapa concluída, conclusão, saída)." } }, metricsBox),
      card({ title: "Diagnóstico", span: 12, tools: h("button", { class: "btn sm", type: "button", onclick: copyLog }, icon("copy"), "Copiar diagnóstico") }, pre),
      card({ title: "Zona de atenção", span: 12, cls: "danger-zone" },
        h("p", { class: "small" }, "Apaga os downloads guardados neste navegador (de todos os animais). A nuvem não é afetada: com a chave, os dados voltam na próxima sincronização."),
        h("button", { class: "btn danger", type: "button", onclick: clear }, icon("trash"), "Apagar dados deste aparelho"))),
  );

  // ---------- formulário do animal ----------
  function buildAnimalForm() {
    const a = animal();
    const ans = answersFromAnimal(a);
    const id = (n) => `opt-a-${n}`;
    const sel = (name, options, value) => {
      const s = h("select", { class: "select", id: id(name), name }, options.map(([v, t]) => h("option", { value: v }, t)));
      s.value = value ?? "";
      return s;
    };
    const fld = (label, control, extra = {}) => h("div", { class: `field${extra.wide ? " wide" : ""}`, hidden: !!extra.hidden, dataset: extra.data || {} },
      h("label", { for: control.id }, label, extra.optional === false ? null : h("span", { class: "optional" }, " (opcional)")), control, extra.help ? h("p", { class: "help" }, extra.help) : null);

    const name = h("input", { class: "input", id: id("name"), name: "name", type: "text", maxlength: "60", required: true, value: ans.name || "" });
    const nameErr = h("p", { class: "error", id: id("name-err"), "aria-live": "polite" });
    name.setAttribute("aria-describedby", nameErr.id);
    const species = sel("species", Object.entries(SPECIES), ans.species || "cao");
    const other = h("input", { class: "input", id: id("other"), name: "speciesOther", type: "text", maxlength: "40", value: ans.speciesOther || "" });
    const breedListId = uniqueId("breeds");
    const breedText = ans.breedChoice === "srd" ? "SRD" : ans.breedChoice === "mestico" ? "Mestiço" : ans.breedChoice === "nao-sei" ? "Não sei" : ans.breed || "";
    const breed = h("input", { class: "input", id: id("breed"), name: "breed", type: "text", maxlength: "60", list: breedListId, value: breedText });
    const breedList = h("datalist", { id: breedListId }, ["SRD", "Mestiço", "Não sei", ...(BREEDS[ans.species] || [])].map((b) => h("option", { value: b })));
    const ageMode = sel("ageMode", [["", "Não informada"], ["aprox", "Aproximada"], ["nasc", "Data de nascimento"], ["nao-sei", "Não sei"]], ans.ageUnknown ? "nao-sei" : ans.ageMode || "");
    const ageValue = h("input", { class: "input", id: id("ageValue"), name: "ageValue", type: "text", inputmode: "decimal", maxlength: "4", value: ans.ageValue || "" });
    const ageUnit = sel("ageUnit", [["anos", "anos"], ["meses", "meses"]], ans.ageUnit || "anos");
    const birth = h("input", { class: "input", id: id("birth"), name: "birthDate", type: "date", max: new Date().toISOString().slice(0, 10), value: ans.birthDate || "" });
    const weight = h("input", { class: "input", id: id("weight"), name: "weight", type: "text", inputmode: "decimal", maxlength: "6", value: ans.weight || "", placeholder: ans.weightUnknown ? "Não sei" : "" });
    const weightErr = h("p", { class: "error", id: id("weight-err"), "aria-live": "polite" });
    weight.setAttribute("aria-describedby", weightErr.id);
    const sex = sel("sex", [["", "Não informado"], ...Object.entries(SEX_LABEL)], ans.sex || "");
    const neutered = sel("neutered", [["", "Não informado"], ["sim", "Sim"], ["nao", "Não"], ["nao-sei", "Não sei"]], ans.neutered || "");
    const routine = Object.entries(ROUTINE).map(([k, r]) => [k, sel(k, [["", "Não informado"], ...r.options], ans[k] || "")]);

    const otherF = fld("Qual animal?", other, { hidden: species.value !== "outro" });
    const approxF = h("div", { class: "field", hidden: ageMode.value !== "aprox" }, h("label", { for: ageValue.id }, "Idade aproximada"), h("div", { class: "ob-inline" }, ageValue, ageUnit));
    const birthF = fld("Data de nascimento", birth, { hidden: ageMode.value !== "nasc", optional: false });
    const neutF = fld("Castração", neutered, { hidden: !(sex.value === "macho" || sex.value === "femea") });
    species.addEventListener("change", () => { otherF.hidden = species.value !== "outro"; });
    ageMode.addEventListener("change", () => { approxF.hidden = ageMode.value !== "aprox"; birthF.hidden = ageMode.value !== "nasc"; });
    sex.addEventListener("change", () => { neutF.hidden = !(sex.value === "macho" || sex.value === "femea"); });

    const redoRoutine = h("button", { class: "btn sm ghost", type: "button", onclick: () => { for (const [, s] of routine) s.value = ""; routine[0][1].focus(); } }, "Refazer rotina");

    animalForm.replaceChildren(
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: name.id }, "Nome"), name, nameErr),
        fld("Espécie", species, { optional: false }), otherF,
        h("div", { class: "field" }, h("label", { for: breed.id }, "Raça", h("span", { class: "optional" }, " (opcional)")), breed, breedList, h("p", { class: "help" }, "Aceita SRD, Mestiço ou Não sei.")),
        fld("Idade", ageMode), approxF, birthF,
        h("div", { class: "field" }, h("label", { for: weight.id }, "Peso em kg", h("span", { class: "optional" }, " (opcional)")), weight, weightErr),
        fld("Sexo biológico", sex), neutF),
      h("fieldset", { class: "routine-set" }, h("legend", {}, "Rotina"), h("div", { class: "form-grid" }, routine.map(([k, s]) => fld(ROUTINE[k].label, s))), redoRoutine),
      h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit" }, "Salvar dados do animal")));

    animalForm.onsubmit = (e) => {
      e.preventDefault();
      nameErr.textContent = ""; weightErr.textContent = "";
      if (!name.value.trim()) { nameErr.textContent = "O nome é obrigatório. Pode ser um apelido."; name.setAttribute("aria-invalid", "true"); name.focus(); return; }
      name.removeAttribute("aria-invalid");
      const w = parseDecimal(weight.value);
      if (weight.value.trim() && (w === null || w < 0.1 || w > 200)) { weightErr.textContent = "Use um valor entre 0,1 e 200 kg."; weight.setAttribute("aria-invalid", "true"); weight.focus(); return; }
      weight.removeAttribute("aria-invalid");
      const bt = breed.value.trim();
      const choice = /^srd$/i.test(bt) ? "srd" : /^mesti[cç]o$/i.test(bt) ? "mestico" : /^n[aã]o sei$/i.test(bt) ? "nao-sei" : null;
      const next = {
        name: name.value, species: species.value, speciesOther: other.value,
        breed: choice ? "" : bt, breedChoice: choice,
        ageMode: ageMode.value === "nasc" ? "nasc" : "aprox", ageUnknown: ageMode.value === "nao-sei",
        ageValue: ageMode.value === "aprox" ? ageValue.value : "", ageUnit: ageUnit.value, birthDate: ageMode.value === "nasc" ? birth.value : "",
        weight: weight.value, weightUnknown: !weight.value.trim() && ans.weightUnknown,
        sex: sex.value || null, neutered: neutered.value || null,
      };
      for (const [k, s] of routine) next[k] = s.value || null;
      app.saveAnimal(animalFromAnswers(next, animal()));
      toast(`Dados de ${name.value.trim()} salvos.`, { kind: "success" });
    };
  }

  async function toggleArchive() {
    const a = animal();
    if (a.archived) {
      const x = { ...a }; delete x.archived;
      app.saveAnimal(x);
      toast(`${a.name} voltou para a grade.`, { kind: "success" });
      return;
    }
    const ok = await confirmModal(`Arquivar ${a.name}? O animal sai da grade, mas nada é apagado: downloads, marcações e sensores continuam guardados. Dá para desarquivar em "Mostrar arquivados".`, { title: "Arquivar animal", confirmLabel: "Arquivar" });
    if (!ok) return;
    app.saveAnimal({ ...a, archived: true });
    toast(`${a.name} arquivado.`);
    navigate("#/animais");
  }

  // ---------- nuvem ----------
  const panel = mountCloudPanel(cloudHost, { state, sync: () => app.cloudSync(), ui: modalUi, showInline: true, onForget: () => { app.cloudSync(); renderMetrics(); } });

  // ---------- métricas ----------
  let metricsToken = 0;
  async function renderMetrics() {
    const token = ++metricsToken;
    const local = metricsTable(loadEvents(), "Neste aparelho");
    if (!state.cloudKey) { metricsBox.replaceChildren(local, h("p", { class: "small muted" }, "Conecte a nuvem para ver também as métricas de todos os aparelhos.")); return; }
    const cloudSlot = h("p", { class: "small muted" }, "Nuvem: carregando...");
    metricsBox.replaceChildren(local, cloudSlot);
    try {
      const ev = await pullOnboarding(state.cloudKey);
      if (token === metricsToken) cloudSlot.replaceWith(metricsTable(ev, "Na nuvem (todos os aparelhos)"));
    } catch (e) { if (token === metricsToken) cloudSlot.textContent = `Nuvem: não foi possível ler (${e.message}).`; }
  }

  // ---------- diagnóstico ----------
  pre.textContent = logText();
  const offLog = onLog((_, lines) => { pre.textContent = lines.join("\n"); });
  async function copyLog() {
    const text = `SIMUT ${VERSION}, ${navigator.userAgent}\n${logText()}`;
    try { await navigator.clipboard.writeText(text); toast("Diagnóstico copiado.", { kind: "success" }); }
    catch { await promptModal("Copie o diagnóstico:", { value: text, multiline: true, mono: true, okLabel: "Fechar" }); }
  }

  async function clear() {
    const ok = await confirmModal("Apagar todos os downloads guardados neste navegador? Isso não tem volta neste aparelho. A nuvem não é afetada.", { title: "Apagar dados deste aparelho", confirmLabel: "Apagar", danger: true });
    if (!ok) return;
    await app.clearLocal();
    toast("Dados deste aparelho apagados.", { kind: "success" });
  }

  function renderProfile() {
    if (document.activeElement !== pName) pName.value = state.profile?.name || "";
    pCreated.textContent = state.profile?.createdAt ? `Espaço criado em ${fmtDate(state.profile.createdAt)}.` : "";
  }
  function renderArchive() {
    const a = animal();
    archiveBtn.lastChild.textContent = a.archived ? `Desarquivar ${a.name}` : `Arquivar ${a.name}`;
  }

  const off = on((r) => {
    if (r === "cloud") { panel.setStatus(state.cloud.text, state.cloud.ok); if (state.cloud.ok) renderMetrics(); }
    if (r === "animals") { renderProfile(); renderArchive(); }
  });
  panel.setStatus(state.cloud.text, state.cloud.ok);
  buildAnimalForm(); renderProfile(); renderArchive(); renderMetrics();
  return { unmount() { off(); offLog(); panel.unmount(); metricsToken++; } };
}

