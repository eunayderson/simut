import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePayload, buildEpochs, classify, daySummary, nightSummary, trend, dayRuns, dayBouts, toCsv, actogramRows, profile24 } from "../js/analysis.js";
import { makePackets, samplesFor, SETTINGS, at, epochsFrom } from "./helpers.mjs";

test("decodePayload pula marcadores e lê x, y, z em int8", () => {
  const p = new Uint8Array([0x00, 0x00, 0x40, 0x45, 0x00, 0x78, 1, 2, 0x38, 9, 9, 9, 0x32, 0xff, 0x01, 0x40]);
  assert.deepEqual(decodePayload(p), [0, 0, 64, -1, 1, 64]);
});

test("classify usa os limiares", () => {
  assert.equal(classify(10, SETTINGS), "rest");
  assert.equal(classify(40, SETTINGS), "light");
  assert.equal(classify(250, SETTINGS), "vig");
});

test("buildEpochs ancora no fim do download e conta para trás", () => {
  const endAt = at(10, 3);
  const packets = makePackets(samplesFor(["rest", "light", "vig"]));
  const { epochs, totalSamples } = buildEpochs([{ id: 1, endAt, packets }], SETTINGS);
  assert.equal(totalSamples, 3 * 32 * 60);
  assert.equal(epochs.length, 3);
  assert.deepEqual(epochs.map((e) => e.cls), ["rest", "light", "vig"]);
  assert.equal(epochs[0].t, at(10, 0));
  assert.equal(epochs[2].t, at(10, 2));
  assert.ok(epochs[0].mg < 1);
  assert.ok(Math.abs(epochs[1].mg - 118) < 1);
});

test("buildEpochs ignora pacotes repetidos entre downloads", () => {
  const packets = makePackets(samplesFor(["light", "light"]));
  const a = buildEpochs([{ id: 1, endAt: at(9), packets }], SETTINGS);
  const b = buildEpochs([{ id: 1, endAt: at(9), packets }, { id: 2, endAt: at(12), packets: packets.map((p) => p.slice()) }], SETTINGS);
  assert.equal(b.epochs.length, a.epochs.length);
  assert.equal(b.totalSamples, a.totalSamples);
});

test("buildEpochs descarta janela com menos da metade das amostras", () => {
  const samples = samplesFor(["rest"]).concat(samplesFor(["rest"]).slice(0, 500));
  const { epochs } = buildEpochs([{ id: 1, endAt: at(8), packets: makePackets(samples) }], SETTINGS);
  assert.equal(epochs.length, 1);
});

test("daySummary soma minutos por classe e cobertura", () => {
  const ep = epochsFrom(at(10), ["rest", "rest", "light", "vig"]);
  const d = daySummary(ep, at(15), SETTINGS);
  assert.deepEqual(d.tot, { rest: 2, light: 1, vig: 1 });
  assert.equal(d.coveredMin, 4);
  assert.equal(d.hours[10].rest, 2);
});

test("dayRuns junta janelas contíguas da mesma classe", () => {
  const ep = epochsFrom(at(10), ["rest", "rest", "light", "light", "rest"]);
  const runs = dayRuns(ep, at(10), SETTINGS);
  assert.deepEqual(runs.map((r) => [r.cls, (r.to - r.from) / 60000]), [["rest", 2], ["light", 2], ["rest", 1]]);
});

test("dayBouts mantém momentos ativos de 2 min ou mais", () => {
  const ep = epochsFrom(at(10), ["light", "light", "vig", "rest", "rest", "rest", "light", "rest"]);
  const b = dayBouts(ep, at(10), SETTINGS);
  assert.equal(b.length, 1);
  assert.equal(b[0].start, at(10));
  assert.equal(b[0].end, at(10, 3));
});

test("nightSummary: 22h às 6h, null sem dados", () => {
  assert.equal(nightSummary([], at(12), SETTINGS), null);
  const ep = epochsFrom(at(23, 0, 13), ["rest", "rest", "light", "rest", "rest", "rest"]);
  const n = nightSummary(ep, at(12), SETTINGS);
  assert.equal(n.restMin, 5);
  assert.equal(n.coveredMin, 6);
  assert.equal(n.wakes, 1);
  assert.equal(n.longestMin, 3);
});

