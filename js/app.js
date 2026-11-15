import { bluetoothSupport, hex } from "./ble.js?v=10";
import { log, subscribe as onLog } from "./log.js?v=10";
import { getSensor, run as runSync } from "./sync.js?v=10";
import { saveSync, loadSyncs, clearAll, loadSettings, saveSettings, loadAnimals, saveAnimals, loadProfile, migrateLastSync, getLastSync, setLastSync, clearLastSyncs } from "./store.js?v=10";
import { migrateLocal, LEGACY_ANIMAL_ID } from "./animals.js?v=10";
import { fmtMin, hhmm } from "./format.js?v=10";
import { buildEpochs, daySummary, nightSummary, trend, toCsv, dayRuns, dayBouts } from "./analysis.js?v=10";
import { STATES, stateById, loadMarks, saveMarks, exportMarks, importMarks, analyze } from "./validation.js?v=10";
import { getKey, setKey, forgetKey, syncAll, mergeMarks, replaceMarks } from "./cloud.js?v=10";

const $ = (id) => document.getElementById(id);
export const VERSION = "10";
const state = { settings: loadSettings(), syncs: [], epochs: [], samples: 0, day: Date.now(), marks: loadMarks(), cloudKey: getKey(), cloudBusy: false, animals: loadAnimals(), profile: loadProfile() };

// ---------- erros visíveis ----------
function showError(msg) {
  const b = document.getElementById("errBanner");
  if (b) { b.hidden = false; b.textContent = `Erro: ${msg}`; }
}
window.addEventListener("error", (e) => showError(e.message));
window.addEventListener("unhandledrejection", (e) => showError(e.reason?.message || String(e.reason)));

// ---------- log ----------
onLog((_, lines) => { $("log").textContent = lines.join("\n"); });

// ---------- sensor ----------
const sensor = getSensor(log);

function setPill(stateName, text) {
  $("sensorPill").dataset.state = stateName;
  $("sensorPillText").textContent = text;
}
function setConnectedUi(on) {
  $("btnConnect").disabled = on;
  setPill(on ? "busy" : "off", on ? "Sincronizando..." : "Sensor desconectado (economizando bateria)");
}
sensor.addEventListener("disconnect", () => setConnectedUi(false));

// Um toque só: conecta, baixa, salva e desconecta (js/sync.js). Ficar conectado gasta bateria do sensor.
$("btnConnect").addEventListener("click", async () => {
  const bar = $("progressBar"), txt = $("progressText");
  try {
    await runSync({
      animalId: LEGACY_ANIMAL_ID,
      sensor,
      onState: (st, text) => {
        if (st === "searching") setPill("busy", text);
        else setConnectedUi(st === "syncing");
      },
      onProgress: ({ pct, text }) => {
        $("progressWrap").hidden = false;
        if (pct !== null) bar.style.width = `${pct}%`;
        txt.textContent = text;
      },
      onInfo: ({ clock, level }) => {
        $("kvClock").textContent = clock ? clock.toLocaleString("pt-BR") : "-";
        if (level !== null) $("kvLevel").textContent = `${level}`;
      },
    });
    await reload();
    cloudSync();
  } catch (e) {
    if (e.name !== "NotFoundError") { $("progressWrap").hidden = false; txt.textContent = `Erro: ${e.message}`; }
  }
});

// ---------- importar .bin gerado pelo script do Mac ----------
// formato: repetição de [tamanho u16 LE][pacote]
$("fileBin").addEventListener("change", async (ev) => {
  const f = ev.target.files?.[0];
  if (!f) return;
  const buf = new Uint8Array(await f.arrayBuffer());
  const packets = [];
  for (let i = 0; i + 2 <= buf.length;) {
    const n = buf[i] | (buf[i + 1] << 8); i += 2;
    if (n < 9 || i + n > buf.length) break;
    packets.push(buf.slice(i, i + n)); i += n;
  }
  if (!packets.length) { alert("Arquivo sem pacotes reconhecidos."); return; }
  const endAt = f.lastModified || Date.now();
  await saveSync({ id: Date.now(), endAt, source: `arquivo ${f.name}`, packets, animalId: LEGACY_ANIMAL_ID });
  log(`importado ${f.name}: ${packets.length} pacotes`);
  ev.target.value = "";
  await reload();
  cloudSync();
});

