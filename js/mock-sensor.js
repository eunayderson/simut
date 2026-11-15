// Sensor simulado (?mock=1): mesma interface de PersonoSensor (js/ble.js, que não muda),
// para testar a sincronização sem hardware. Gera pacotes válidos (CRC32 certo) com trechos de
// repouso, leve e intenso. Downloads simulados são marcados com source = MOCK_SOURCE e nunca
// sobem para a nuvem (cloud.syncAll os ignora; no modo simulado a nuvem fica desligada).

import { crc32 } from "./crc32.js?v=10";

export const MOCK_SOURCE = "simulado";
export const MOCK_NAME = "Persono-SIMULADO";

// Amostras por classe (x, y, z em int8, ~64 por g), uma janela de 60 s por minuto.
const SAMPLE = { rest: [0, 0, 64], light: [32, 0, 64], vig: [100, 0, 64] };
const PATTERN = ["rest", "rest", "light", "vig", "light", "rest"];

// Pacotes [seq][offset u24 LE][78 amostras xyz][crc32 LE].
export function mockPackets({ minutes = 20, hz = 32 } = {}) {
  const per = 78, packets = [];
  const samples = [];
  for (let m = 0; m < minutes; m++) for (let i = 0; i < hz * 60; i++) samples.push(SAMPLE[PATTERN[m % PATTERN.length]]);
  for (let i = 0, off = 0, seq = 0; i < samples.length; i += per, off += per * 3, seq++) {
    const chunk = samples.slice(i, i + per);
    const b = new Uint8Array(4 + chunk.length * 3 + 4);
    b[0] = seq & 0xff; b[1] = off & 0xff; b[2] = (off >> 8) & 0xff; b[3] = (off >> 16) & 0xff;
    chunk.forEach((s, k) => { b[4 + k * 3] = s[0] & 0xff; b[5 + k * 3] = s[1] & 0xff; b[6 + k * 3] = s[2] & 0xff; });
    const n = b.length;
    new DataView(b.buffer).setUint32(n - 4, crc32(b.subarray(0, n - 4)), true);
    packets.push(b);
  }
  return packets;
}

const sleep = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export class MockSensor extends EventTarget {
  constructor(log = () => {}, { name = MOCK_NAME, minutes = 20, delayMs = 400 } = {}) {
    super();
    this.log = log;
    this.opts = { name, minutes, delayMs };
    this.device = null;
    this._connected = false;
  }
  get connected() { return this._connected; }
  async connect() {
    await sleep(this.opts.delayMs);
    this.device = { name: this.opts.name };
    this._connected = true;
    this.log(`sensor simulado conectado (${this.opts.name})`);
    this.dispatchEvent(new Event("connect"));
    return this.opts.name;
  }
  async readClock() { return new Date(); }
  async readInfo() { return new Uint8Array([1, 2, 85]); }
  async readStatus() { return new Uint8Array([0, 7]); }
  async download({ onProgress } = {}) {
    const all = mockPackets({ minutes: this.opts.minutes });
    const packets = [];
    const step = Math.max(1, Math.ceil(all.length / 10));
    for (let i = 0; i < all.length; i += step) {
      packets.push(...all.slice(i, i + step));
      onProgress?.({ packets: packets.length, bad: 0, expected: all.length });
      await sleep(this.opts.delayMs / 2);
    }
    this.log(`download simulado: ${packets.length} pacotes`);
    return { packets, bad: 0, expected: all.length, interrupted: false };
  }
  disconnect() {
    if (!this._connected) return;
    this._connected = false;
    this.dispatchEvent(new Event("disconnect"));
  }
}