test("trend devolve um item por dia, hoje por último", () => {
  const ep = epochsFrom(at(10), ["light", "vig", "rest"]);
  const t = trend(ep, at(20), SETTINGS);
  assert.equal(t.length, 14);
  assert.deepEqual(t[13], { day: at(0), active: 2, vig: 1, light: 1, rest: 1, covered: 3 });
  assert.equal(t[12].day, at(0, 0, 13));
  assert.equal(t[0].day, at(0, 0, 1));
});

test("trend: dia sem janelas tem covered 0 e nunca zeros de classe", () => {
  const t = trend(epochsFrom(at(10), ["light"]), at(20), SETTINGS, 7);
  assert.equal(t.length, 7);
  assert.deepEqual(t[5], { day: at(0, 0, 13), active: null, vig: null, light: null, rest: null, covered: 0 });
  assert.deepEqual(trend([], at(20), SETTINGS, 3).map((r) => [r.covered, r.active]), [[0, null], [0, null], [0, null]]);
});

test("trend: dia só com repouso tem active 0 (medido), diferente de sem dados", () => {
  const t = trend(epochsFrom(at(10), ["rest", "rest"]), at(20), SETTINGS, 2);
  assert.equal(t[1].active, 0);
  assert.equal(t[1].covered, 2);
  assert.equal(t[0].active, null);
});

test("dayRuns traz mg médio e número de janelas por trecho", () => {
  const ep = [{ t: at(10), mg: 80, cls: "light" }, { t: at(10, 1), mg: 120, cls: "light" }, { t: at(10, 2), mg: 5, cls: "rest" }];
  const runs = dayRuns(ep, at(10), SETTINGS);
  assert.equal(runs[0].mg, 100);
  assert.equal(runs[0].n, 2);
  assert.equal(runs[1].n, 1);
});

test("actogramRows: uma linha por dia, a mais antiga primeiro, sem dados = covered 0 e tot null", () => {
  const ep = [...epochsFrom(at(8, 0, 12), ["rest", "light"]), ...epochsFrom(at(22, 0, 14), ["vig", "vig", "rest"])];
  const rows = actogramRows(ep, at(23, 0, 14), SETTINGS, 4);
  assert.deepEqual(rows.map((r) => r.day), [at(0, 0, 11), at(0, 0, 12), at(0, 0, 13), at(0, 0, 14)]);
  assert.deepEqual(rows.map((r) => r.covered), [0, 2, 0, 3]);
  assert.equal(rows[0].tot, null);
  assert.deepEqual(rows[0].runs, []);
  assert.equal(rows[2].tot, null);
  assert.deepEqual(rows[3].tot, { rest: 1, light: 0, vig: 2 });
  assert.deepEqual(rows[3].runs.map((r) => r.cls), ["vig", "rest"]);
  assert.equal(actogramRows([], at(12), SETTINGS).length, 7);
});

test("profile24: média por faixa de 30 min, n por faixa e null nas faixas vazias", () => {
  const ep = [
    { t: at(10, 0, 13), mg: 100, cls: "light" },
    { t: at(10, 10, 13), mg: 200, cls: "light" },
    { t: at(10, 5, 14), mg: 300, cls: "vig" },
    { t: at(23, 59, 14), mg: 10, cls: "rest" },
  ];
  const bins = profile24(ep, { binMin: 30 });
  assert.equal(bins.length, 48);
  assert.deepEqual(bins[20], { start: 600, end: 630, mg: 200, n: 3, days: 2 });
  assert.equal(bins[47].mg, 10);
  assert.equal(bins[47].n, 1);
  assert.equal(bins[0].mg, null);
  assert.equal(bins[0].n, 0);
  assert.equal(bins[0].days, 0);
  assert.equal(bins.filter((b) => b.mg === null).length, 46);
});

test("profile24: respeita o período [from, to) e o tamanho da faixa", () => {
  const ep = [{ t: at(10, 0, 13), mg: 100, cls: "light" }, { t: at(10, 0, 14), mg: 300, cls: "vig" }];
  const only14 = profile24(ep, { from: at(0, 0, 14), to: at(0, 0, 15), binMin: 60 });
  assert.equal(only14.length, 24);
  assert.equal(only14[10].mg, 300);
  assert.equal(only14[10].n, 1);
  assert.ok(profile24([], {}).every((b) => b.mg === null && b.n === 0));
});

test("toCsv mantém o cabeçalho existente", () => {
  const csv = toCsv(epochsFrom(at(10), ["rest"]));
  assert.equal(csv.split("\n")[0], "inicio_iso,inicio_local,mg_medio,classe");
  assert.match(csv.split("\n")[1], /,10\.0,rest$/);
});
