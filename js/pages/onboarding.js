// Onboarding progressivo (plano, 5.1): uma pergunta por tela, quatro etapas.
//   1 Conhecendo você (pulada ao adicionar animal)
//   2 Conhecendo o animal: espécie, nome, raça, idade, peso, sexo (e castração)
//   3 Conhecendo a rotina: ambiente, atividade, descanso (pode pular)
//   4 Tudo pronto: resumo editável
// Fluxos: "completo" (primeira vez), "legado" (já há dados do Simut: só o nome da pessoa e o resumo,
// com revisão opcional) e "adicionar" (pessoa já cadastrada).
// Rascunho salvo a cada resposta (simut.onboardingDraft): voltar preserva, recarregar retoma.
// Eventos de métrica (js/metrics.js) em cada tela, conclusão e saída da página.

import { h, icon, uniqueId } from "../ui/dom.js?v=10";
import { loadDraft, saveDraft, clearDraft, saveLastAnimal } from "../store.js?v=10";
import { startSession, record } from "../metrics.js?v=10";
import {
  LEGACY_ANIMAL_ID, SPECIES, SEX_LABEL, ROUTINE, BREEDS, newAnimalId, findAnimal,
  answersFromAnimal, animalFromAnswers, parseDecimal, ageLabel, breedLabel, routineLabel,
} from "../animals.js?v=10";
import { animalPath } from "../router.js?v=10";

const STEP_NAME = { 1: "Conhecendo você", 2: "Conhecendo o animal", 3: "Conhecendo a rotina", 4: "Tudo pronto" };
const SUBS = { 1: ["pessoa"], 2: ["especie", "nome", "raca", "idade", "peso", "sexo"], 3: ["environment", "activity", "restPlace"], 4: ["resumo"] };
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function newDraft(flow, state) {
  const draft = { flow, step: flow === "adicionar" ? 2 : 1, sub: 0, answers: {}, sessionId: null, n: 0, startedAt: Date.now(), returnTo: null };
  if (flow === "legado") {
    const simut = findAnimal(state.animals, LEGACY_ANIMAL_ID);
    draft.animalId = LEGACY_ANIMAL_ID;
    draft.answers = answersFromAnimal(simut || {});
  }
  const session = startSession(flow);
  draft.sessionId = session.sessionId;
  draft.n = session.n;
  return draft;
}

