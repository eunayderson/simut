// Sessão de validação (marcações ao vivo + resultado) como módulo montável.
// Mesma interface e mesmos ids do painel antigo. Marcações são filtradas pelo animal
// e as novas levam o campo a (animalId).
//
// ctx = {
//   state,                 // { marks (todas), epochs (do animal), cloudKey }
//   animalId, animalName,
//   getSettings(),         // configurações efetivas do animal
//   onApplyThresholds(sug) // grava os limiares sugeridos e recalcula
//   log, ui: { confirm, alert, prompt } (padrão: diálogos nativos)
// }

import { STATES, stateById, saveMarks, exportMarks, importMarks, analyze, marksOf, markKey, undoLast, clearMarksOf, mergeTombstones, saveDeleted, mergeMarkLists } from "../validation.js?v=10";
import { syncMarks } from "../cloud.js?v=10";
import { escapeHtml } from "./dom.js?v=10";

const CLS_LABEL = { rest: "Repouso", light: "Leve", vig: "Intenso" };
const PROTOCOL_URL = "https://github.com/eunayderson/simut/blob/main/docs/validacao.md";

const nativeUi = {
  confirm: async (text) => window.confirm(text),
  alert: async (text) => window.alert(text),
  prompt: async (text, value) => window.prompt(text, value),
};

