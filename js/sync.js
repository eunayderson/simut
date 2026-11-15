// Fluxo "conectar, ler, baixar, salvar, desconectar" (um toque só).
// Ficar conectado gasta bateria do sensor, por isso desconecta sempre no fim.
// Usa ble.js sem mudar nada do protocolo.

import { PersonoSensor, hex } from "./ble.js?v=10";
import { saveSync as storeSaveSync, setLastSync as storeSetLastSync } from "./store.js?v=10";
import { log as defaultLog } from "./log.js?v=10";

let shared = null;
// Sensor compartilhado pelo app (uma conexão por vez).
export function getSensor(log = defaultLog) {
  if (!shared) shared = new PersonoSensor(log);
  return shared;
}

// Lê relógio, info (comando 05) e status. Nunca lança: erro vira { clock: null }.
export async function readSensorInfo(sensor, log = defaultLog) {
  try {
    const clock = await sensor.readClock();
    const info = await sensor.readInfo();
    const status = await sensor.readStatus();
    return { clock, info: info ? hex(info) : null, status: status ? hex(status) : null, level: info?.length ? info[info.length - 1] : null };
  } catch (e) { log(`erro lendo info: ${e.message}`); return { clock: null }; }
}

// Texto final mostrado depois do download (igual ao painel antigo).
export function resultText(res) {
  return res.packets.length
    ? `Pronto: ${res.packets.length} pacotes salvos${res.bad ? ` (${res.bad} descartados por erro)` : ""}${res.interrupted ? ". A conexão caiu no meio, salvei o que chegou." : "."}`
    : "O sensor não tinha dados novos.";
}

// run({ animalId, onProgress({pct, text}), onState(state, text), onInfo({clock, level}), confirmSensor(name, animalId) })
// state: "searching" | "syncing" | "off"
// confirmSensor pode devolver outro animalId (sensor associado a outro animal); o download nunca é descartado.
// Devolve { sync, packets, bad, expected, interrupted, deviceName, animalId, text }. Lança em erro (depois de desconectar).
export async function run({
  animalId, onProgress = () => {}, onState = () => {}, onInfo = () => {}, confirmSensor = null,
  sensor = getSensor(), log = defaultLog, saveSync = storeSaveSync, setLastSync = storeSetLastSync, now = () => Date.now(),
} = {}) {
  try {
    onState("searching", "Procurando sensor...");
    if (!sensor.connected) await sensor.connect();
    const deviceName = sensor.device?.name || null;
    onState("syncing", "Sincronizando...");
    onProgress({ pct: 0, text: "Lendo o sensor..." });
    const snap = await readSensorInfo(sensor, log);
    onInfo({ clock: snap.clock, level: snap.level ?? null });
    const clockBefore = snap.clock;
    const t0 = now();
    onProgress({ pct: 0, text: "Baixando..." });
    const res = await sensor.download({
      onProgress: ({ packets, bad, expected }) => {
        onProgress({
          pct: expected ? Math.min(100, (packets / expected) * 100) : null,
          text: `Baixando: ${packets} pacotes${expected ? ` de ~${expected}` : ""}${bad ? `, ${bad} com erro` : ""}`,
        });
      },
    });
    const endAt = (clockBefore ? clockBefore.getTime() : t0) + (now() - t0);
    let target = animalId;
    if (confirmSensor && deviceName) {
      try { target = (await confirmSensor(deviceName, animalId)) || animalId; }
      catch (e) { log(`associação do sensor: ${e.message}`); target = animalId; }
    }
    // salva mesmo sem pacotes: o registro do nível ao longo do tempo também é dado
    const sync = { id: now(), endAt, source: "bluetooth", packets: res.packets,
      sensor: { info: snap.info, status: snap.status, clock: clockBefore ? clockBefore.getTime() : null } };
    if (target) sync.animalId = target;
    if (deviceName) sync.sensorName = deviceName;
    await saveSync(sync);
    const text = resultText(res);
    onProgress({ pct: 100, text });
    if (target) setLastSync(target, now());
    return { sync, packets: res.packets, bad: res.bad, expected: res.expected, interrupted: res.interrupted, deviceName, animalId: target, text };
  } catch (e) {
    log(`erro na sincronização: ${e.message}`);
    throw e;
  } finally {
    sensor.disconnect();
    onState("off", "Sensor desconectado (economizando bateria)");
  }
}