export function mount(el, ctx) {
  const { state, route, navigate, app } = ctx;
  const done = !!state.profile?.onboardingDone;
  const wantAdd = route.flow === "adicionar";
  let draft = loadDraft();
  let isNew = false;

  if (wantAdd && draft?.flow !== "adicionar") draft = null;
  if (!done && draft?.flow === "adicionar") draft = null;
  if (done && draft && draft.flow !== "adicionar") draft = null;
  if (!draft) {
    const flow = done || wantAdd ? "adicionar" : state.animals.some((a) => a.id === LEGACY_ANIMAL_ID) ? "legado" : "completo";
    draft = newDraft(flow, state);
    isNew = true;
  }
  const flow = draft.flow;
  const session = startSession(flow, { sessionId: draft.sessionId, n: draft.n || 0 });
  const ans = draft.answers;

  const persist = () => { draft.n = session.n; saveDraft(draft); };
  const track = (type, extra = {}) => { record(session, type, extra); persist(); };

  // etapa pedida na URL (voltar do navegador ou link direto)
  if (route.step && route.step !== draft.step) {
    let step = route.step;
    if (flow === "adicionar" && step === 1) step = 2;
    if (flow === "legado" && (step === 2 || step === 3)) draft.reviewing = true;
    draft.sub = step < draft.step ? SUBS[step].length - 1 : 0;
    draft.step = step;
    draft.returnTo = null;
  }
  const hashFor = (step) => `#/onboarding/${step}${flow === "adicionar" ? "?fluxo=adicionar" : ""}`;
  if (location.hash !== hashFor(draft.step)) history.replaceState(null, "", `${location.pathname}${location.search}${hashFor(draft.step)}`);
  if (isNew) track("start", { step: draft.step });
  persist();

  // ---------- saída da página (abandono) ----------
  const onHide = () => { if (document.visibilityState === "hidden") track("leave", { step: draft.step, sub: draft.sub }); };
  const onPageHide = () => track("leave", { step: draft.step, sub: draft.sub });
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);

  // ---------- navegação entre telas ----------
  function goStep(step, sub = 0) {
    draft.step = step; draft.sub = sub;
    persist();
    navigate(hashFor(step));
  }

  function nextScreen() {
    if (draft.returnTo) { const r = draft.returnTo; draft.returnTo = null; track("step_done", { step: draft.step, sub: draft.sub }); goStep(r); return; }
    const last = SUBS[draft.step].length - 1;
    if (draft.sub < last) { draft.sub++; persist(); show(); return; }
    track("step_done", { step: draft.step });
    if (draft.step === 1) goStep(flow === "legado" && !draft.reviewing ? 4 : 2);
    else if (draft.step === 2) goStep(3);
    else if (draft.step === 3) { draft.reviewing = false; goStep(4); }
  }

  function prevScreen() {
    if (draft.returnTo) { const r = draft.returnTo; draft.returnTo = null; goStep(r); return; }
    if (draft.sub > 0) { draft.sub--; persist(); show(); return; }
    if (draft.step === 4) { goStep(flow === "legado" ? 1 : 3, flow === "legado" ? 0 : SUBS[3].length - 1); return; }
    if (draft.step === 3) { goStep(2, SUBS[2].length - 1); return; }
    if (draft.step === 2) {
      if (flow === "legado") { draft.reviewing = false; goStep(4); return; }
      if (flow === "completo") goStep(1);
    }
  }

  const canGoBack = () => !(draft.sub === 0 && ((draft.step === 1) || (draft.step === 2 && flow === "adicionar")));

  // ---------- peças de interface ----------
  const qId = uniqueId("ob-q"), subId = `${qId}-sub`;
  let advanceTimer = 0;

  function optionGroup(options, value, onPick, { cls = "option-card", autoAdvance = false, label = qId, hold = [] } = {}) {
    const group = h("div", { class: cls === "chip" ? "chips" : "option-grid", role: "radiogroup", "aria-labelledby": label });
    const btns = options.map(([v, text, ic, desc]) => h("button", {
      type: "button", class: cls, role: "radio", "aria-checked": String(value === v), tabindex: "-1", dataset: { value: v },
    }, ic ? icon(ic) : null, h("span", {}, text), desc ? h("span", { class: "option-desc" }, desc) : null));
    (btns.find((b) => b.dataset.value === value) || btns[0]).setAttribute("tabindex", "0");
    const check = (b) => { for (const x of btns) { x.setAttribute("aria-checked", String(x === b)); x.setAttribute("tabindex", x === b ? "0" : "-1"); } };
    const pick = (b, advance) => {
      check(b); onPick(b.dataset.value);
      if (advance && autoAdvance && !hold.includes(b.dataset.value)) { clearTimeout(advanceTimer); advanceTimer = setTimeout(() => nextScreen(), reduced() ? 0 : 220); }
    };
    btns.forEach((b, i) => {
      b.addEventListener("click", () => pick(b, true));
      b.addEventListener("keydown", (e) => {
        // Enter escolhe e avança (como em qualquer pergunta); Espaço só escolhe
        if (e.key === "Enter" && cls !== "chip" && cls !== "seg-btn") { e.preventDefault(); pick(b, false); if (!hold.includes(b.dataset.value)) form.requestSubmit(); return; }
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const nb = btns[(i + d + btns.length) % btns.length];
        nb.focus(); pick(nb, false);
      });
    });
    group.append(...btns);
    return group;
  }

  function field({ id, label, input, help = "", error = "" }) {
    const errId = `${id}-err`, helpId = `${id}-help`;
    input.id = id;
    input.setAttribute("aria-describedby", [help ? helpId : "", errId].filter(Boolean).join(" "));
    if (error) input.setAttribute("aria-invalid", "true");
    return h("div", { class: "field" },
      label ? h("label", { for: id }, label) : null,
      help ? h("p", { class: "help", id: helpId }, help) : null,
      input,
      h("p", { class: "error", id: errId, "aria-live": "polite" }, error ? icon("alert") : null, error || ""));
  }

  function setError(input, msg) {
    const err = document.getElementById(`${input.id}-err`);
    input.setAttribute("aria-invalid", "true");
    if (err) err.replaceChildren(icon("alert"), msg);
    input.focus();
  }

  const nameOrIt = () => (ans.name || "").trim() || "ele";
  const animalLabel = () => (ans.name || "").trim() || "o animal";

  // ---------- telas ----------
  // Cada tela devolve { q, sub, body, validate?, focus?, skip?, optional? }
  function screen() {
    const key = SUBS[draft.step][draft.sub];
    if (draft.step === 1) {
      const input = h("input", { class: "input lg", type: "text", autocomplete: "name", maxlength: "60", autocapitalize: "words", enterkeyhint: "next", "aria-labelledby": qId });
      input.value = ans.personName || "";
      input.addEventListener("input", () => { ans.personName = input.value; persist(); input.removeAttribute("aria-invalid"); });
      return {
        q: "Como você se chama?", sub: "Vamos começar criando seu espaço no Simut.",
        body: field({ id: "ob-person", input }),
        focus: input,
        validate: () => (input.value.trim() ? true : (setError(input, "Pode ser seu primeiro nome ou como prefere ser chamado."), false)),
      };
    }
    if (draft.step === 2) {
      if (key === "especie") {
        const other = h("input", { class: "input", type: "text", maxlength: "40", placeholder: "Ex.: coelho", enterkeyhint: "next" });
        other.value = ans.speciesOther || "";
        other.addEventListener("input", () => { ans.speciesOther = other.value; persist(); });
        const otherBox = h("div", { class: "ob-reveal", hidden: ans.species !== "outro" }, field({ id: "ob-other", label: h("span", {}, "Qual animal? ", h("span", { class: "optional" }, "(opcional)")), input: other }));
        const grp = optionGroup([["cao", "Cão", "dog"], ["gato", "Gato", "cat"], ["outro", "Outro", "paw"]], ans.species, (v) => {
          ans.species = v; persist();
          otherBox.hidden = v !== "outro";
          if (v === "outro") setTimeout(() => other.focus());
        }, { autoAdvance: true, hold: ["outro"] }); // "Outro" não avança sozinho: revela o campo
        return {
          q: "Quem vamos acompanhar?", sub: "Conte um pouquinho sobre o animal que será monitorado.",
          body: h("div", { class: "stack" }, grp, otherBox),
          focus: grp.querySelector("[tabindex='0']"),
          validate: () => {
            if (ans.species) return true;
            grp.setAttribute("aria-describedby", "ob-species-err");
            msgEl("ob-species-err", "Escolha uma opção. Se não for cão nem gato, escolha Outro.");
            grp.querySelector("[tabindex='0']").focus();
            return false;
          },
          extra: h("p", { class: "error", id: "ob-species-err", "aria-live": "polite" }),
        };
      }
      if (key === "nome") {
        const input = h("input", { class: "input lg", type: "text", maxlength: "60", autocapitalize: "words", autocomplete: "off", enterkeyhint: "next", "aria-labelledby": qId });
        input.value = ans.name || "";
        input.addEventListener("input", () => { ans.name = input.value; persist(); input.removeAttribute("aria-invalid"); });
        return {
          q: "Qual é o nome?", sub: "Como você chama o animal no dia a dia.",
          body: field({ id: "ob-name", input }), focus: input,
          validate: () => (input.value.trim() ? true : (setError(input, "Escreva o nome. Pode ser um apelido."), false)),
        };
      }
      if (key === "raca") {
        const listId = "ob-breeds";
        const input = h("input", { class: "input lg", type: "text", maxlength: "60", list: listId, autocomplete: "off", enterkeyhint: "next", "aria-labelledby": qId });
        input.value = ans.breed || "";
        const dl = h("datalist", { id: listId }, (BREEDS[ans.species] || []).map((b) => h("option", { value: b })));
        const chips = optionGroup([["srd", "SRD (sem raça definida)"], ["mestico", "Mestiço"], ["nao-sei", "Não sei"]], ans.breedChoice || null, (v) => {
          ans.breedChoice = v; ans.breed = ""; input.value = ""; persist();
        }, { cls: "chip" });
        input.addEventListener("input", () => {
          ans.breed = input.value;
          if (input.value) { ans.breedChoice = null; chips.querySelectorAll("[role=radio]").forEach((c) => c.setAttribute("aria-checked", "false")); }
          persist();
        });
        return {
          q: `Qual é a raça de ${animalLabel()}?`, sub: "Digite ou escolha uma opção. Não tem problema não saber.", optional: true,
          body: h("div", { class: "stack" }, field({ id: "ob-breed", input }), dl, chips), focus: input,
        };
      }
      if (key === "idade") {
        const live = h("p", { class: "ob-live", "aria-live": "polite" });
        const num = h("input", { class: "input lg", type: "text", inputmode: "decimal", maxlength: "4", enterkeyhint: "next", "aria-label": "Idade aproximada" });
        num.value = ans.ageValue || "";
        const unit = h("select", { class: "select lg", "aria-label": "Unidade" }, h("option", { value: "anos" }, "anos"), h("option", { value: "meses" }, "meses"));
        unit.value = ans.ageUnit || "anos";
        const date = h("input", { class: "input lg", type: "date", max: new Date().toISOString().slice(0, 10), "aria-label": "Data de nascimento" });
        date.value = ans.birthDate || "";
        const approxBox = h("div", { class: "ob-inline" }, num, unit);
        const dateBox = h("div", {}, date);
        const update = () => {
          approxBox.hidden = ans.ageMode === "nasc";
          dateBox.hidden = ans.ageMode !== "nasc";
          const age = animalFromAnswers({ ...ans, species: "cao", name: "x" }).age;
          live.textContent = ans.ageUnknown ? "Tudo bem, dá para completar depois em Opções." : age ? (ageLabel(age).replace(/^./, (c) => c.toUpperCase())) : "";
        };
        if (!ans.ageMode) ans.ageMode = "aprox";
        const seg = optionGroup([["aprox", "Aproximada"], ["nasc", "Data de nascimento"]], ans.ageMode, (v) => { ans.ageMode = v; ans.ageUnknown = false; unknown.setAttribute("aria-pressed", "false"); persist(); update(); }, { cls: "seg-btn", label: qId });
        seg.className = "segmented";
        const unknown = h("button", { type: "button", class: "chip", "aria-pressed": String(!!ans.ageUnknown) }, "Não sei");
        unknown.addEventListener("click", () => {
          ans.ageUnknown = !ans.ageUnknown; unknown.setAttribute("aria-pressed", String(ans.ageUnknown));
          if (ans.ageUnknown) { num.value = ""; date.value = ""; ans.ageValue = ""; ans.birthDate = ""; }
          persist(); update();
        });
        const onInput = () => { ans.ageValue = num.value; ans.ageUnit = unit.value; ans.birthDate = date.value; if (num.value || date.value) { ans.ageUnknown = false; unknown.setAttribute("aria-pressed", "false"); } persist(); update(); num.removeAttribute("aria-invalid"); };
        num.addEventListener("input", onInput); unit.addEventListener("change", onInput); date.addEventListener("input", onInput);
        update();
        return {
          q: `Que idade ${nameOrIt() === "ele" ? "o animal" : nameOrIt()} tem?`, sub: "Uma idade aproximada já ajuda. Se preferir, informe a data de nascimento.", optional: true,
          body: h("div", { class: "stack" }, seg, approxBox, dateBox, h("div", { class: "chips" }, unknown), live,
            h("p", { class: "error", id: "ob-age-err", "aria-live": "polite" })),
          focus: ans.ageMode === "nasc" ? date : num,
          validate: () => {
            if (ans.ageUnknown || ans.ageMode === "nasc" || !num.value.trim()) return true;
            const n = parseDecimal(num.value);
            if (n !== null && n > 0 && n <= (unit.value === "meses" ? 480 : 40)) return true;
            num.id = "ob-age"; num.setAttribute("aria-describedby", "ob-age-err");
            msgEl("ob-age-err", unit.value === "meses" ? "Use um número de meses entre 1 e 480." : "Use um número de anos entre 1 e 40."); num.setAttribute("aria-invalid", "true"); num.focus();
            return false;
          },
        };
      }
      if (key === "peso") {
        const input = h("input", { class: "input lg", type: "text", inputmode: "decimal", maxlength: "6", enterkeyhint: "next", "aria-labelledby": qId, placeholder: "Ex.: 6,5" });
        input.value = ans.weight || "";
        const unknown = h("button", { type: "button", class: "chip", "aria-pressed": String(!!ans.weightUnknown) }, "Não sei");
        unknown.addEventListener("click", () => {
          ans.weightUnknown = !ans.weightUnknown; unknown.setAttribute("aria-pressed", String(ans.weightUnknown));
          if (ans.weightUnknown) { input.value = ""; ans.weight = ""; }
          persist();
        });
        input.addEventListener("input", () => { ans.weight = input.value; if (input.value) { ans.weightUnknown = false; unknown.setAttribute("aria-pressed", "false"); } persist(); input.removeAttribute("aria-invalid"); });
        return {
          q: `Quanto ${nameOrIt() === "ele" ? "o animal" : nameOrIt()} pesa?`, sub: "Em quilos, pode usar vírgula. Um valor aproximado serve.", optional: true,
          body: h("div", { class: "stack" }, h("div", { class: "ob-inline unit" }, field({ id: "ob-weight", input }), h("span", { class: "unit-suffix", "aria-hidden": "true" }, "kg")), h("div", { class: "chips" }, unknown)),
          focus: input,
          validate: () => {
            if (!input.value.trim()) return true;
            const w = parseDecimal(input.value);
            return w !== null && w >= 0.1 && w <= 200 ? true : (setError(input, "Use um valor entre 0,1 e 200 kg."), false);
          },
        };
      }
      if (key === "sexo") {
        const neut = h("div", { class: "ob-reveal", hidden: !(ans.sex === "macho" || ans.sex === "femea") },
          h("p", { class: "label", id: "ob-neut-q" }, ans.sex === "femea" ? "Castrada?" : "Castrado?", " ", h("span", { class: "optional" }, "(opcional)")),
          optionGroup([["sim", "Sim"], ["nao", "Não"], ["nao-sei", "Não sei"]], ans.neutered || null, (v) => { ans.neutered = v; persist(); }, { cls: "chip", label: "ob-neut-q" }));
        const grp = optionGroup([["macho", "Macho"], ["femea", "Fêmea"], ["nao-informar", "Prefiro não informar"]], ans.sex || null, (v) => {
          ans.sex = v; persist();
          neut.hidden = !(v === "macho" || v === "femea");
          neut.querySelector("#ob-neut-q").firstChild.textContent = v === "femea" ? "Castrada?" : "Castrado?";
        });
        return {
          q: "Qual é o sexo biológico?", sub: "Ajuda a interpretar os padrões de atividade. É opcional.", optional: true,
          body: h("div", { class: "stack" }, grp, neut), focus: grp.querySelector("[tabindex='0']"),
        };
      }
    }
    if (draft.step === 3) {
      const r = ROUTINE[key];
      const Q = { environment: `Onde ${animalLabel()} passa a maior parte do tempo?`, activity: "Como é a rotina de atividade?", restPlace: "Onde costuma descansar?" };
      const grp = optionGroup(r.options, ans[key] || null, (v) => { ans[key] = v; persist(); }, { cls: "option-card row", autoAdvance: true });
      return {
        q: Q[key], sub: `Como é o dia a dia de ${animalLabel()}? Escolha a opção mais próxima.`, optional: true, skip: true,
        body: grp, focus: grp.querySelector("[tabindex='0']"),
      };
    }
    return null;
  }

  function msgEl(id, text) {
    const el2 = document.getElementById(id);
    if (el2) el2.replaceChildren(icon("alert"), text);
  }

  // ---------- resumo (etapa 4) ----------
  function summary() {
    const a = animalFromAnswers(ans, {});
    const editBtn = (label, step, sub) => h("button", { type: "button", class: "btn sm ghost", "aria-label": `Editar ${label}`, onclick: () => { draft.returnTo = 4; goStep(step, sub); } }, icon("edit"), "Editar");
    const row = (label, value, step, sub, edit = true) => h("div", { class: "sum-row" },
      h("dt", {}, label), h("dd", {}, value || h("span", { class: "muted" }, "Não informado")), edit ? editBtn(label.toLowerCase(), step, sub) : h("span"));
    const sp = a.species === "outro" ? (a.speciesOther || SPECIES.outro) : SPECIES[a.species];
    const sexTxt = a.sex ? `${SEX_LABEL[a.sex]}${a.neutered === true ? (a.sex === "femea" ? ", castrada" : ", castrado") : a.neutered === false ? (a.sex === "femea" ? ", não castrada" : ", não castrado") : ""}` : "";
    const cards = [];
    if (flow !== "adicionar") cards.push(h("section", { class: "card sum-card" }, h("h2", {}, "Você"), h("dl", {}, row("Nome", ans.personName, 1, 0))));
    cards.push(h("section", { class: "card sum-card" }, h("h2", {}, a.name || "Animal"), h("dl", {},
      row("Espécie", sp, 2, 0), row("Nome", a.name, 2, 1), row("Raça", a.breed === null ? "Não sei" : breedLabel(a.breed), 2, 2),
      row("Idade", a.age === null ? "Não sei" : ageLabel(a.age), 2, 3), row("Peso", a.weightKg === null ? "Não sei" : a.weightKg ? `${String(a.weightKg).replace(".", ",")} kg` : "", 2, 4),
      row("Sexo", sexTxt, 2, 5))));
    cards.push(h("section", { class: "card sum-card" }, h("h2", {}, "Rotina"), h("dl", {},
      Object.keys(ROUTINE).map((k, i) => row(ROUTINE[k].label, routineLabel(k, ans[k]), 3, i)))));

    const legacy = flow === "legado";
    const primary = h("button", { type: "submit", class: "btn primary lg btn-block" }, legacy ? `Ir para o painel do ${a.name || "Simut"}` : "Começar a monitorar");
    const secondary = legacy
      ? h("button", { type: "button", class: "btn ghost btn-block", onclick: () => { draft.reviewing = true; goStep(2, 0); } }, `Revisar dados do ${a.name || "Simut"}`)
      : h("button", { type: "button", class: "btn secondary btn-block", onclick: () => finish("visao-geral") }, "Explorar o Simut");
    return {
      q: "Está tudo pronto!",
      sub: legacy ? `Já conhecemos ${a.name || "o Simut"} pelos dados guardados. Confira o resumo e, se quiser, complete o que faltar.` : "Confira o resumo. Você pode editar qualquer item antes de concluir.",
      body: h("div", { class: "sum-grid" }, cards),
      actions: [primary, secondary],
      submit: () => finish(legacy ? "visao-geral" : "sensor"),
    };
  }

  // ---------- conclusão ----------
  function finish(section) {
    if (flow !== "adicionar" && !String(ans.personName || "").trim()) { goStep(1, 0); return; }
    if (!String(ans.name || "").trim()) { draft.returnTo = 4; goStep(2, 1); return; }
    const now = Date.now();
    const base = flow === "legado" ? (findAnimal(state.animals, LEGACY_ANIMAL_ID) || { id: LEGACY_ANIMAL_ID }) : { id: draft.animalId || newAnimalId(now) };
    const animal = animalFromAnswers(ans, base, now);
    if (flow !== "adicionar") {
      app.saveProfile({ ...(state.profile || {}), name: String(ans.personName).trim().slice(0, 60), createdAt: state.profile?.createdAt || now, onboardingDone: true, onboardingFlow: flow });
    }
    app.saveAnimal(animal);
    track("complete", { step: 4 });
    clearDraft();
    saveLastAnimal(animal.id);
    navigate(animalPath(animal.id, section));
  }

  // ---------- render ----------
  const form = h("form", { class: "ob-form", novalidate: true });
  const root = h("div", { class: "ob" },
    h("div", { class: "ob-top" },
      h("span", { class: "logo" }, h("span", { class: "logo-mark", "aria-hidden": "true" }, "S"), h("span", { class: "logo-text" }, "SIMUT")),
      flow === "adicionar" ? h("a", { class: "btn sm ghost", href: "#/animais", onclick: () => clearDraft() }, "Cancelar") : null),
    form);
  el.append(root);

  let current = null;
  // Enter avança em qualquer campo (inclusive com a lista de raças aberta)
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || e.defaultPrevented) return;
    if (e.target.matches?.("input:not([type=checkbox]):not([type=radio]), select")) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (draft.step === 4) { current.submit(); return; }
    if (current?.validate && !current.validate()) return;
    nextScreen();
  });

  function progress() {
    const steps = [1, 2, 3, 4];
    const label = `Etapa ${draft.step} de 4: ${STEP_NAME[draft.step]}`;
    return h("div", { class: "ob-progress" },
      h("ol", { class: "steps", "aria-hidden": "true" }, steps.map((s) => {
        const isDone = s < draft.step || (flow === "legado" && draft.step === 4) || (flow === "adicionar" && s === 1);
        return h("li", { class: s === draft.step ? "current" : isDone ? "done" : "" }, h("span", { class: "dot" }));
      })),
      h("p", { class: "steps-label" }, label));
  }

  function show() {
    clearTimeout(advanceTimer);
    current = draft.step === 4 ? summary() : screen();
    if (!current) { draft.step = flow === "adicionar" ? 2 : 1; draft.sub = 0; current = screen(); }
    const subs = SUBS[draft.step];
    const subBar = subs.length > 1 && draft.step !== 4
      ? h("div", { class: "ob-subprogress" },
        h("span", { class: "visually-hidden" }, `Pergunta ${draft.sub + 1} de ${subs.length}`),
        h("span", { class: "sp-text", "aria-hidden": "true" }, `${draft.sub + 1} de ${subs.length}`),
        h("span", { class: "sp-bar", "aria-hidden": "true" }, h("span", { style: { width: `${((draft.sub + 1) / subs.length) * 100}%` } })))
      : null;
    const back = canGoBack() ? h("button", { type: "button", class: "btn ghost", onclick: prevScreen }, icon("chevronLeft"), "Voltar") : h("span");
    const actions = current.actions || [
      current.skip ? h("button", { type: "button", class: "btn ghost", onclick: () => { ans[SUBS[draft.step][draft.sub]] = ans[SUBS[draft.step][draft.sub]] || null; nextScreen(); } }, "Pular") : null,
      h("button", { type: "submit", class: "btn primary lg" }, draft.returnTo ? "Salvar e voltar ao resumo" : "Continuar"),
    ];
    form.replaceChildren(
      h("div", { class: `ob-main${draft.step === 4 ? " wide" : ""}` },
        h("p", { class: "ob-kicker" }, STEP_NAME[draft.step], current.optional ? h("span", { class: "ob-optional" }, "Opcional") : null),
        h("h1", { id: qId, tabindex: "-1" }, current.q),
        current.sub ? h("p", { class: "ob-sub", id: subId }, current.sub) : null,
        subBar,
        h("div", { class: "ob-control" }, current.body, current.extra || null)),
      h("div", { class: `ob-footer${draft.step === 4 ? " summary" : ""}` },
        h("div", { class: "ob-buttons" }, back, h("div", { class: "ob-buttons-right" }, actions)),
        progress()),
    );
    track("step_view", { step: draft.step, sub: draft.sub });
    const f = current.focus;
    if (f) queueMicrotask(() => { if (el.contains(f)) f.focus({ preventScroll: true }); }); // depois do foco no h1 feito pelo router
  }

  show();
  return {
    unmount() {
      clearTimeout(advanceTimer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    },
  };
}