export function mount(el, ctx) {
  const state = ctx.state;
  const ui = { ...nativeUi, ...(ctx.ui || {}) };
  const log = ctx.log || (() => {});
  const animalId = ctx.animalId;
  const getSettings = ctx.getSettings || (() => state.settings);
  const $ = (id) => el.querySelector(`#${id}`);

  el.innerHTML = `
    <div class="card-head"><h2>Sessão de validação</h2><a class="small link-target" href="${PROTOCOL_URL}" target="_blank" rel="noopener">Ver protocolo</a></div>
    <p class="small muted">Toque no estado no momento em que ele começa. Cada estado por pelo menos 7 minutos. Depois sincronize o sensor e veja o resultado aqui.</p>
    <div class="now" id="valNow" aria-live="polite">Nenhuma sessão em andamento</div>
    <div class="state-grid" id="stateGrid"></div>
    <div class="actions">
      <button class="btn" id="valEnd" type="button">Encerrar</button>
      <button class="btn ghost" id="valUndo" type="button">Desfazer última</button>
      <button class="btn ghost" id="valCopy" type="button">Copiar marcações</button>
      <button class="btn ghost" id="valPaste" type="button">Colar marcações</button>
      <button class="btn ghost danger" id="valClear" type="button">Limpar marcações</button>
    </div>
    <ol class="marks small" id="valMarks"></ol>
    <h3>Resultado</h3>
    <div id="valResult" class="val-result"><p class="muted small">Ainda sem marcações com dados do sensor no mesmo horário.</p></div>`;

  const mine = () => marksOf(state.marks, animalId);
  const lastMark = () => { const m = mine(); return m[m.length - 1]; };
  // Nuvem: o app junta com o remoto e com o estado atual (ctx.onMarksChanged). Sem o app, faz direto.
  const cloudMerge = (what) => {
    if (ctx.onMarksChanged) { ctx.onMarksChanged(); return; }
    if (!state.cloudKey) return;
    syncMarks(state.cloudKey, state.marks, state.marksDeleted || []).then((r) => {
      state.marksDeleted = mergeTombstones(state.marksDeleted || [], r.deleted);
      saveDeleted(state.marksDeleted);
      state.marks.splice(0, state.marks.length, ...mergeMarkLists(r.marks, state.marks, { deleted: state.marksDeleted }));
      saveMarks(state.marks); render();
    }).catch((e) => log(`nuvem (${what}): ${e.message}`));
  };
  // Desfazer e limpar: tira só as marcações visadas e grava tombstones (não voltam no próximo merge).
  function removeMarks({ marks, tombstones }) {
    state.marks.splice(0, state.marks.length, ...marks);
    state.marksDeleted = mergeTombstones(state.marksDeleted || [], tombstones);
    saveMarks(state.marks); saveDeleted(state.marksDeleted);
    render(); cloudMerge("marcações");
  }

  function addMark(id) {
    state.marks.push({ t: Date.now(), s: id, a: animalId });
    saveMarks(state.marks);
    if (navigator.vibrate) navigator.vibrate(30);
    render();
    cloudMerge("marcação");
  }

  const grid = $("stateGrid");
  for (const st of STATES) {
    const b = document.createElement("button");
    b.type = "button"; b.className = `btn state-btn ${st.cls ?? ""}`; b.textContent = st.label; b.dataset.id = st.id;
    b.addEventListener("click", () => addMark(st.id));
    grid.append(b);
  }

  function renderNow() {
    const m = lastMark(), box = $("valNow");
    el.querySelectorAll(".state-btn").forEach((b) => {
      const on = !!m && m.s === b.dataset.id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (!m || m.s === "fim") { box.textContent = "Nenhuma sessão em andamento"; return; }
    const sec = Math.floor((Date.now() - m.t) / 1000);
    box.innerHTML = `Agora: ${escapeHtml(stateById[m.s]?.label ?? m.s)}<span class="timer">${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}</span>`;
  }
  const timer = setInterval(renderNow, 1000);

  function render() {
    renderNow();
    const list = mine();
    $("valMarks").innerHTML = list.slice(-30).map((m) => `<li>${new Date(m.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}: ${m.s === "fim" ? "Encerrado" : escapeHtml(stateById[m.s]?.label ?? m.s)}</li>`).join("");
    const box = $("valResult");
    if (!list.length) { box.innerHTML = `<p class="muted small">Nenhuma marcação ainda.</p>`; return; }
    const s = getSettings();
    const r = analyze(state.epochs, list, s);
    if (!r.n) { box.innerHTML = `<p class="muted small">As marcações ainda não têm dados do sensor no mesmo horário. Sincronize o sensor depois da sessão.</p>`; return; }
    const pct = (v) => (isFinite(v) ? `${Math.round(v * 100)}%` : "-");
    const kTxt = !isFinite(r.kappa) ? "-" : r.kappa.toFixed(2);
    const kWord = !isFinite(r.kappa) ? "" : r.kappa > 0.8 ? "quase perfeita" : r.kappa > 0.6 ? "substancial" : r.kappa > 0.4 ? "moderada" : "fraca";
    const statRows = STATES.filter((x) => r.stats[x.id]).map((x) => { const v = r.stats[x.id]; return `<tr><td>${x.label}</td><td>${v.n}</td><td>${Math.round(v.med)}</td><td>${Math.round(v.p10)} a ${Math.round(v.p90)}</td></tr>`; }).join("");
    const cls = ["rest", "light", "vig"];
    const conf = cls.map((t) => `<tr><td>${CLS_LABEL[t]}</td>${cls.map((p) => `<td>${r.confusion[t][p]}</td>`).join("")}</tr>`).join("");
    const missing = cls.filter((c) => r.counts[c] < 5).map((c) => CLS_LABEL[c].toLowerCase());
    const sug = r.suggest;
    const canApply = sug.tLight && sug.tVig && sug.tVig > sug.tLight;
    box.innerHTML = `
      <div class="val-kpis">
        <div><span>Janelas comparadas</span><b class="big-num">${r.n}</b></div>
        <div><span>Acurácia</span><b class="big-num">${pct(r.accuracy)}</b></div>
        <div><span>Kappa</span><b class="big-num">${kTxt}</b><span>${kWord}</span></div>
      </div>
      <table><thead><tr><th>Estado</th><th>Janelas</th><th>Mediana (mg)</th><th>Faixa 10 a 90%</th></tr></thead><tbody>${statRows}</tbody></table>
      <table><thead><tr><th>Observado / Sensor</th><th>Repouso</th><th>Leve</th><th>Intenso</th></tr></thead><tbody>${conf}</tbody></table>
      <p class="val-note">Limiares atuais: leve ${s.tLight} mg, intenso ${s.tVig} mg.<br>
      Sugeridos pelos dados: leve ${sug.tLight ?? "-"} mg${sug.balLight ? ` (acerto ${pct(sug.balLight)})` : ""}, intenso ${sug.tVig ?? "-"} mg${sug.balVig ? ` (acerto ${pct(sug.balVig)})` : ""}.</p>
      ${missing.length ? `<p class="val-note">Faltam dados de: ${missing.join(", ")} (mínimo de 5 janelas cada).</p>` : ""}
      ${canApply ? `<button class="btn primary" id="valApply" type="button">Aplicar limiares sugeridos</button>` : ""}`;
    $("valApply")?.addEventListener("click", async () => {
      if (!(await ui.confirm(`Trocar os limiares para leve ${sug.tLight} mg e intenso ${sug.tVig} mg? Para validar de verdade, teste esses limiares numa segunda sessão.`))) return;
      await ctx.onApplyThresholds?.({ tLight: sug.tLight, tVig: sug.tVig });
    });
  }

  $("valEnd").addEventListener("click", () => { const m = lastMark(); if (m && m.s !== "fim") addMark("fim"); });
  $("valUndo").addEventListener("click", () => removeMarks(undoLast(state.marks, animalId)));
  $("valClear").addEventListener("click", async () => {
    const who = ctx.animalName ? ` de ${ctx.animalName}` : "";
    if (!(await ui.confirm(`Apagar todas as marcações de validação${who}?`))) return;
    removeMarks(clearMarksOf(state.marks, animalId));
  });
  $("valCopy").addEventListener("click", async () => {
    const code = exportMarks(mine());
    try { await navigator.clipboard.writeText(code); await ui.alert("Marcações copiadas. Cole no painel do outro aparelho em \"Colar marcações\"."); }
    catch { await ui.prompt("Copie este código:", code); }
  });
  $("valPaste").addEventListener("click", async () => {
    const txt = await ui.prompt("Cole aqui o código das marcações (começa com SIMUT1:)");
    if (!txt) return;
    try {
      const add = importMarks(txt).map((m) => ({ ...m, a: animalId }));
      const seen = new Set(state.marks.map(markKey));
      for (const m of add) if (!seen.has(markKey(m))) { state.marks.push(m); seen.add(markKey(m)); }
      state.marks.sort((a, b) => a.t - b.t); saveMarks(state.marks); render();
      cloudMerge("colar");
      await ui.alert(`${add.length} marcações recebidas.`);
    } catch (e) { await ui.alert(`Não consegui ler: ${e.message}`); }
  });

  render();
  return { render, unmount() { clearInterval(timer); el.replaceChildren(); } };
}
