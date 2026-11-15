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

// Erro do Bluetooth em frase curta em português. null = a pessoa cancelou o seletor (sem mensagem).
// O texto original continua no log (diagnóstico).
export function bluetoothErrorText(e) {
  const name = e?.name || "", msg = String(e?.message || "");
  if (/adapter not available|bluetooth.*(off|disabled)|globally disabled/i.test(msg) || name === "NotSupportedError")
    return "Bluetooth indisponível. Confira se o Bluetooth do aparelho está ligado e se o navegador tem suporte.";
  if (name === "NotFoundError" || /cancel/i.test(msg)) return null;
  if (/user gesture/i.test(msg)) return "Toque de novo em Sincronizar sensor para escolher o sensor.";
  if (name === "NotAllowedError" || name === "SecurityError" || /permission|denied/i.test(msg))
    return "O navegador não deu permissão para usar o Bluetooth. Libere nas configurações do site e tente de novo.";
  if (name === "NetworkError" || /disconnect|desconect|GATT|connection/i.test(msg))
    return "A conexão com o sensor caiu. Aproxime o sensor, mexa nele para acordar e tente de novo.";
  if (name === "TimeoutError" || /timeout|tempo esgotado/i.test(msg))
    return "O sensor não respondeu a tempo. Mexa nele para acordar e tente de novo.";
  return "Não consegui falar com o sensor. Mexa nele para acordar e tente de novo.";
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
// Devolve { sync, packets, bad, expected, interrupted, deviceName, animalId, previousAnimalId, reassigned, text }. Lança em erro (depois de desconectar).
export async function run({
  animalId, onProgress = () => {}, onState = () => {}, onInfo = () => {}, confirmSensor = null,
  sensor = getSensor(), log = defaultLog, saveSync = storeSaveSync, setLastSync = storeSetLastSync, now = () => Date.now(),
  source = "bluetooth",
} = {}) {
  let off = false;
  const disconnect = () => {
    if (off) return;
    off = true;
    sensor.disconnect();
    onState("off", "Sensor desconectado (economizando bateria)");
  };
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
    // Salva já com o animal atual e desconecta antes de qualquer pergunta: se o app for
    // fechado com o modal de sensor aberto, o download não se perde e o sensor não fica ligado.
    // salva mesmo sem pacotes: o registro do nível ao longo do tempo também é dado
    const sync = { id: now(), endAt, source, packets: res.packets,
      sensor: { info: snap.info, status: snap.status, clock: clockBefore ? clockBefore.getTime() : null } };
    if (animalId) sync.animalId = animalId;
    if (deviceName) sync.sensorName = deviceName;
    await saveSync(sync);
    if (animalId) setLastSync(animalId, now());
    const text = resultText(res);
    onProgress({ pct: 100, text });
    disconnect();
    let target = animalId;
    if (confirmSensor && deviceName) {
      try { target = (await confirmSensor(deviceName, animalId)) || animalId; }
      catch (e) { log(`associação do sensor: ${e.message}`); target = animalId; }
    }
    // trocou de animal no modal: regrava o mesmo id com o outro animal
    const reassigned = !!target && target !== animalId;
    if (reassigned) {
      sync.animalId = target;
      await saveSync(sync);
      setLastSync(target, now());
    }
    return { sync, packets: res.packets, bad: res.bad, expected: res.expected, interrupted: res.interrupted, deviceName, animalId: target, previousAnimalId: animalId, reassigned, text };
  } catch (e) {
    log(`erro na sincronização: ${e.message}`);
    throw e;
  } finally {
    disconnect();
  }
}
