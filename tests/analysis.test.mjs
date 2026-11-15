import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePayload, buildEpochs, classify, daySummary, nightSummary, trend, dayRuns, dayBouts, toCsv } from "../js/analysis.js";
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
  const ep = epochsFrom(at(10), ["light", "vig"]);
  const t = trend(ep, at(20), SETTINGS);
  assert.equal(t.length, 14);
  assert.equal(t[13].active, 2);
  assert.equal(t[13].vig, 1);
  assert.equal(t[13].covered, 2);
  assert.equal(t[12].covered, 0);
});

test("toCsv mantém o cabeçalho existente", () => {
  const csv = toCsv(epochsFrom(at(10), ["rest"]));
  assert.equal(csv.split("\n")[0], "inicio_iso,inicio_local,mg_medio,classe");
  assert.match(csv.split("\n")[1], /,10\.0,rest$/);
});
