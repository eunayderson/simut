import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marksOf, markKey, markAnimal, validationSessions, sessionsCompleted, validationStatus,
  analyze, segments, exportMarks, importMarks,
} from "../js/validation.js";
import { SETTINGS, at, epochsFrom } from "./helpers.mjs";

const rep = (c, n) => Array(n).fill(c);

test("marksOf: marcações sem a são do Simut (legado)", () => {
  const marks = [{ t: 1, s: "deitado" }, { t: 2, s: "andando", a: "simut" }, { t: 3, s: "trotando", a: "a-2" }];
  assert.deepEqual(marksOf(marks, "simut").map((m) => m.t), [1, 2]);
  assert.deepEqual(marksOf(marks, "a-2").map((m) => m.t), [3]);
  assert.deepEqual(marksOf(marks, "a-9"), []);
  assert.equal(markAnimal({ t: 1, s: "x" }), "simut");
});

test("markKey: legado e simut explícito colidem; animais diferentes não", () => {
  assert.equal(markKey({ t: 1000, s: "deitado" }), markKey({ t: 1200, s: "deitado", a: "simut" }));
  assert.notEqual(markKey({ t: 1000, s: "deitado", a: "a-2" }), markKey({ t: 1000, s: "deitado" }));
});

test("export/import SIMUT1 continua igual (sem animal no código)", () => {
  const code = exportMarks([{ t: 1_700_000_000_000, s: "deitado", a: "a-2" }, { t: 1_700_000_060_000, s: "fim" }]);
  assert.equal(code, `SIMUT1:${(1_700_000_000).toString(36)}.deitado,${(1_700_000_060).toString(36)}.fim`);
  assert.deepEqual(importMarks(code), [{ t: 1_700_000_000_000, s: "deitado" }, { t: 1_700_000_060_000, s: "fim" }]);
});

test("validationSessions: sessão concluída precisa de fim e 5 janelas comparadas", () => {
  // 10 min deitado (repouso) e 10 min andando (leve), sensor concorda
  const epochs = epochsFrom(at(10), [...rep("rest", 10), ...rep("light", 10)]);
  const marks = [{ t: at(10), s: "deitado" }, { t: at(10, 10), s: "andando" }, { t: at(10, 20), s: "fim" }];
  const list = validationSessions(marks, epochs, SETTINGS);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, at(10));
  assert.equal(list[0].end, at(10, 20));
  assert.ok(list[0].n >= 5);
  assert.equal(list[0].accuracy, 1);
  assert.equal(sessionsCompleted(marks, epochs, SETTINGS), 1);
});

test("validationSessions: sem fim, sem dados ou com poucas janelas não conta", () => {
  const epochs = epochsFrom(at(10), rep("rest", 20));
  assert.equal(sessionsCompleted([{ t: at(10), s: "deitado" }], epochs, SETTINGS), 0);
  assert.equal(sessionsCompleted([{ t: at(15), s: "deitado" }, { t: at(15, 20), s: "fim" }], epochs, SETTINGS), 0);
  assert.equal(sessionsCompleted([{ t: at(10), s: "deitado" }, { t: at(10, 4), s: "fim" }], epochs, SETTINGS), 0);
  assert.equal(sessionsCompleted([{ t: at(10), s: "fim" }], epochs, SETTINGS), 0);
});

test("validationStatus: validado só com 2 sessões e kappa >= 0,6 na mais recente", () => {
  const epochs = [
    ...epochsFrom(at(10), [...rep("rest", 10), ...rep("light", 10)]),
    ...epochsFrom(at(14), [...rep("rest", 10), ...rep("light", 10)]),
  ];
  const s1 = [{ t: at(10), s: "deitado" }, { t: at(10, 10), s: "andando" }, { t: at(10, 20), s: "fim" }];
  const s2 = [{ t: at(14), s: "deitado" }, { t: at(14, 10), s: "andando" }, { t: at(14, 20), s: "fim" }];
  const one = validationStatus(s1, epochs, SETTINGS);
  assert.equal(one.completed, 1);
  assert.equal(one.validated, false);
  const two = validationStatus([...s1, ...s2], epochs, SETTINGS);
  assert.equal(two.completed, 2);
  assert.equal(two.validated, true);
  assert.equal(two.lastKappa, 1);
  // segunda sessão discordante: sensor diz repouso quando andava
  const bad = [...epochsFrom(at(10), [...rep("rest", 10), ...rep("light", 10)]), ...epochsFrom(at(14), rep("rest", 20))];
  const st = validationStatus([...s1, ...s2], bad, SETTINGS);
  assert.equal(st.completed, 2);
  assert.equal(st.validated, false);
});

test("filtro legado: sessões de outro animal não contam para o Simut", () => {
  const epochs = epochsFrom(at(10), [...rep("rest", 10), ...rep("light", 10)]);
  const marks = [{ t: at(10), s: "deitado", a: "a-2" }, { t: at(10, 10), s: "andando", a: "a-2" }, { t: at(10, 20), s: "fim", a: "a-2" }];
  assert.equal(sessionsCompleted(marksOf(marks, "simut"), epochs, SETTINGS), 0);
  assert.equal(sessionsCompleted(marksOf(marks, "a-2"), epochs, SETTINGS), 1);
});

test("analyze e segments seguem funcionando com o campo a", () => {
  const epochs = epochsFrom(at(10), rep("rest", 10));
  const marks = [{ t: at(10), s: "deitado", a: "simut" }, { t: at(10, 10), s: "fim", a: "simut" }];
  assert.equal(segments(marks).length, 1);
  assert.ok(analyze(epochs, marks, SETTINGS).n > 0);
});
