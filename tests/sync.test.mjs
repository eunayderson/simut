import { test } from "node:test";
import assert from "node:assert/strict";
import { run, resultText } from "../js/sync.js";

// Sensor falso que registra a ordem das chamadas (mesma interface de PersonoSensor).
function fakeSensor({ name = "Persono-8154CC", clock = new Date(Date.UTC(2026, 10, 14, 12, 0, 0)), packets = 3, failOn = null, connected = false } = {}) {
  const calls = [];
  const s = {
    calls, device: null, _connected: connected,
    get connected() { return this._connected; },
    async connect() { calls.push("connect"); if (failOn === "connect") { const e = new Error("User cancelled"); e.name = "NotFoundError"; throw e; } this.device = { name }; this._connected = true; return name; },
    async readClock() { calls.push("readClock"); return clock; },
    async readInfo() { calls.push("readInfo"); return new Uint8Array([1, 2, 90]); },
    async readStatus() { calls.push("readStatus"); return new Uint8Array([0, 7]); },
    async download({ onProgress }) {
      calls.push("download");
      if (failOn === "download") throw new Error("desconectado");
      onProgress({ packets: 1, bad: 0, expected: packets });
      onProgress({ packets, bad: 1, expected: packets });
      return { packets: Array.from({ length: packets }, (_, i) => new Uint8Array([i, 0, 0, 0, 9, 9, 9, 9, 9])), bad: 1, expected: packets, interrupted: false };
    },
    disconnect() { calls.push("disconnect"); this._connected = false; },
  };
  return s;
}

function clockFn(start = 1_000_000) { let t = start; return () => (t += 100); }

test("run: conecta, lê, baixa, salva com animalId e sensorName, desconecta", async () => {
  const sensor = fakeSensor();
  const saved = [], states = [], progress = [], infos = [], last = [];
  const r = await run({
    animalId: "simut", sensor, now: clockFn(), log: () => {},
    saveSync: async (s) => saved.push(s), setLastSync: (id, t) => last.push([id, t]),
    onState: (st) => states.push(st), onProgress: (p) => progress.push(p), onInfo: (i) => infos.push(i),
  });
  assert.deepEqual(sensor.calls, ["connect", "readClock", "readInfo", "readStatus", "download", "disconnect"]);
  assert.deepEqual(states, ["searching", "syncing", "off"]);
  assert.equal(saved.length, 1);
  const s = saved[0];
  assert.equal(s.source, "bluetooth");
  assert.equal(s.animalId, "simut");
  assert.equal(s.sensorName, "Persono-8154CC");
  assert.equal(s.packets.length, 3);
  assert.deepEqual(s.sensor, { info: "01 02 5a", status: "00 07", clock: Date.UTC(2026, 10, 14, 12, 0, 0) });
  // endAt = relógio do sensor + tempo gasto no download (t0 e fim vêm do mesmo relógio)
  assert.equal(s.endAt, Date.UTC(2026, 10, 14, 12, 0, 0) + 100);
  assert.deepEqual(Object.keys(s).sort(), ["animalId", "endAt", "id", "packets", "sensor", "sensorName", "source"]);
  assert.deepEqual(infos, [{ clock: new Date(Date.UTC(2026, 10, 14, 12, 0, 0)), level: 90 }]);
  assert.equal(progress[0].text, "Lendo o sensor...");
  assert.equal(progress[1].text, "Baixando...");
  assert.equal(progress[2].text, "Baixando: 1 pacotes de ~3");
  assert.equal(progress[3].text, "Baixando: 3 pacotes de ~3, 1 com erro");
  assert.equal(progress.at(-1).pct, 100);
  assert.equal(progress.at(-1).text, "Pronto: 3 pacotes salvos (1 descartados por erro).");
  assert.equal(last.length, 1);
  assert.equal(last[0][0], "simut");
  assert.equal(r.deviceName, "Persono-8154CC");
});

test("run: sem relógio do sensor ancora no relógio do aparelho", async () => {
  const sensor = fakeSensor({ clock: null });
  const saved = [];
  await run({ animalId: "simut", sensor, now: clockFn(5000), log: () => {}, saveSync: async (s) => saved.push(s), setLastSync: () => {} });
  assert.equal(saved[0].sensor.clock, null);
  assert.equal(saved[0].endAt, 5100 + 100);
});

test("run: salva mesmo sem pacotes", async () => {
  const sensor = fakeSensor({ packets: 0 });
  const saved = [];
  const r = await run({ animalId: "simut", sensor, log: () => {}, saveSync: async (s) => saved.push(s), setLastSync: () => {} });
  assert.equal(saved.length, 1);
  assert.equal(r.text, "O sensor não tinha dados novos.");
});

test("run: confirmSensor pode trocar o animal, sem descartar o download", async () => {
  const saved = [];
  let asked = null;
  await run({
    animalId: "a-2", sensor: fakeSensor(), log: () => {}, saveSync: async (s) => saved.push(s), setLastSync: () => {},
    confirmSensor: async (name, id) => { asked = [name, id]; return "simut"; },
  });
  assert.deepEqual(asked, ["Persono-8154CC", "a-2"]);
  assert.equal(saved[0].animalId, "simut");
});

test("run: erro no download desconecta e relança", async () => {
  const sensor = fakeSensor({ failOn: "download" });
  const states = [], logs = [];
  await assert.rejects(run({ animalId: "simut", sensor, log: (m) => logs.push(m), saveSync: async () => assert.fail("não deveria salvar"), onState: (s) => states.push(s) }), /desconectado/);
  assert.equal(sensor.calls.at(-1), "disconnect");
  assert.equal(states.at(-1), "off");
  assert.deepEqual(logs, ["erro na sincronização: desconectado"]);
});

test("run: cancelar a escolha do sensor (NotFoundError) relança sem salvar", async () => {
  const sensor = fakeSensor({ failOn: "connect" });
  await assert.rejects(run({ animalId: "simut", sensor, log: () => {}, saveSync: async () => assert.fail() }), (e) => e.name === "NotFoundError");
});

test("run: já conectado não chama connect de novo", async () => {
  const sensor = fakeSensor({ connected: true });
  sensor.device = { name: "Persono-X" };
  const saved = [];
  await run({ animalId: "simut", sensor, log: () => {}, saveSync: async (s) => saved.push(s), setLastSync: () => {} });
  assert.equal(sensor.calls[0], "readClock");
  assert.equal(saved[0].sensorName, "Persono-X");
});

test("resultText igual ao painel antigo", () => {
  assert.equal(resultText({ packets: [1, 2], bad: 0, interrupted: true }), "Pronto: 2 pacotes salvos. A conexão caiu no meio, salvei o que chegou.");
});
