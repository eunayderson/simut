import { PersonoSensor, bluetoothSupport, hex } from "./ble.js";
import { saveSync, loadSyncs, clearAll, loadSettings, saveSettings } from "./store.js";
import { buildEpochs, daySummary, nightSummary, trend, toCsv } from "./analysis.js";

const $ = (id) => document.getElementById(id);
const state = { settings: loadSettings(), syncs: [], epochs: [], samples: 0, day: Date.now() };

// ---------- log ----------
const logLines = [];
function log(msg) {
  const line = `${new Date().toLocaleTimeString("pt-BR")}  ${msg}`;
  logLines.push(line);
  if (logLines.length > 400) logLines.shift();
  $("log").textContent = logLines.join("\n");
}

// ---------- sensor ----------
const sensor = new PersonoSensor(log);

function setPill(stateName, text) {
  $("sensorPill").dataset.state = stateName;
  $("sensorPillText").textContent = text;
}
function setConnectedUi(on) {
  $("btnConnect").disabled = on;
  $("btnSync").disabled = !on;
  $("btnDisconnect").disabled = !on;
  setPill(on ? "on" : "off", on ? "Sensor conectado" : "Sensor desconectado");
}
sensor.addEventListener("disconnect", () => setConnectedUi(false));

async function refreshSensorInfo() {
  try {
    const clock = await sensor.readClock();
    $("kvClock").textContent = clock ? clock.toLocaleString("pt-BR") : "-";
    const info = await sensor.readInfo();
    if (info?.length) $("kvLevel").textContent = `${info[info.length - 1]}`;
    return clock;
  } catch (e) { log(`erro lendo info: ${e.message}`); return null; }
}

$("btnConnect").addEventListener("click", async () => {
  try {
    setPill("busy", "Procurando sensor...");
    await sensor.connect();
    setConnectedUi(true);
    await refreshSensorInfo();
  } catch (e) {
    log(`falha ao conectar: ${e.message}`);
    setConnectedUi(false);
    if (e.name !== "NotFoundError") alert(`Não consegui conectar: ${e.message}`);
  }
});

$("btnDisconnect").addEventListener("click", () => sensor.disconnect());

$("btnSync").addEventListener("click", async () => {
  $("btnSync").disabled = true;
  setPill("busy", "Baixando dados...");
  $("progressWrap").hidden = false;
  const bar = $("progressBar"), txt = $("progressText");
  bar.style.width = "0%"; txt.textContent = "Iniciando...";
  try {
    const clockBefore = await refreshSensorInfo();
    const t0 = Date.now();
    const res = await sensor.download({
      onProgress: ({ packets, bad, expected }) => {
        if (expected) bar.style.width = `${Math.min(100, (packets / expected) * 100)}%`;
        txt.textContent = `${packets} pacotes${expected ? ` de ~${expected}` : ""}${bad ? `, ${bad} com erro` : ""}`;
      },
    });
    const endAt = (clockBefore ? clockBefore.getTime() : t0) + (Date.now() - t0);
    if (res.packets.length) {
      await saveSync({ id: Date.now(), endAt, source: "bluetooth", packets: res.packets });
    }
    bar.style.width = "100%";
    txt.textContent = `${res.packets.length} pacotes salvos${res.bad ? `, ${res.bad} descartados por erro` : ""}${res.interrupted ? ". A conexão caiu no meio, salvei o que chegou." : "."}`;
    try { localStorage.setItem("simut.lastSync", String(Date.now())); } catch { /* ignore */ }
    await reload();
  } catch (e) {
    log(`erro no download: ${e.message}`);
    txt.textContent = `Erro: ${e.message}`;
  } finally {
    setConnectedUi(sensor.connected);
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
  await saveSync({ id: Date.now(), endAt, source: `arquivo ${f.name}`, packets });
  log(`importado ${f.name}: ${packets.length} pacotes`);
  ev.target.value = "";
  await reload();
});

$("btnClear").addEventListener("click", async () => {
  if (!confirm("Apagar todos os dados do Simut guardados neste navegador? Isso não tem volta.")) return;
  await clearAll();
  try { localStorage.removeItem("simut.lastSync"); } catch { /* ignore */ }
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
const fmtMin = (m) => {
  if (!m) return "0 min";
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h}h${r ? ` ${String(r).padStart(2, "0")}` : ""}` : `${r} min`;
};

function renderHourChart(hours) {
  const el = $("hourChart");
  if (!hours.some((h) => h.rest + h.light + h.vig > 0)) {
    el.innerHTML = `<div class="empty">Sem dados neste dia. Conecte o sensor e baixe os dados.</div>`;
    return;
  }
  const W = 480, H = 170, pad = 22, bw = (W - pad) / 24;
  let bars = "";
  hours.forEach((h, i) => {
    let y = H - 18;
    for (const k of ["rest", "light", "vig"]) {
      const v = h[k]; if (!v) continue;
      const hh = (v / 60) * (H - 30);
      y -= hh;
      bars += `<rect x="${pad + i * bw + 1.5}" y="${y.toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${hh.toFixed(1)}" rx="2" fill="var(--${k})"><title>${i}h: ${fmtMin(v)} ${k === "rest" ? "repouso" : k === "light" ? "leve" : "intenso"}</title></rect>`;
    }
  });
  let axis = "";
  for (const i of [0, 6, 12, 18, 23]) axis += `<text x="${pad + i * bw + bw / 2}" y="${H - 4}" font-size="10" text-anchor="middle" fill="var(--muted)">${i}h</text>`;
  axis += `<text x="0" y="16" font-size="10" fill="var(--muted)">60m</text><line x1="${pad}" x2="${W}" y1="${12}" y2="${12}" stroke="var(--line)" stroke-dasharray="3 3"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${axis}${bars}</svg>`;
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
  renderHourChart(day.hours);

  const n = nightSummary(state.epochs, state.day, s);
  $("ntRest").textContent = n ? `${Math.round((n.restMin / n.coveredMin) * 100)}%` : "-";
  $("ntWakes").textContent = n ? String(n.wakes) : "-";
  $("ntLongest").textContent = n ? fmtMin(n.longestMin) : "-";

  renderTrend(trend(state.epochs, Date.now(), s));

  $("kvPackets").textContent = state.syncs.reduce((a, x) => a + x.packets.length, 0).toLocaleString("pt-BR");
  $("kvSamples").textContent = state.samples.toLocaleString("pt-BR");
  let last = null; try { last = localStorage.getItem("simut.lastSync"); } catch { /* ignore */ }
  $("lastSync").textContent = last ? `Último download: ${new Date(Number(last)).toLocaleString("pt-BR")}` : "Nunca sincronizado";
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

// ---------- início ----------
(async () => {
  fillSettings();
  const bt = await bluetoothSupport();
  if (bt !== "ok") showBtHelp(bt);
  log(`painel iniciado (bluetooth: ${bt})`);
  await reload();
})();

window.simut = { state, recompute, hex, showBtHelp };
