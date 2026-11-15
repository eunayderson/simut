import { test } from "node:test";
import assert from "node:assert/strict";
import { MockSensor, mockPackets, MOCK_SOURCE } from "../js/mock-sensor.js";
import { crc32 } from "../js/crc32.js";
import { buildEpochs } from "../js/analysis.js";
import { run } from "../js/sync.js";
import { fakeFirestore } from "./fake-firestore.mjs";
import { useBackend, syncAll } from "../js/cloud.js";
import { SETTINGS } from "./helpers.mjs";

test("mockPackets: pacotes com CRC válido que viram janelas na análise", () => {
  const p = mockPackets({ minutes: 5, hz: 32 });
  assert.ok(p.length > 0);
  for (const b of p) {
    const crc = new DataView(b.buffer, b.byteOffset + b.length - 4, 4).getUint32(0, true);
    assert.equal(crc32(b.subarray(0, b.length - 4)), crc);
  }
  const r = buildEpochs([{ id: 1, endAt: Date.now(), packets: p }], SETTINGS);
  assert.equal(r.epochs.length, 5);
  assert.ok(new Set(r.epochs.map((e) => e.cls)).size >= 2);
});

test("MockSensor: mesmo fluxo do sensor real (conecta, lê, baixa, desconecta), sync marcado como simulado", async () => {
  const sensor = new MockSensor(() => {}, { name: "Persono-SIMULADO", minutes: 2, delayMs: 0 });
  const saved = [];
  const r = await run({ animalId: "simut", sensor, log: () => {}, source: MOCK_SOURCE, saveSync: async (s) => saved.push(s), setLastSync: () => {} });
  assert.equal(sensor.connected, false);
  assert.equal(r.deviceName, "Persono-SIMULADO");
  assert.equal(saved[0].source, MOCK_SOURCE);
  assert.ok(saved[0].packets.length > 0);
});

test("nuvem: downloads simulados nunca sobem", async () => {
  const f = fakeFirestore();
  useBackend(f.fs, f.db);
  const key = "chave-ficticia-ok-simulado-0123456789ab";
  const r = await syncAll(key, [{ id: 1, endAt: 1, source: MOCK_SOURCE, packets: [new Uint8Array(9)] }]);
  assert.equal(r.up, 0);
  assert.equal(f.db.writes.length, 0);
});
