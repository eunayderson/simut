// Eventos e métricas do onboarding (plano, seção 8). Núcleo puro, testado em tests/metrics.test.mjs.
//
// Evento: { id: "<sessionId>-<n>", sessionId, flow, type, step, sub?, t }
//   flow: "completo" | "legado" | "adicionar"
//   type: "start" | "step_view" | "step_done" | "complete" | "leave"
// Sessão com "start" e sem "complete" conta como abandono na última etapa vista.

export const MAX_EVENTS = 2000;
export const FLOWS = ["completo", "legado", "adicionar"];
export const TYPES = ["start", "step_view", "step_done", "complete", "leave"];
const KEY = "simut.onboardingEvents";

export function newSessionId(now = Date.now(), rand = Math.random) {
  let tail = "";
  for (let i = 0; i < 4; i++) tail += Math.floor(rand() * 36).toString(36);
  return `s-${now.toString(36)}-${tail}`;
}

// Sessão em memória: guarda o contador de eventos. Retomável a partir do rascunho.
export function startSession(flow, { now = Date.now(), rand = Math.random, sessionId = null, n = 0 } = {}) {
  return { sessionId: sessionId || newSessionId(now, rand), flow, n };
}

export function makeEvent(session, type, { step = null, sub = null } = {}, t = Date.now()) {
  if (!TYPES.includes(type)) throw new Error(`tipo de evento desconhecido: ${type}`);
  const ev = { id: `${session.sessionId}-${session.n}`, sessionId: session.sessionId, flow: session.flow, type, step, t };
  if (sub !== null && sub !== undefined) ev.sub = sub;
  session.n += 1;
  return ev;
}

// Junta listas sem repetir id, em ordem de tempo, mantendo só os últimos MAX_EVENTS.
export function mergeEvents(...lists) {
  const byId = new Map();
  for (const list of lists) for (const e of list || []) if (e && e.id && !byId.has(e.id)) byId.set(e.id, e);
  const all = [...byId.values()].sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)));
  return all.length > MAX_EVENTS ? all.slice(all.length - MAX_EVENTS) : all;
}

// Persistência (storage injetável para teste; padrão localStorage).
export function load(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
export function save(events, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(events)); } catch { /* modo privado */ }
}

// Cria, guarda e devolve o evento.
export function record(session, type, extra = {}, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  const ev = makeEvent(session, type, extra, now);
  save(mergeEvents(load(storage), [ev]), storage);
  return ev;
}

const median = (arr) => quantile(arr, 0.5);
function quantile(arr, q) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

// Resumo por fluxo. exclude: sessionId em andamento (não conta como abandono).
// Devolve { [flow]: { started, completed, completionRate, timeMedianMs, timeP90Ms,
//   abandoned, abandonByStep: { [step]: { count, pct } }, stepMedianMs: { [step]: ms } } }
export function summarize(events, { exclude = null } = {}) {
  const sessions = new Map();
  for (const e of [...(events || [])].sort((a, b) => a.t - b.t)) {
    if (!e?.sessionId || e.sessionId === exclude) continue;
    let s = sessions.get(e.sessionId);
    if (!s) { s = { flow: e.flow, start: null, complete: null, lastView: null, views: {}, dones: {} }; sessions.set(e.sessionId, s); }
    if (e.type === "start" && s.start === null) s.start = e.t;
    else if (e.type === "complete" && s.complete === null) s.complete = e.t;
    else if (e.type === "step_view") {
      s.lastView = e.step;
      if (s.views[e.step] === undefined) s.views[e.step] = e.t;
    } else if (e.type === "step_done" && s.dones[e.step] === undefined) s.dones[e.step] = e.t;
  }

  const out = {};
  for (const s of sessions.values()) {
    if (s.start === null) continue; // sem início não é sessão válida
    const f = (out[s.flow] ||= { started: 0, completed: 0, abandoned: 0, completionRate: null, timeMedianMs: null, timeP90Ms: null, abandonByStep: {}, stepMedianMs: {}, _times: [], _steps: {} });
    f.started++;
    if (s.complete !== null) {
      f.completed++;
      f._times.push(s.complete - s.start);
    } else {
      f.abandoned++;
      const k = s.lastView ?? "inicio";
      (f.abandonByStep[k] ||= { count: 0, pct: 0 }).count++;
    }
    for (const [step, tv] of Object.entries(s.views)) {
      const td = s.dones[step];
      if (td !== undefined && td >= tv) (f._steps[step] ||= []).push(td - tv);
    }
  }
  for (const f of Object.values(out)) {
    f.completionRate = f.started ? f.completed / f.started : null;
    f.timeMedianMs = median(f._times);
    f.timeP90Ms = quantile(f._times, 0.9);
    for (const v of Object.values(f.abandonByStep)) v.pct = f.started ? v.count / f.started : 0;
    for (const [step, arr] of Object.entries(f._steps)) f.stepMedianMs[step] = median(arr);
    delete f._times; delete f._steps;
  }
  return out;
}
