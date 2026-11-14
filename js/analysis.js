// Decodificação (provisória) e análise de atividade.
//
// Hipótese atual do conteúdo dos pacotes, a partir de dados com o sensor parado:
//   - amostras de 3 bytes: x, y, z em int8 (cerca de 64 unidades por g)
//   - marcadores intercalados que não são amostras:
//       "4x 00" / "5x 00"     (2 bytes)
//       "78 .. .."            (3 bytes)
//       "38 .. .. .. 32"      (5 bytes)
// Isso PRECISA ser confirmado com mais dados. Por isso os pacotes brutos ficam guardados.

const int8 = (v) => (v > 127 ? v - 256 : v);

export function decodePayload(p) {
  const out = [];
  let i = 0;
  while (i + 3 <= p.length) {
    const b = p[i];
    if (b >= 0x40 && b <= 0x5f && p[i + 1] === 0x00) { i += 2; continue; }
    if (b === 0x78) { i += 3; continue; }
    if (b === 0x38 && p[i + 4] === 0x32) { i += 5; continue; }
    out.push(int8(b), int8(p[i + 1]), int8(p[i + 2]));
    i += 3;
  }
  return out;
}

const packetOffset = (b) => b[1] | (b[2] << 8) | (b[3] << 16);
const packetKey = (b) => {
  const n = b.length;
  return `${packetOffset(b)}:${b[n - 4]}.${b[n - 3]}.${b[n - 2]}.${b[n - 1]}`;
};

// Converte as sincronizações em janelas de atividade com hora.
// Cada sincronização é ancorada na hora do sensor ao fim do download e contada para trás
// usando a taxa de amostragem configurada (também provisória).
export function buildEpochs(syncs, s) {
  const seen = new Set();
  const epochs = [];
  let totalSamples = 0;
  for (const sync of syncs) {
    const fresh = sync.packets
      .filter((b) => { const k = packetKey(b); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => packetOffset(a) - packetOffset(b));
    if (!fresh.length) continue;
    const xyz = [];
    for (const b of fresh) xyz.push(...decodePayload(b.subarray(4, b.length - 4)));
    const n = xyz.length / 3;
    totalSamples += n;
    const per = Math.max(1, Math.round(s.hz * s.epoch));
    const startMs = sync.endAt - (n / s.hz) * 1000;
    for (let e = 0; e * per < n; e++) {
      let sum = 0, cnt = 0;
      for (let k = e * per; k < Math.min(n, (e + 1) * per); k++) {
        const x = xyz[k * 3] / s.lsbPerG, y = xyz[k * 3 + 1] / s.lsbPerG, z = xyz[k * 3 + 2] / s.lsbPerG;
        sum += Math.abs(Math.sqrt(x * x + y * y + z * z) - 1);
        cnt++;
      }
      if (cnt < per * 0.5) continue;
      const mg = (sum / cnt) * 1000;
      epochs.push({ t: startMs + (e * per / s.hz) * 1000, mg, cls: classify(mg, s) });
    }
  }
  epochs.sort((a, b) => a.t - b.t);
  return { epochs, totalSamples };
}

export const classify = (mg, s) => (mg >= s.tVig ? "vig" : mg >= s.tLight ? "light" : "rest");

const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function daySummary(epochs, day, s) {
  const from = dayStart(day), to = from + 86400000;
  const hours = Array.from({ length: 24 }, () => ({ rest: 0, light: 0, vig: 0 }));
  const tot = { rest: 0, light: 0, vig: 0 };
  const min = s.epoch / 60;
  for (const e of epochs) {
    if (e.t < from || e.t >= to) continue;
    hours[new Date(e.t).getHours()][e.cls] += min;
    tot[e.cls] += min;
  }
  return { hours, tot, coveredMin: tot.rest + tot.light + tot.vig };
}

// Noite: das 22h do dia anterior às 6h do dia escolhido.
export function nightSummary(epochs, day, s) {
  const end = dayStart(day) + 6 * 3600000, start = end - 8 * 3600000;
  const win = epochs.filter((e) => e.t >= start && e.t < end);
  if (!win.length) return null;
  const min = s.epoch / 60;
  let rest = 0, wakes = 0, run = 0, longest = 0, prevRest = true;
  for (const e of win) {
    if (e.cls === "rest") { rest += min; run += min; longest = Math.max(longest, run); }
    else { if (prevRest) wakes++; run = 0; }
    prevRest = e.cls === "rest";
  }
  return { restMin: rest, coveredMin: win.length * min, wakes, longestMin: longest };
}

export function trend(epochs, endDay, s, days = 14) {
  const out = [];
  const end = dayStart(endDay);
  for (let i = days - 1; i >= 0; i--) {
    const d = end - i * 86400000;
    const { tot, coveredMin } = daySummary(epochs, d, s);
    out.push({ day: d, active: tot.light + tot.vig, vig: tot.vig, covered: coveredMin });
  }
  return out;
}

export function toCsv(epochs) {
  const rows = ["inicio_iso,inicio_local,mg_medio,classe"];
  for (const e of epochs) {
    const d = new Date(e.t);
    rows.push(`${d.toISOString()},"${d.toLocaleString("pt-BR")}",${e.mg.toFixed(1)},${e.cls}`);
  }
  return rows.join("\n");
}