$("btnClear").addEventListener("click", async () => {
  if (!confirm("Apagar todos os dados do Simut guardados neste navegador? Isso não tem volta.")) return;
  await clearAll();
  clearLastSyncs();
  await reload();
});

$("btnCsv").addEventListener("click", () => {
  if (!state.epochs.length) { alert("Ainda não há dados para exportar."); return; }
  const blob = new Blob([toCsv(state.epochs)], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `simut-janelas-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
});

// ---------- configurações ----------
const form = $("settingsForm");
function fillSettings() { for (const [k, v] of Object.entries(state.settings)) if (form.elements[k]) form.elements[k].value = v; }
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const s = {};
  for (const k of Object.keys(state.settings)) s[k] = Number(form.elements[k].value) || state.settings[k];
  if (s.tVig <= s.tLight) { alert("O limiar intenso precisa ser maior que o leve."); return; }
  state.settings = s; saveSettings(s); recompute();
});

// ---------- navegação de dias ----------
$("prevDay").addEventListener("click", () => { state.day -= 86400000; render(); });
$("nextDay").addEventListener("click", () => { if (!isToday(state.day)) { state.day += 86400000; render(); } });
const isToday = (t) => new Date(t).toDateString() === new Date().toDateString();

// ---------- render ----------
const CLS_NAME = { rest: "repouso", light: "leve", vig: "intenso" };

function renderTimeline(day) {
  const el = $("timeline");
  const runs = dayRuns(state.epochs, day, state.settings);
  const from = new Date(day); from.setHours(0, 0, 0, 0);
  const W = 1000, H = 64, barY = 6, barH = 34;
  const x = (t) => ((t - from.getTime()) / 86400000) * W;
  let g = `<rect x="0" y="${barY}" width="${W}" height="${barH}" rx="8" fill="var(--none)"/>`;
  for (const r of runs) {
    const w = Math.max(1.2, x(r.to) - x(r.from));
    g += `<rect x="${x(r.from).toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" fill="var(--${r.cls})"><title>${hhmm(r.from)} a ${hhmm(r.to)}: ${CLS_NAME[r.cls]}</title></rect>`;
  }
  if (isToday(day)) {
    const nx = x(Date.now());
    g += `<line x1="${nx}" x2="${nx}" y1="2" y2="${barY + barH + 4}" stroke="var(--ink)" stroke-width="2"/>`;
  }
  for (let h = 0; h <= 24; h += 3) {
    const tx = (h / 24) * W;
    g += `<line x1="${tx}" x2="${tx}" y1="${barY + barH}" y2="${barY + barH + 5}" stroke="var(--muted)"/>`;
    g += `<text x="${Math.min(W - 14, Math.max(14, tx))}" y="${H - 4}" font-size="20" text-anchor="middle" fill="var(--muted)">${h}h</text>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${g}</svg>`;
  // texto do eixo não pode esticar: refaz o eixo em HTML
  el.querySelectorAll("text").forEach((t) => t.remove());
  el.insertAdjacentHTML("beforeend", `<div class="ticks">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span>${h}h</span>`).join("")}</div>`);
}

function renderBouts(day) {
  const ul = $("bouts");
  const list = dayBouts(state.epochs, day, state.settings);
  if (!list.length) {
    ul.innerHTML = `<li class="empty-li">Nenhum momento ativo de 2 minutos ou mais neste dia.</li>`;
    return;
  }
  ul.innerHTML = list.reverse().map((b) => {
    const min = Math.round((b.end - b.start) / 60000);
    const intense = b.vig / (b.active || 1) >= 0.3;
    return `<li><span class="b-dot ${intense ? "vig" : "light"}"></span>
      <span class="b-time">${hhmm(b.start)} às ${hhmm(b.end)}</span>
      <span class="b-dur">${fmtMin(min)}</span>
      <span class="b-kind">${intense ? "intenso" : "leve"}</span></li>`;
  }).join("");
}

function summarySentence(day, tot, covered) {
  if (!covered) return "Sem dados neste dia. Sincronize o sensor para ver como o Simut passou o dia.";
  const active = tot.light + tot.vig;
  const nb = dayBouts(state.epochs, day, state.settings).length;
  const quando = isToday(day) ? "Hoje" : "Neste dia";
  return `${quando}, em ${fmtMin(covered)} medidos, o Simut ficou ${fmtMin(tot.rest)} em repouso e ${fmtMin(active)} em movimento${tot.vig ? ` (${fmtMin(tot.vig)} intenso)` : ""}, com ${nb} ${nb === 1 ? "momento ativo" : "momentos ativos"}.`;
}

function renderTrend(rows) {
  const el = $("trendChart");
  if (!rows.some((r) => r.covered > 0)) {
    el.innerHTML = `<div class="empty">A tendência aparece depois de alguns dias de uso.</div>`;
    return;
  }
  const W = 480, H = 170, pad = 4, bw = (W - pad) / rows.length;
  const max = Math.max(60, ...rows.map((r) => r.active));
  let g = "";
  rows.forEach((r, i) => {
    const x = pad + i * bw;
    const h = (r.active / max) * (H - 36);
    const hv = (r.vig / max) * (H - 36);
    const d = new Date(r.day);
    if (r.covered) {
      g += `<rect x="${x + 3}" y="${H - 20 - h}" width="${bw - 6}" height="${h}" rx="3" fill="var(--light)"><title>${d.toLocaleDateString("pt-BR")}: ${fmtMin(r.active)} ativo</title></rect>`;
      g += `<rect x="${x + 3}" y="${H - 20 - hv}" width="${bw - 6}" height="${hv}" rx="3" fill="var(--vig)"/>`;
    } else {
      g += `<rect x="${x + 3}" y="${H - 22}" width="${bw - 6}" height="2" fill="var(--line)"/>`;
    }
    if (i % 2 === rows.length % 2 || i === rows.length - 1) g += `<text x="${x + bw / 2}" y="${H - 5}" font-size="10" text-anchor="middle" fill="var(--muted)">${d.getDate()}/${d.getMonth() + 1}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
}

function render() {
  const s = state.settings;
  const d = new Date(state.day);
  $("dayLabel").textContent = isToday(state.day) ? "Hoje" : d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  $("nextDay").disabled = isToday(state.day);

  const day = daySummary(state.epochs, state.day, s);
  const has = day.coveredMin > 0;
  $("stRest").textContent = has ? fmtMin(day.tot.rest) : "-";
  $("stLight").textContent = has ? fmtMin(day.tot.light) : "-";
  $("stVig").textContent = has ? fmtMin(day.tot.vig) : "-";
  $("stCov").textContent = has ? fmtMin(day.coveredMin) : "-";
  $("daySummary").textContent = summarySentence(state.day, day.tot, day.coveredMin);
  renderTimeline(state.day);
  renderBouts(state.day);

  const n = nightSummary(state.epochs, state.day, s);
  $("ntRest").textContent = n ? `${Math.round((n.restMin / n.coveredMin) * 100)}%` : "-";
  $("ntWakes").textContent = n ? String(n.wakes) : "-";
  $("ntLongest").textContent = n ? fmtMin(n.longestMin) : "-";

  renderTrend(trend(state.epochs, Date.now(), s));
  renderValidation();

  renderLevelHistory();
  $("kvPackets").textContent = state.syncs.reduce((a, x) => a + x.packets.length, 0).toLocaleString("pt-BR");
  $("kvSamples").textContent = state.samples.toLocaleString("pt-BR");
  const last = getLastSync(LEGACY_ANIMAL_ID);
  $("lastSync").textContent = last ? `Último download: ${new Date(last).toLocaleString("pt-BR")}` : "Nunca sincronizado";
}

// Último byte da resposta do comando 05: suspeita de nível de bateria (%). Registrado a cada sincronização.
function renderLevelHistory() {
  const rows = state.syncs.filter((x) => x.sensor?.info).map((x) => {
    const b = x.sensor.info.split(" ").map((h) => parseInt(h, 16));
    return { t: x.id, v: b[b.length - 1] };
  });
  const el = $("levelHistory");
  if (!rows.length) { el.textContent = "O histórico do nível começa a ser registrado na próxima sincronização."; return; }
  const last = rows[rows.length - 1];
  $("kvLevel").textContent = `${last.v}`;
  const fmt = (t) => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  el.textContent = "Histórico do nível: " + rows.slice(-8).map((r) => `${fmt(r.t)} → ${r.v}`).join(" · ");
}

function recompute() {
  const { epochs, totalSamples } = buildEpochs(state.syncs, state.settings);
  state.epochs = epochs; state.samples = totalSamples;
  render();
}

async function reload() {
  try { state.syncs = await loadSyncs(); }
  catch (e) { log(`armazenamento indisponível: ${e.message}`); state.syncs = []; }
  recompute();
}

// ---------- ajuda quando o navegador não tem Bluetooth ----------
const BLUEFY_URL = "https://apps.apple.com/br/app/bluefy-web-ble-browser/id1492822055";
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/.test(navigator.userAgent);

function showBtHelp(reason) {
  const box = $("btHint"), text = $("btHintText"), acts = $("btHintActions");
  // "off" pode ser falso negativo (ex.: navegador sem permissão no macOS): deixa tentar mesmo assim.
  $("btnConnect").disabled = reason !== "off";
  box.hidden = false;
  acts.innerHTML = "";
  const addBtn = (label, onClick, primary = false) => {
    const b = document.createElement("button");
    b.className = `btn${primary ? " primary" : ""}`; b.type = "button"; b.textContent = label;
    b.addEventListener("click", onClick); acts.append(b); return b;
  };
  const copyBtn = () => {
    const b = addBtn("Copiar link do painel", async () => {
      try { await navigator.clipboard.writeText(location.href); b.textContent = "Link copiado"; }
      catch { prompt("Copie o link:", location.href); }
    });
  };
  if (reason === "off") {
    text.textContent = /Mac/.test(navigator.platform) && !isIOS()
      ? "O navegador diz que o Bluetooth está indisponível. No Mac isso costuma ser falta de permissão: Ajustes do Sistema > Privacidade e Segurança > Bluetooth > ative o seu navegador (Chrome ou Brave), feche e abra o navegador de novo. Você pode tentar conectar mesmo assim."
      : "O navegador diz que o Bluetooth está indisponível. Confira se o Bluetooth está ligado e se o navegador tem permissão. Você pode tentar conectar mesmo assim.";
    addBtn("Recarregar", () => location.reload());
  } else if (isIOS()) {
    text.textContent = "No iPhone, o Safari e o Chrome não conseguem usar Bluetooth em sites (limitação da Apple). Instale o app gratuito Bluefy, abra ele e cole o link do painel.";
    const a = Object.assign(document.createElement("a"), { className: "btn primary", href: BLUEFY_URL, target: "_blank", rel: "noopener", textContent: "Baixar o Bluefy" });
    acts.append(a);
    copyBtn();
  } else if (isAndroid()) {
    text.textContent = "Este navegador não tem Bluetooth para sites. Abra o painel no Google Chrome.";
    const a = Object.assign(document.createElement("a"), {
      className: "btn primary", textContent: "Abrir no Chrome",
      href: `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`,
    });
    acts.append(a);
    copyBtn();
  } else {
    text.textContent = "Este navegador não tem Bluetooth para sites. Use o Google Chrome ou o Microsoft Edge. Você ainda pode importar arquivos .bin.";
    copyBtn();
  }
  log(`bluetooth indisponível (${reason}), ${isIOS() ? "iOS" : isAndroid() ? "Android" : "desktop"}`);
}

// ---------- sessão de validação ----------
const CLS_LABEL = { rest: "Repouso", light: "Leve", vig: "Intenso" };
function lastMark() { return state.marks[state.marks.length - 1]; }
function addMark(id) {
  state.marks.push({ t: Date.now(), s: id });
  saveMarks(state.marks);
  if (navigator.vibrate) navigator.vibrate(30);
  renderValidation();
  if (state.cloudKey) mergeMarks(state.cloudKey, state.marks).catch((e) => log(`nuvem (marcação): ${e.message}`));
}
function renderStateGrid() {
  const g = $("stateGrid");
  g.innerHTML = "";
  for (const st of STATES) {
    const b = document.createElement("button");
    b.type = "button"; b.className = `btn state-btn ${st.cls ?? ""}`; b.textContent = st.label; b.dataset.id = st.id;
    b.addEventListener("click", () => addMark(st.id));
    g.append(b);
  }
}
function renderNow() {
  const m = lastMark(), el = $("valNow");
  document.querySelectorAll(".state-btn").forEach((b) => b.classList.toggle("active", !!m && m.s === b.dataset.id));
  if (!m || m.s === "fim") { el.textContent = "Nenhuma sessão em andamento"; return; }
  const sec = Math.floor((Date.now() - m.t) / 1000);
  el.innerHTML = `Agora: ${stateById[m.s].label}<span class="timer">${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}</span>`;
}
setInterval(renderNow, 1000);

function renderValidation() {
  renderNow();
  const ol = $("valMarks");
  ol.innerHTML = state.marks.slice(-30).map((m) => `<li>${new Date(m.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}: ${m.s === "fim" ? "Encerrado" : stateById[m.s].label}</li>`).join("");
  const box = $("valResult");
  if (!state.marks.length) { box.innerHTML = `<p class="muted small">Nenhuma marcação ainda.</p>`; return; }
  const r = analyze(state.epochs, state.marks, state.settings);
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
    <p class="val-note">Limiares atuais: leve ${state.settings.tLight} mg, intenso ${state.settings.tVig} mg.<br>
    Sugeridos pelos dados: leve ${sug.tLight ?? "-"} mg${sug.balLight ? ` (acerto ${pct(sug.balLight)})` : ""}, intenso ${sug.tVig ?? "-"} mg${sug.balVig ? ` (acerto ${pct(sug.balVig)})` : ""}.</p>
    ${missing.length ? `<p class="val-note">Faltam dados de: ${missing.join(", ")} (mínimo de 5 janelas cada).</p>` : ""}
    ${canApply ? `<button class="btn primary" id="valApply">Aplicar limiares sugeridos</button>` : ""}`;
  $("valApply")?.addEventListener("click", () => {
    if (!confirm(`Trocar os limiares para leve ${sug.tLight} mg e intenso ${sug.tVig} mg? Para validar de verdade, teste esses limiares numa segunda sessão.`)) return;
    state.settings = { ...state.settings, tLight: sug.tLight, tVig: sug.tVig };
    saveSettings(state.settings); fillSettings(); recompute();
  });
}

$("valEnd").addEventListener("click", () => { if (lastMark() && lastMark().s !== "fim") addMark("fim"); });
const pushMarksReplace = () => { if (state.cloudKey) replaceMarks(state.cloudKey, state.marks).catch((e) => log(`nuvem (marcações): ${e.message}`)); };
$("valUndo").addEventListener("click", () => { state.marks.pop(); saveMarks(state.marks); renderValidation(); pushMarksReplace(); });
$("valClear").addEventListener("click", () => {
  if (!confirm("Apagar todas as marcações de validação deste aparelho?")) return;
  state.marks = []; saveMarks(state.marks); renderValidation(); pushMarksReplace();
});
$("valCopy").addEventListener("click", async () => {
  const code = exportMarks(state.marks);
  try { await navigator.clipboard.writeText(code); alert("Marcações copiadas. Cole no painel do outro aparelho em \"Colar marcações\"."); }
  catch { prompt("Copie este código:", code); }
});
$("valPaste").addEventListener("click", () => {
  const txt = prompt("Cole aqui o código das marcações (começa com SIMUT1:)");
  if (!txt) return;
  try {
    const add = importMarks(txt);
    const seen = new Set(state.marks.map((m) => `${Math.round(m.t / 1000)}:${m.s}`));
    for (const m of add) if (!seen.has(`${Math.round(m.t / 1000)}:${m.s}`)) state.marks.push(m);
    state.marks.sort((a, b) => a.t - b.t); saveMarks(state.marks); renderValidation();
    if (state.cloudKey) mergeMarks(state.cloudKey, state.marks).catch((e) => log(`nuvem: ${e.message}`));
    alert(`${add.length} marcações recebidas.`);
  } catch (e) { alert(`Não consegui ler: ${e.message}`); }
});

// ---------- nuvem ----------
function cloudUi(text, ok = null) {
  $("kvCloud").textContent = text;
  $("kvCloud").dataset.ok = ok === null ? "" : String(ok);
  $("cloudOn").hidden = !!state.cloudKey;
  $("cloudOff").hidden = !state.cloudKey;
}
async function cloudSync() {
  if (!state.cloudKey) { cloudUi("Desligada"); return; }
  if (state.cloudBusy) return;
  state.cloudBusy = true;
  cloudUi("Sincronizando...");
  try {
    const r = await syncAll(state.cloudKey, state.syncs, log);
    for (const s of r.down) await saveSync(s);
    state.marks = await mergeMarks(state.cloudKey, state.marks);
    saveMarks(state.marks);
    if (r.down.length) await reload(); else renderValidation();
    cloudUi(`Salva, ${r.total} ${r.total === 1 ? "download" : "downloads"} (${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`, true);
  } catch (e) {
    log(`erro na nuvem: ${e.message}`);
    cloudUi(navigator.onLine ? `Erro: ${e.message}` : "Sem internet, tento de novo depois", false);
  } finally { state.cloudBusy = false; }
}
$("cloudConnect").addEventListener("click", () => {
  const k = $("cloudKeyInput").value.trim();
  if (!/^[A-Za-z0-9_-]{30,}$/.test(k)) { cloudUi(`Chave inválida (${k.length} caracteres). Cole de novo, sem espaços.`, false); return; }
  setKey(k); state.cloudKey = k; $("cloudKeyInput").value = ""; cloudSync();
});
$("cloudLink").addEventListener("click", async () => {
  const link = `${location.origin}${location.pathname}#k=${state.cloudKey}`;
  try { await navigator.clipboard.writeText(link); alert("Link copiado. Abra esse link uma vez no outro aparelho e ele já fica conectado à nuvem. Não compartilhe com outras pessoas."); }
  catch { prompt("Copie o link (não compartilhe):", link); }
});
$("cloudNow").addEventListener("click", () => cloudSync());
$("cloudForget").addEventListener("click", () => {
  if (!confirm("Desconectar este aparelho da nuvem? Os dados continuam na nuvem e neste navegador.")) return;
  forgetKey(); state.cloudKey = null; cloudUi("Desligada");
});
window.addEventListener("online", () => cloudSync());

// Dados antigos (sem animalId) pertencem ao Simut. Só cria o animal; nada é apagado.
function migrate() {
  migrateLastSync();
  const m = migrateLocal({ syncs: state.syncs, marks: state.marks, animals: state.animals, profile: state.profile, hasCloudKey: !!state.cloudKey });
  if (m.changed) { saveAnimals(m.animals); log(`migração: animal ${LEGACY_ANIMAL_ID} criado com ${state.syncs.length} download(s)`); }
  state.animals = m.animals;
}

// ---------- início ----------
(async () => {
  fillSettings();
  renderStateGrid();
  const bt = await bluetoothSupport();
  if (bt !== "ok") showBtHelp(bt);
  log(`painel iniciado (bluetooth: ${bt})`);
  await reload();
  migrate();
  cloudUi(state.cloudKey ? "Conectando..." : "Desligada");
  cloudSync();
})();

window.simut = { state, recompute, hex, showBtHelp };
