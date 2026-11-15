// Tendência (plano, 5.3.2): minutos ativos por dia, hoje à direita.
// Escala y de 0 a max(240, maior valor) com marcas de 60 em 60 min. Pontos só onde há dados;
// a linha é interrompida nos dias sem dados (nunca desenha zero). Faixa fina embaixo mostra
// a cobertura de cada dia (minutos medidos), para o leitor saber quanto cada ponto representa.
//
// const tr = createTrend(el, { onSelectDay(day) })
// tr.update({ rows: trend(...), selectedDay })
// Teclado: Tab entra no gráfico, setas esquerda/direita percorrem os dias, Enter seleciona o dia.

import { uid, esc, dm, minLabel, hatchDef, isWide, canHover, watchWidth, makeTooltip } from "./svg.js?v=10";

export function createTrend(host, { onSelectDay = null, label = "Tendência de minutos ativos" } = {}) {
  const id = uid("trend");
  host.classList.add("chart", "trend");
  host.innerHTML = `
    <figure class="chart-fig">
      <figcaption class="visually-hidden" id="${id}-cap"></figcaption>
      <div class="chart-box"></div>
      <p class="chart-info small" aria-live="polite" hidden></p>
    </figure>`;
  const box = host.querySelector(".chart-box");
  const cap = host.querySelector("figcaption");
  const info = host.querySelector(".chart-info");
  const tip = makeTooltip(box);
  let data = { rows: [], selectedDay: null };
  let geo = null, active = -1, svg = null;

  const pointText = (r) => r.covered
    ? `${dm(r.day)}: ${minLabel(r.active)} ativos${r.vig ? ` (${minLabel(r.vig)} intenso)` : ""}, em ${minLabel(r.covered)} medidos`
    : `${dm(r.day)}: sem dados`;
  const pointHtml = (r) => r.covered
    ? `<div class="tt-title">${dm(r.day)}</div><div>${minLabel(r.active)} ativos${r.vig ? `, ${minLabel(r.vig)} intenso` : ""}</div><div class="tt-muted">em ${minLabel(r.covered)} medidos (processado)</div>`
    : `<div class="tt-title">${dm(r.day)}</div><div>Sem dados</div><div class="tt-muted">Ausência não é zero</div>`;

  function draw(width) {
    const rows = data.rows;
    const wide = isWide();
    const H = wide ? 230 : 190, left = 40, right = 12, top = 22, covH = 8, axisH = 22;
    const plotH = H - top - covH - 6 - axisH;
    const plotW = Math.max(60, width - left - right);
    const n = Math.max(1, rows.length);
    const step = plotW / n;
    const cx = (i) => left + step * (i + 0.5);
    const maxV = Math.max(240, ...rows.map((r) => r.active ?? 0));
    const yMax = Math.ceil(maxV / 60) * 60;
    const yv = (v) => top + plotH - (v / yMax) * plotH;
    geo = { left, step, n, top, plotH, yMax };
    const hatch = `${id}-hatch`;
    let s = `<defs>${hatchDef(hatch)}</defs>`;

    // eixo y em minutos
    const tickStep = yMax > 480 ? 120 : 60;
    for (let v = 0; v <= yMax; v += tickStep) {
      s += `<line class="grid" x1="${left}" x2="${left + plotW}" y1="${yv(v)}" y2="${yv(v)}"/>`;
      s += `<text class="axis" x="${left - 6}" y="${yv(v) + 4}" text-anchor="end">${v}</text>`;
    }

    s += `<text class="axis unit" x="4" y="10">min</text>`;

    // colunas sem dados hachuradas, dia selecionado destacado
    rows.forEach((r, i) => {
      const x0 = left + step * i;
      if (!r.covered) s += `<rect class="nodata" x="${x0 + 1}" y="${top}" width="${step - 2}" height="${plotH}" fill="url(#${hatch})" opacity=".55"/>`;
      if (data.selectedDay !== null && r.day === data.selectedDay) s += `<rect class="col-sel" x="${x0 + 1}" y="${top}" width="${step - 2}" height="${plotH}"/>`;
      if (i === active) s += `<rect class="col-active" x="${x0 + 1}" y="${top}" width="${step - 2}" height="${plotH}"/>`;
    });

    // linha interrompida nas lacunas
    let path = "", open = false;
    rows.forEach((r, i) => {
      if (!r.covered) { open = false; return; }
      path += `${open ? "L" : "M"}${cx(i).toFixed(1)},${yv(r.active).toFixed(1)}`;
      open = true;
    });
    if (path) s += `<path class="trend-line" d="${path}"/>`;
    rows.forEach((r, i) => {
      if (r.covered) s += `<circle class="trend-dot${i === active ? " active" : ""}" cx="${cx(i)}" cy="${yv(r.active)}" r="${i === active ? 6 : 4.5}"/>`;
    });

    // cobertura (minutos medidos de 1440)
    const cy = top + plotH + 6;
    rows.forEach((r, i) => {
      const x0 = left + step * i + 2, w = step - 4;
      s += `<rect class="cov-bg" x="${x0}" y="${cy}" width="${w}" height="${covH}" rx="2" fill="url(#${hatch})"/>`;
      if (r.covered) s += `<rect class="cov" x="${x0}" y="${cy}" width="${Math.max(2, w * Math.min(1, r.covered / 1440))}" height="${covH}" rx="2"/>`;
    });

    // rótulos dos dias
    const every = step < 34 ? 2 : 1;
    rows.forEach((r, i) => {
      if ((rows.length - 1 - i) % every === 0) s += `<text class="axis" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${dm(r.day)}</text>`;
    });
    if (!rows.some((r) => r.covered)) s += `<text class="empty-label" x="${left + plotW / 2}" y="${top + plotH / 2}" text-anchor="middle">Sem dados neste período</text>`;
    // o <svg> é o mesmo entre desenhos: o foco do teclado não se perde
    if (!svg) {
      box.insertAdjacentHTML("afterbegin", `<svg class="chart-svg" role="group" aria-labelledby="${id}-cap"></svg>`);
      svg = box.querySelector("svg");
    }
    svg.setAttribute("width", width); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
    if (rows.length) svg.setAttribute("tabindex", "0"); else svg.removeAttribute("tabindex");
    svg.innerHTML = s;
  }

  function describe() {
    const rows = data.rows, withData = rows.filter((r) => r.covered);
    cap.textContent = rows.length
      ? `${esc(label)}: ${rows.length} dias, de ${dm(rows[0].day)} a ${dm(rows[rows.length - 1].day)}, minutos ativos por dia (leve mais intenso). ` +
        `${withData.length} ${withData.length === 1 ? "dia com" : "dias com"} dados. ${rows.map(pointText).join("; ")}.`
      : `${label}: sem dias para mostrar.`;
  }

  const ww = watchWidth(box, (w) => draw(w));

  function setActive(i, { announce = false } = {}) {
    active = i;
    ww.redraw();
    const r = data.rows[i];
    if (!r) { tip.hide(); return; }
    const x = geo.left + geo.step * (i + 0.5);
    const y = r.covered ? geo.top + geo.plotH - (r.active / geo.yMax) * geo.plotH : geo.top + geo.plotH / 2;
    if (announce) { info.hidden = false; info.textContent = pointText(r); }
    if (canHover() || announce) tip.show(pointHtml(r), x, y);
  }

  const indexAt = (e) => {
    const b = svg.getBoundingClientRect();
    const i = Math.floor((e.clientX - b.left - geo.left) / geo.step);
    return i >= 0 && i < data.rows.length ? i : -1;
  };
  box.addEventListener("pointermove", (e) => {
    if (!geo || (e.pointerType !== "mouse" && !canHover())) return;
    const i = indexAt(e);
    if (i !== active) setActive(i);
  });
  box.addEventListener("pointerleave", () => { if (document.activeElement !== svg) { active = -1; tip.hide(); ww.redraw(); } });
  box.addEventListener("click", (e) => {
    if (!geo) return;
    const i = indexAt(e);
    if (i < 0) return;
    if (e.pointerType !== "mouse") { info.hidden = false; info.textContent = pointText(data.rows[i]); }
    onSelectDay?.(data.rows[i].day);
  });
  box.addEventListener("keydown", (e) => {
    if (!data.rows.length) return;
    let i = active < 0 ? data.rows.length - 1 : active;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") i = Math.min(data.rows.length - 1, i + 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = data.rows.length - 1;
    else if ((e.key === "Enter" || e.key === " ") && active >= 0) { e.preventDefault(); onSelectDay?.(data.rows[active].day); return; }
    else if (e.key === "Escape") { active = -1; tip.hide(); ww.redraw(); return; }
    else return;
    e.preventDefault();
    setActive(i, { announce: true });
  });
  box.addEventListener("focusin", () => { if (active < 0 && data.rows.length) setActive(data.rows.length - 1, { announce: true }); });
  box.addEventListener("focusout", (e) => { if (!box.contains(e.relatedTarget)) { active = -1; tip.hide(); ww.redraw(); } });

  return {
    update(next = {}) { data = { ...data, ...next }; if (active >= data.rows.length) active = -1; describe(); ww.redraw(); },
    destroy() { ww.stop(); host.replaceChildren(); host.classList.remove("trend"); },
  };
}
