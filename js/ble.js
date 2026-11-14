// Comunicação com o sensor Persono via Web Bluetooth.
// Protocolo descoberto por engenharia reversa (ver README):
//   comando  -> char 81cf8376 (write), resposta por indicação: 80 <op> <status> [dados]
//   dados    -> char 81cf8768 (notify), pacotes [seq][offset u24 LE][236 bytes][crc32 LE]
//   status   -> 01 ok, 02 comando desconhecido, 03 falta parâmetro

import { crc32 } from "./crc32.js";

export const SERVICE = "81cf8254-454d-11e8-adc0-fa7ae01bd428";
const CHAR_CMD = "81cf8376-454d-11e8-adc0-fa7ae01bd428";
const CHAR_DATA = "81cf8768-454d-11e8-adc0-fa7ae01bd428";
const EPOCH_2000_MS = Date.UTC(2000, 0, 1);

export const bluetoothSupport = async () => {
  if (!("bluetooth" in navigator)) return "unsupported";
  try {
    if (navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability())) return "off";
  } catch { /* alguns navegadores não implementam */ }
  return "ok";
};

export class PersonoSensor extends EventTarget {
  constructor(log = () => {}) {
    super();
    this.log = log;
    this.device = null;
    this.cmd = null;
    this.data = null;
    this.pending = null;
    this.onPacket = null;
  }

  get connected() { return !!this.device?.gatt?.connected; }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "Persono" }, { services: [SERVICE] }],
      optionalServices: [SERVICE],
    });
    this.device.addEventListener("gattserverdisconnected", () => {
      this.log("desconectado");
      if (this.pending) { this.pending.reject(new Error("desconectado")); this.pending = null; }
      this.dispatchEvent(new Event("disconnect"));
    });
    this.log(`conectando em ${this.device.name}`);
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(SERVICE);
    this.cmd = await svc.getCharacteristic(CHAR_CMD);
    this.data = await svc.getCharacteristic(CHAR_DATA);
    this.cmd.addEventListener("characteristicvaluechanged", (e) => this.#onCmd(e));
    this.data.addEventListener("characteristicvaluechanged", (e) => this.#onData(e));
    await this.cmd.startNotifications();
    await this.data.startNotifications();
    this.log("conectado e inscrito nos canais");
    this.dispatchEvent(new Event("connect"));
    return this.device.name;
  }

  disconnect() { if (this.connected) this.device.gatt.disconnect(); }

  #onCmd(e) {
    const b = new Uint8Array(e.target.value.buffer.slice(0));
    this.log(`<- ${hex(b)}`);
    if (this.pending && b[0] === 0x80 && b[1] === this.pending.op) {
      const p = this.pending; this.pending = null; clearTimeout(p.timer);
      p.resolve({ status: b[2], payload: b.slice(3) });
    }
  }

  #onData(e) {
    const b = new Uint8Array(e.target.value.buffer.slice(0));
    if (this.onPacket) this.onPacket(b);
  }

  async send(bytes, timeout = 2500) {
    if (this.pending) throw new Error("comando anterior ainda pendente");
    const op = bytes[0];
    const res = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = null; reject(new Error(`sem resposta ao comando ${op.toString(16)}`)); }, timeout);
      this.pending = { op, resolve, reject, timer };
    });
    this.log(`-> ${hex(bytes)}`);
    const buf = Uint8Array.from(bytes);
    if (this.cmd.writeValueWithResponse) await this.cmd.writeValueWithResponse(buf);
    else await this.cmd.writeValue(buf);
    return res;
  }

  async readClock() {
    const r = await this.send([0x03]);
    if (r.status !== 1 || r.payload.length < 4) return null;
    const secs = new DataView(r.payload.buffer).getUint32(0, true);
    return new Date(EPOCH_2000_MS + secs * 1000);
  }

  async readInfo() {
    const r = await this.send([0x05]);
    return r.status === 1 ? r.payload : null;
  }

  async readStatus() {
    const r = await this.send([0x43]);
    return r.status === 1 ? r.payload : null;
  }

  // Descarrega a memória. Junta pacotes até o canal ficar quieto.
  async download({ onProgress, quietMs = 4000, maxMs = 15 * 60 * 1000 } = {}) {
    const packets = [];
    let bad = 0;
    let lastAt = Date.now();
    let expected = null;
    this.onPacket = (b) => {
      lastAt = Date.now();
      if (b.length < 9) return;
      const body = b.subarray(0, b.length - 4);
      const crc = new DataView(b.buffer, b.byteOffset + b.length - 4, 4).getUint32(0, true);
      if (crc32(body) !== crc) { bad++; return; }
      packets.push(b);
      onProgress?.({ packets: packets.length, bad, expected });
    };
    try {
      const r = await this.send([0x40, 0x00]);
      if (r.status !== 1) throw new Error(`sensor recusou o download (status ${r.status})`);
      if (r.payload.length >= 2) expected = r.payload[0] | (r.payload[1] << 8);
      this.log(`download iniciado, sensor anunciou ${expected ?? "?"} (valor provisório)`);
      lastAt = Date.now();
      const t0 = Date.now();
      while (Date.now() - lastAt < quietMs && Date.now() - t0 < maxMs && this.connected) {
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      this.onPacket = null;
    }
    this.log(`download terminou: ${packets.length} pacotes válidos, ${bad} com CRC ruim`);
    return { packets, bad, expected, interrupted: !this.connected };
  }
}

export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
