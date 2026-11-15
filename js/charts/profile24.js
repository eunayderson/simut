// Perfil de 24 h (plano, 5.3.3): intensidade média (mg) por faixa do dia.
// Área sage = média do período (ex.: 7 dias); linha verde = dia selecionado, por cima.
// Faixas sem dados ficam sem área nem linha e com fundo hachurado.
//
// const pf = createProfile24(el)
// pf.update({ period: profile24(...), day: profile24(...) | null, periodLabel: "últimos 7 dias", dayLabel: "14/11" })
// Teclado: Tab entra no gráfico, setas percorrem as faixas.

import { uid, esc, clockLabel, hatchDef, isWide, canHover, watchWidth, makeTooltip } from "./svg.js?v=10";

export function createProfile24(host, { label = "Perfil de 24 horas" } = {}) {
  const id = uid("prof");
  host.classList.add("chart", "profile24");
  host.innerHTML = `
    <figure class="chart-fig">
      <figcaption class="visually-hidden" id="${id}-cap"></figcaption>
      <div class="chart-box"></div>
      <ul class="legend chart-legend">
        <li><span class="sw area" aria-hidden="true"></span><span class="lg-period">Média do período</span></li>
        <li class="lg-day-item"><span class="sw dayline" aria-hidden="true"></span><span class="lg-day">Dia selecionado</span></li>
        <li><span class="sw none" aria-hidden="true"></span>Sem dados</li>
      </ul>
      <p class="chart-info small" aria-live="polite" hidden></p>
    </figure>`;
  const box = host.querySelector(".chart-box");
  const cap = host.querySelector("figcaption");
  const info = host.querySelector(".chart-info");
  const tip = makeTooltip(box);
  let data = { period: [], day: null, periodLabel: "período", dayLabel: "" };
  let geo = null, active = -1, svg = null;

  const binText = (i) => {
    const p = data.period[i], d = data.day?.[i];
    if (!p) return "";
    const range = `${clockLabel(p.start)} a ${clockLabel(p.end)}`;
    const per = p.mg === null ? "sem dados no período" : `${Math.round(p.mg)} mg em média no período (${p.n} ${p.n === 1 ? "janela" : "janelas"}, ${p.days} ${p.days === 1 ? "dia" : "dias"})`;
    const dd = !data.day ? "" : d && d.mg !== null ? `; dia ${data.dayLabel}: ${Math.round(d.mg)} mg (${d.n} ${d.n === 1 ? "janela" : "janelas"})` : `; dia ${data.dayLabel}: sem dados`;
    return `${range}: ${per}${dd}`;
  };

  function draw(width) {
    const P = data.period, D = data.day;
    const wide = isWide();
    const H = wide ? 230 : 190, left = 40, right = 12, top = 22, axisH = 22;
    const plotH = H - top - axisH, plotW = Math.max(60, width - left - right);
    const all = [...P, ...(D || [])].map((b) => b.mg).filter((v) => v !== null);
    const rawMax = Math.max(100, ...all);
    const stepY = rawMax > 600 ? 200 : rawMax > 300 ? 100 : 50;
    const yMax = Math.ceil(rawMax / stepY) * stepY;
    const x = (min) => left + (min / 1440) * plotW;
    const y = (v) => top + plotH - (v / yMax) * plotH;
    geo = { left, plotW, top, plotH, yMax, n: P.length };
    const hatch = `${id}-hatch`;
    let s = `<defs>${hatchDef(hatch)}</defs>`;

    for (let v = 0; v <= yMax; v += stepY) {
      s += `<line class="grid" x1="${left}" x2="${left + plotW}" y1="${y(v)}" y2="${y(v)}"/>`;
      s += `<text class="axis" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    for (let h = 0; h <= 24; h += 6) {
      const anchor = h === 0 ? "start" : h === 24 ? "end" : "middle";
      s += `<line class="grid" x1="${x(h * 60)}" x2="${x(h * 60)}" y1="${top}" y2="${top + plotH}"/>`;
      s += `<text class="axis" x="${x(h * 60)}" y="${H - 6}" text-anchor="${anchor}">${h}h</text>`;
    }
    P.forEach((b, i) => {
      if (b.mg === null) s += `<rect class="nodata" x="${x(b.start)}" y="${top}" width="${x(b.end) - x(b.start)}" height="${plotH}" fill="url(#${hatch})" opacity=".55"/>`;
      if (i === active) s += `<rect class="col-active" x="${x(b.start)}" y="${top}" width="${x(b.end) - x(b.start)}" height="${plotH}"/>`;
    });

    // trechos contíguos com dados, em degraus (cada faixa é plana)
    const runs = (bins) => {
      const out = []; let cur = null;
      for (const b of bins) {
        if (b.mg === null) { cur = null; continue; }
        if (!cur) { cur = []; out.push(cur); }
        cur.push(b);
      }
      return out;
    };
    for (const r of runs(P)) {
      let d = `M${x(r[0].start)},${y(0)}`;
      for (const b of r) d += `L${x(b.start)},${y(b.mg)}L${x(b.end)},${y(b.mg)}`;
      d += `L${x(r[r.length - 1].end)},${y(0)}Z`;
      s += `<path class="prof-area" d="${d}"/>`;
    }
    if (D) {
      for (const r of runs(D)) {
        let d = "";
        r.forEach((b, k) => { d += `${k ? "L" : "M"}${x(b.start)},${y(b.mg)}L${x(b.end)},${y(b.mg)}`; });
        s += `<path class="prof-day" d="${d}"/>`;
      }
    }
    s += `<text class="axis unit" x="4" y="10">mg</text>`;
    if (!all.length) s += `<text class="empty-label" x="${left + plotW / 2}" y="${top + plotH / 2}" text-anchor="middle">Sem dados neste período</text>`;

    if (!svg) {
      box.insertAdjacentHTML("afterbegin", `<svg class="chart-svg" role="group" aria-labelledby="${id}-cap"></svg>`);
      svg = box.querySelector("svg");
    }
    svg.setAttribute("width", width); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
    if (P.length) svg.setAttribute("tabindex", "0"); else svg.removeAttribute("tabindex");
    svg.innerHTML = s;
  }

  function describe() {
    const P = data.period;
    const covered = P.filter((b) => b.mg !== null);
    const peak = covered.reduce((a, b) => (!a || b.mg > a.mg ? b : a), null);
    cap.textContent = P.length
      ? `${esc(label)}: intensidade média em mg por faixa de ${P[0].end - P[0].start} minutos, ${data.periodLabel}. ` +
        `${covered.length} de ${P.length} faixas com dados.` +
        (peak ? ` Pico de ${Math.round(peak.mg)} mg entre ${clockLabel(peak.start)} e ${clockLabel(peak.end)}.` : "") +
        (data.day ? ` A linha mostra o dia ${data.dayLabel}.` : "") + " Use as setas para ouvir cada faixa."
      : `${label}: sem dados.`;
    host.querySelector(".lg-period").textContent = `Média, ${data.periodLabel}`;
    host.querySelector(".lg-day-item").hidden = !data.day;
    host.querySelector(".lg-day").textContent = `Dia ${data.dayLabel}`;
  }

  const ww = watchWidth(box, (w) => draw(w));

  function setActive(i, { announce = false } = {}) {
    active = i;
    ww.redraw();
    const b = data.period[i];
    if (!b) { tip.hide(); return; }
    const px = geo.left + ((b.start + b.end) / 2 / 1440) * geo.plotW;
    const v = b.mg ?? data.day?.[i]?.mg ?? 0;
    const py = geo.top + geo.plotH - (v / geo.yMax) * geo.plotH;
    const text = binText(i);
    if (announce) { info.hidden = false; info.textContent = text; }
    const [head, ...rest] = text.split(": ");
    if (canHover() || announce) tip.show(`<div class="tt-title">${esc(head)}</div><div>${esc(rest.join(": "))}</div><div class="tt-muted">Processado, média das janelas de 60 s</div>`, px, py);
  }

  const indexAt = (e) => {
    const b = svg.getBoundingClientRect();
    const frac = (e.clientX - b.left - geo.left) / geo.plotW;
    if (frac < 0 || frac >= 1) return -1;
    return Math.floor(frac * geo.n);
  };
  box.addEventListener("pointermove", (e) => {
    if (!geo || !geo.n || (e.pointerType !== "mouse" && !canHover())) return;
    const i = indexAt(e);
    if (i !== active) setActive(i);
  });
  box.addEventListener("pointerleave", () => { if (document.activeElement !== svg) { active = -1; tip.hide(); ww.redraw(); } });
  box.addEventListener("click", (e) => {
    if (!geo || !geo.n || e.pointerType === "mouse") return;
    const i = indexAt(e);
    if (i >= 0) setActive(i, { announce: true });
  });
  box.addEventListener("keydown", (e) => {
    const n = data.period.length;
    if (!n) return;
    let i = active < 0 ? 0 : active;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") i = Math.min(n - 1, i + 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = n - 1;
    else if (e.key === "Escape") { active = -1; tip.hide(); ww.redraw(); return; }
    else return;
    e.preventDefault();
    setActive(i, { announce: true });
  });
  box.addEventListener("focusin", () => {
    if (active >= 0 || !data.period.length) return;
    const first = data.period.findIndex((b) => b.mg !== null);
    setActive(first < 0 ? 0 : first, { announce: true });
  });
  box.addEventListener("focusout", (e) => { if (!box.contains(e.relatedTarget)) { active = -1; tip.hide(); ww.redraw(); } });

  return {
    update(next = {}) { data = { ...data, ...next }; if (active >= data.period.length) active = -1; describe(); ww.redraw(); },
    destroy() { ww.stop(); host.replaceChildren(); host.classList.remove("profile24"); },
  };
}
