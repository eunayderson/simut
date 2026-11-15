// Fixtures sintéticas para os testes (sem dependências).

// Uma amostra por estado: x, y, z em int8 (~64 unidades por g). z = 64 é 1 g parado.
export const SAMPLE = { rest: [0, 0, 64], light: [32, 0, 64], vig: [100, 0, 64] };

// Monta pacotes [seq][offset u24 LE][payload][crc 4 bytes] com 78 amostras cada.
export function makePackets(samples, { startOffset = 0, seq = 0 } = {}) {
  const packets = [];
  const per = 78;
  for (let i = 0, off = startOffset; i < samples.length; i += per, off += per * 3) {
    const chunk = samples.slice(i, i + per);
    const b = new Uint8Array(4 + chunk.length * 3 + 4);
    b[0] = seq++ & 0xff; b[1] = off & 0xff; b[2] = (off >> 8) & 0xff; b[3] = (off >> 16) & 0xff;
    chunk.forEach((s, k) => { b[4 + k * 3] = s[0] & 0xff; b[5 + k * 3] = s[1] & 0xff; b[6 + k * 3] = s[2] & 0xff; });
    const n = b.length; b[n - 4] = off & 0xff; b[n - 3] = (off >> 8) & 0xff; b[n - 2] = 1; b[n - 1] = 2;
    packets.push(b);
  }
  return packets;
}

// Amostras para uma sequência de janelas: ["rest", "light", ...] com hz*epoch amostras cada.
export function samplesFor(classes, hz = 32, epoch = 60) {
  const out = [];
  for (const c of classes) for (let i = 0; i < hz * epoch; i++) out.push(SAMPLE[c]);
  return out;
}

export const SETTINGS = { hz: 32, epoch: 60, tLight: 40, tVig: 250, lsbPerG: 64 };

// Hora local fixa (dia 14/11/2026) para não depender do relógio.
export const at = (h, m = 0, day = 14) => new Date(2026, 10, day, h, m, 0, 0).getTime();

// Janelas prontas (sem passar por pacotes): [{t, mg, cls}]
export function epochsFrom(startMs, classes, epochMs = 60000) {
  const MG = { rest: 10, light: 100, vig: 400 };
  return classes.map((c, i) => ({ t: startMs + i * epochMs, mg: MG[c], cls: c }));
}
