import { test } from "node:test";
import assert from "node:assert/strict";
import { startSession, makeEvent, mergeEvents, record, load, save, summarize, MAX_EVENTS } from "../js/metrics.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// Gera os eventos de uma sessão: steps = etapas vistas e concluídas em sequência.
function session(flow, id, t0, { steps = [1, 2, 3, 4], stepMs = 20000, complete = true, leave = false } = {}) {
  const s = startSession(flow, { sessionId: id });
  const ev = [makeEvent(s, "start", {}, t0)];
  let t = t0;
  for (const k of steps) {
    ev.push(makeEvent(s, "step_view", { step: k }, t));
    t += stepMs;
    if (complete || k !== steps[steps.length - 1]) ev.push(makeEvent(s, "step_done", { step: k }, t));
  }
  if (complete) ev.push(makeEvent(s, "complete", {}, t));
  else if (leave) ev.push(makeEvent(s, "leave", { step: steps[steps.length - 1] }, t + 1000));
  return ev;
}

test("makeEvent numera por sessão e guarda flow, step e sub", () => {
  const s = startSession("completo", { sessionId: "s-1" });
  const a = makeEvent(s, "start", {}, 10);
  const b = makeEvent(s, "step_view", { step: 2, sub: "2c" }, 11);
  assert.deepEqual(a, { id: "s-1-0", sessionId: "s-1", flow: "completo", type: "start", step: null, t: 10 });
  assert.deepEqual(b, { id: "s-1-1", sessionId: "s-1", flow: "completo", type: "step_view", step: 2, sub: "2c", t: 11 });
  assert.throws(() => makeEvent(s, "outro"));
});

test("summarize: sessão concluída", () => {
  const r = summarize(session("completo", "s-a", 1000, { stepMs: 30000 }));
  const f = r.completo;
  assert.equal(f.started, 1);
  assert.equal(f.completed, 1);
  assert.equal(f.abandoned, 0);
  assert.equal(f.completionRate, 1);
  assert.equal(f.timeMedianMs, 120000);
  assert.equal(f.timeP90Ms, 120000);
  assert.equal(f.stepMedianMs[2], 30000);
  assert.deepEqual(f.abandonByStep, {});
});

test("summarize: abandono na etapa 2 (sessão sem leave)", () => {
  const ev = [
    ...session("completo", "s-a", 0),
    ...session("completo", "s-b", 0, { steps: [1, 2], complete: false }),
  ];
  const f = summarize(ev).completo;
  assert.equal(f.started, 2);
  assert.equal(f.completed, 1);
  assert.equal(f.abandoned, 1);
  assert.equal(f.completionRate, 0.5);
  assert.deepEqual(f.abandonByStep, { 2: { count: 1, pct: 0.5 } });
});

test("summarize: abandono com leave conta na última etapa vista", () => {
  const f = summarize(session("completo", "s-c", 0, { steps: [1, 2, 3], complete: false, leave: true })).completo;
  assert.deepEqual(f.abandonByStep, { 3: { count: 1, pct: 1 } });
});

test("summarize: fluxos separados não se misturam", () => {
  const ev = [
    ...session("completo", "s-1", 0, { stepMs: 10000 }),
    ...session("completo", "s-2", 0, { stepMs: 30000 }),
    ...session("completo", "s-3", 0, { stepMs: 50000, steps: [1], complete: false }),
    ...session("legado", "s-4", 0, { steps: [1, 4], stepMs: 5000 }),
  ];
  const r = summarize(ev);
  assert.deepEqual(Object.keys(r).sort(), ["completo", "legado"]);
  assert.equal(r.completo.started, 3);
  assert.equal(r.completo.completed, 2);
  assert.equal(r.completo.timeMedianMs, 80000); // mediana de 40 s e 120 s
  assert.equal(r.completo.timeP90Ms, 112000);
  assert.equal(r.legado.started, 1);
  assert.equal(r.legado.completionRate, 1);
  assert.equal(r.legado.timeMedianMs, 10000);
});

test("summarize: exclude ignora a sessão em andamento", () => {
  const ev = session("adicionar", "s-x", 0, { steps: [2], complete: false });
  assert.deepEqual(summarize(ev, { exclude: "s-x" }), {});
  assert.equal(summarize(ev).adicionar.abandoned, 1);
});

test("summarize: eventos sem start são ignorados e fora de ordem são ordenados", () => {
  const ev = session("completo", "s-o", 0).reverse();
  ev.push({ id: "z-0", sessionId: "z", flow: "completo", type: "step_view", step: 1, t: 5 });
  const f = summarize(ev).completo;
  assert.equal(f.started, 1);
  assert.equal(f.completed, 1);
});

test("mergeEvents: sem repetir id e com limite de 2000", () => {
  const a = session("completo", "s-1", 0);
  assert.equal(mergeEvents(a, a).length, a.length);
  const many = Array.from({ length: MAX_EVENTS + 50 }, (_, i) => ({ id: `e-${i}`, sessionId: "e", flow: "completo", type: "step_view", step: 1, t: i }));
  const m = mergeEvents(many);
  assert.equal(m.length, MAX_EVENTS);
  assert.equal(m[0].id, "e-50");
  assert.equal(m[m.length - 1].id, `e-${MAX_EVENTS + 49}`);
});

test("record e load persistem no storage com limite", () => {
  const st = memStorage();
  const s = startSession("completo", { sessionId: "s-r" });
  record(s, "start", {}, { storage: st, now: 1 });
  record(s, "step_view", { step: 1 }, { storage: st, now: 2 });
  assert.deepEqual(load(st).map((e) => e.id), ["s-r-0", "s-r-1"]);
  save(Array.from({ length: MAX_EVENTS }, (_, i) => ({ id: `o-${i}`, sessionId: "o", flow: "completo", type: "leave", t: i })), st);
  record(s, "complete", {}, { storage: st, now: 999999 });
  const all = load(st);
  assert.equal(all.length, MAX_EVENTS);
  assert.equal(all[all.length - 1].type, "complete");
  assert.deepEqual(load(memStorage()), []);
  const broken = memStorage(); broken.setItem("simut.onboardingEvents", "{");
  assert.deepEqual(load(broken), []);
});
