// Validação: marcações ao vivo dos estados do animal e comparação com o sensor.

import { LEGACY_ANIMAL_ID } from "./animals.js?v=10";

export const STATES = [
  { id: "deitado", label: "Deitado", cls: "rest" },
  { id: "parado", label: "Parado em pé", cls: "rest" },
  { id: "andando", label: "Andando", cls: "light" },
  { id: "trotando", label: "Trotando", cls: "vig" },
  { id: "brincando", label: "Brincando", cls: "vig" },
  { id: "pausa", label: "Pausa", cls: null },
];
export const stateById = Object.fromEntries(STATES.map((s) => [s.id, s]));
const KEY = "simut.marks";

// marca: { t: ms, s: id do estado | "fim", a?: animalId (ausente = Simut) }
export function loadMarks() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveMarks(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* modo privado */ }
}

// Código curto para levar as marcações de um aparelho para outro.
export const exportMarks = (m) => "SIMUT1:" + m.map((x) => `${Math.round(x.t / 1000).toString(36)}.${x.s}`).join(",");
export function importMarks(text) {
  const s = text.trim();
  if (!s.startsWith("SIMUT1:")) throw new Error("código inválido");
  return s.slice(7).split(",").filter(Boolean).map((p) => {
    const [t, st] = p.split(".");
    if (st !== "fim" && !stateById[st]) throw new Error(`estado desconhecido: ${st}`);
    return { t: parseInt(t, 36) * 1000, s: st };
  });
}

// Converte marcações em trechos [início, fim) com classe esperada.
export function segments(marks, maxOpenMs = 20 * 60000) {
  const sorted = [...marks].sort((a, b) => a.t - b.t);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.s === "fim") continue;
    const end = sorted[i + 1] ? sorted[i + 1].t : Math.min(Date.now(), m.t + maxOpenMs);
    out.push({ start: m.t, end, state: m.s, cls: stateById[m.s]?.cls ?? null });
  }
  return out;
}

const CLASSES = ["rest", "light", "vig"];
const quant = (arr, q) => {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y), i = (a.length - 1) * q, lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
};

// Melhor corte entre dois grupos (maior acurácia balanceada).
function bestCut(low, high) {
  if (!low.length || !high.length) return null;
  const cands = [...new Set([...low, ...high])].sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < cands.length - 1; i++) {
    const c = (cands[i] + cands[i + 1]) / 2;
    const bal = (low.filter((v) => v < c).length / low.length + high.filter((v) => v >= c).length / high.length) / 2;
    if (!best || bal > best.bal) best = { cut: c, bal };
  }
  return best;
}

export function analyze(epochs, marks, s, edgeMs = 30000) {
  const len = s.epoch * 1000;
  const segs = segments(marks).filter((g) => g.cls);
  const rows = [];
  const perState = {};
  for (const g of segs) {
    const from = g.start + edgeMs, to = g.end - edgeMs;
    for (const e of epochs) {
      if (e.t >= from && e.t + len <= to) {
        rows.push({ truth: g.cls, pred: e.cls, mg: e.mg });
        (perState[g.state] ||= []).push(e.mg);
      }
    }
  }
  const byCls = Object.fromEntries(CLASSES.map((c) => [c, rows.filter((r) => r.truth === c).map((r) => r.mg)]));
  const confusion = Object.fromEntries(CLASSES.map((t) => [t, Object.fromEntries(CLASSES.map((p) => [p, 0]))]));
  for (const r of rows) confusion[r.truth][r.pred]++;
  const n = rows.length;
  const agree = rows.filter((r) => r.truth === r.pred).length;
  let pe = 0;
  for (const c of CLASSES) pe += (rows.filter((r) => r.truth === c).length / (n || 1)) * (rows.filter((r) => r.pred === c).length / (n || 1));
  const po = n ? agree / n : NaN;
  const kappa = n && pe < 1 ? (po - pe) / (1 - pe) : NaN;
  const cutLight = bestCut(byCls.rest, [...byCls.light, ...byCls.vig]);
  const cutVig = bestCut(byCls.light, byCls.vig);
  const stats = Object.fromEntries(Object.entries(perState).map(([k, v]) => [k, { n: v.length, med: quant(v, 0.5), p10: quant(v, 0.1), p90: quant(v, 0.9) }]));
  return {
    n, accuracy: po, kappa, confusion, stats, segs: segs.length,
    counts: Object.fromEntries(CLASSES.map((c) => [c, byCls[c].length])),
    suggest: { tLight: cutLight ? Math.round(cutLight.cut) : null, tVig: cutVig ? Math.round(cutVig.cut) : null, balLight: cutLight?.bal, balVig: cutVig?.bal },
  };
}

// ---------- por animal ----------
export const markAnimal = (m) => m.a ?? LEGACY_ANIMAL_ID;
export const marksOf = (marks, animalId) => marks.filter((m) => markAnimal(m) === animalId);
// Chave de deduplicação: segundo, estado e animal (ausente conta como Simut).
export const markKey = (m) => `${Math.round(m.t / 1000)}:${m.s}:${markAnimal(m)}`;

// Sessões de validação concluídas: cada marcação "fim" fecha uma sessão (as marcações
// desde o "fim" anterior). Conta como concluída se comparou pelo menos minWindows janelas.
// marks e epochs devem ser do mesmo animal.
export function validationSessions(marks, epochs, s, minWindows = 5) {
  const sorted = [...marks].sort((a, b) => a.t - b.t);
  const out = [];
  let group = [];
  for (const m of sorted) {
    group.push(m);
    if (m.s !== "fim") continue;
    if (group.length > 1) {
      const r = analyze(epochs, group, s);
      if (r.n >= minWindows) out.push({ start: group[0].t, end: m.t, n: r.n, kappa: r.kappa, accuracy: r.accuracy });
    }
    group = [];
  }
  return out;
}

export const sessionsCompleted = (marks, epochs, s, minWindows = 5) => validationSessions(marks, epochs, s, minWindows).length;

// "Validado" só com 2 sessões concluídas e kappa a partir de 0,6 na mais recente (que testa os limiares aplicados).
export function validationStatus(marks, epochs, s, { needed = 2, minKappa = 0.6 } = {}) {
  const list = validationSessions(marks, epochs, s);
  const last = list[list.length - 1] || null;
  const validated = list.length >= needed && Number.isFinite(last?.kappa) && last.kappa >= minKappa;
  return { completed: list.length, needed, validated, lastKappa: last ? last.kappa : null, sessions: list };
}
