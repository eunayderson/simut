// Actograma interativo (plano, 5.3.1): uma linha por dia (hoje embaixo), eixo de 0h a 24h,
// fundo hachurado onde não há dados, blocos coloridos por classe (trechos de dayRuns).
//
// Interação:
//   mouse: passar mostra tooltip; clicar numa linha seleciona o dia; arrastar dentro de uma linha seleciona um período
//   toque: tocar num bloco mostra os detalhes abaixo do gráfico e seleciona o bloco como período (e o dia)
//   teclado: Tab entra no gráfico (um ponto de parada), setas andam entre blocos (cima/baixo trocam de dia),
//            Enter seleciona o bloco como período, Esc limpa a seleção
// Leitor de tela: legenda resumida no figcaption e tabela oculta com os trechos do dia selecionado.
//
// const acto = createActogram(el, { onSelectDay(day), onSelectRange({ day, from, to } | null), interactive })
// acto.update({ rows: actogramRows(...), selectedDay, range, epochSec })

import { uid, esc, CLS_NAME, CLS_LABEL, CLS_FILL, hhmm, dm, weekday, minLabel, hatchDef, isWide, canHover, watchWidth, makeTooltip } from "./svg.js?v=10";

const DAY = 86400000;
const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

export function createActogram(host, { onSelectDay = () => {}, onSelectRange = () => {}, interactive = true, label = "Actograma" } = {}) {
  const id = uid("acto");
  host.classList.add("chart", "acto");
  host.innerHTML = `
    <figure class="chart-fig">
      <figcaption class="visually-hidden" id="${id}-cap"></figcaption>
      <div class="chart-box"></div>
      <p class="chart-sel small" hidden></p>
      <p class="chart-info small" aria-live="polite" hidden></p>
      <div class="visually-hidden"><table><caption></caption><thead><tr><th>Início</th><th>Fim</th><th>Classe</th><th>Intensidade média (mg)</th></tr></thead><tbody></tbody></table></div>
    </figure>`;
  const box = host.querySelector(".chart-box");
  const cap = host.querySelector("figcaption");
  const selP = host.querySelector(".chart-sel");
  const info = host.querySelector(".chart-info");
  const table = host.querySelector("table");
  const tip = makeTooltip(box);

  let data = { rows: [], selectedDay: null, range: null, epochSec: 60, now: Date.now() };
  let geo = null;           // geometria do último desenho
  let focusKey = null;      // "r:k" do bloco com tabindex 0
  let drag = null;
  let svg = null;

  const runAt = (r, t) => data.rows[r]?.runs.findIndex((u) => t >= u.from && t < u.to) ?? -1;
  const blockText = (row, u) => `${dm(row.day)}, ${hhmm(u.from)} a ${hhmm(u.to)}, ${CLS_NAME[u.cls]}, ${Math.round(u.mg)} mg`;

  function draw(width) {
    const rows = data.rows;
    const wide = isWide();
    const rowH = wide ? 28 : 22, gap = 4, top = 22, bottom = 22, right = 8;
    const labelW = wide ? 84 : 46;
    const plotW = Math.max(60, width - labelW - right);
    const H = top + Math.max(1, rows.length) * (rowH + gap) - gap + bottom;
    const X = (frac) => labelW + frac * plotW;
    const xt = (t, day) => X(Math.min(1, Math.max(0, (t - day) / DAY)));
    const yr = (i) => top + i * (rowH + gap);
    geo = { width, rowH, gap, top, labelW, plotW, H };
    const hatch = `${id}-hatch`;
    let s = `<defs>${hatchDef(hatch)}</defs>`;

    // grade de horas e rótulos em cima e embaixo
    for (const h of TICKS) {
      const x = X(h / 24);
      s += `<line class="grid" x1="${x}" x2="${x}" y1="${top - 4}" y2="${H - bottom + 4}"/>`;
      if (wide || h % 6 === 0) {
        const anchor = h === 0 ? "start" : h === 24 ? "end" : "middle";
        s += `<text class="axis" x="${x}" y="${top - 8}" text-anchor="${anchor}">${h}h</text>`;
        s += `<text class="axis" x="${x}" y="${H - 6}" text-anchor="${anchor}">${h}h</text>`;
      }
    }

    let lastKey = null;
    rows.forEach((row, i) => {
      const y = yr(i);
      const sel = data.selectedDay !== null && row.day === data.selectedDay;
      s += `<text class="row-label${sel ? " sel" : ""}" x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${wide ? `${esc(weekday(row.day))} ` : ""}${dm(row.day)}</text>`;
      s += `<rect class="row-bg" x="${X(0)}" y="${y}" width="${plotW}" height="${rowH}" fill="url(#${hatch})"/>`;
      row.runs.forEach((u, k) => {
        const x0 = xt(u.from, row.day), w = Math.max(1.5, xt(u.to, row.day) - x0);
        const key = `${i}:${k}`;
        lastKey = key;
        const zzz = wide && u.cls === "rest" && u.to - u.from >= 2 * 3600000 && w >= 30;
        s += `<g class="block" data-r="${i}" data-k="${k}"${interactive ? ` tabindex="-1" role="button" aria-label="${esc(blockText(row, u))}"` : ""}>` +
          `<rect x="${x0.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${rowH}" fill="${CLS_FILL[u.cls]}"/>` +
          (zzz ? `<text class="zzz" x="${(x0 + w / 2).toFixed(1)}" y="${y + rowH / 2 + 4}" text-anchor="middle">zzz</text>` : "") +
          `</g>`;
      });
      if (sel) s += `<rect class="row-sel" x="${X(0) - 1}" y="${y - 1}" width="${plotW + 2}" height="${rowH + 2}"/>`;
      if (data.now >= row.day && data.now < row.day + DAY) {
        const nx = xt(data.now, row.day);
        s += `<line class="now-line" x1="${nx}" x2="${nx}" y1="${y - 3}" y2="${y + rowH + 3}"><title>Agora</title></line>`;
      }
    });

    // período selecionado
    const rg = data.range;
    const ri = rg ? rows.findIndex((r) => r.day === rg.day) : -1;
    if (ri >= 0) {
      const x0 = xt(rg.from, rg.day), x1 = xt(rg.to, rg.day);
      s += `<rect class="range" x="${x0}" y="${yr(ri) - 2}" width="${Math.max(2, x1 - x0)}" height="${rowH + 4}"/>`;
    }
    s += `<rect class="range drag" x="0" y="0" width="0" height="0" visibility="hidden"/>`;
    if (!rows.some((r) => r.covered > 0)) {
      s += `<text class="empty-label" x="${X(0.5)}" y="${top + ((rows.length || 1) * (rowH + gap)) / 2 + 4}" text-anchor="middle">Sem dados neste período</text>`;
    }

    const hadFocus = box.contains(document.activeElement);
    if (!svg) {
      box.insertAdjacentHTML("afterbegin", `<svg class="chart-svg" role="group" aria-labelledby="${id}-cap"></svg>`);
      svg = box.querySelector("svg");
    }
    svg.setAttribute("width", width); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
    svg.innerHTML = s;
    if (interactive) {
      if (!focusKey || !box.querySelector(blockSel(focusKey))) focusKey = lastKey;
      const f = focusKey && box.querySelector(blockSel(focusKey));
      if (f) { f.setAttribute("tabindex", "0"); if (hadFocus) f.focus(); }
    }
  }

  const blockSel = (key) => { const [r, k] = key.split(":"); return `g.block[data-r="${r}"][data-k="${k}"]`; };

  function describe() {
    const rows = data.rows;
    const withData = rows.filter((r) => r.covered > 0);
    cap.textContent = rows.length
      ? `${label}: ${rows.length} dias, de ${dm(rows[0].day)} a ${dm(rows[rows.length - 1].day)}. ${withData.length} ${withData.length === 1 ? "dia tem" : "dias têm"} dados, ` +
        `${minLabel(withData.reduce((a, r) => a + r.covered, 0))} medidos no total. Horas sem dados aparecem hachuradas. ` +
        (interactive ? "Use as setas para percorrer os trechos e Enter para selecionar." : "")
      : `${label}: sem dias para mostrar.`;
    const target = rows.find((r) => r.day === data.selectedDay) || rows[rows.length - 1];
    table.querySelector("caption").textContent = target ? `Trechos de ${dm(target.day)}` : "";
    table.querySelector("tbody").innerHTML = target && target.runs.length
      ? target.runs.map((u) => `<tr><td>${hhmm(u.from)}</td><td>${hhmm(u.to)}</td><td>${CLS_LABEL[u.cls]}</td><td>${Math.round(u.mg)}</td></tr>`).join("")
      : `<tr><td colspan="4">Sem dados neste dia</td></tr>`;
    const rg = data.range;
    selP.hidden = !rg;
    if (rg) selP.textContent = `Período selecionado: ${dm(rg.day)}, ${hhmm(rg.from)} a ${hhmm(rg.to)}.`;
  }

  const ww = watchWidth(box, (w) => draw(w));

  // ---------- ponteiro ----------
  function locate(e) {
    if (!geo) return null;
    const b = svg.getBoundingClientRect();
    const px = e.clientX - b.left, py = e.clientY - b.top;
    const r = Math.floor((py - geo.top) / (geo.rowH + geo.gap));
    const inRow = r >= 0 && r < data.rows.length && (py - geo.top) - r * (geo.rowH + geo.gap) <= geo.rowH;
    const frac = (px - geo.labelW) / geo.plotW;
    const row = data.rows[r];
    return { px, py, r: inRow ? r : -1, frac, inPlot: frac >= 0 && frac <= 1, t: row ? row.day + Math.min(1, Math.max(0, frac)) * DAY : null };
  }

  function tipHtml(r, t) {
    const row = data.rows[r];
    const k = runAt(r, t);
    if (k < 0) return `<div class="tt-title">${dm(row.day)}, ${hhmm(t)}</div><div>Sem dados neste horário</div><div class="tt-muted">Ausência não é repouso</div>`;
    const u = row.runs[k];
    return `<div class="tt-title">${dm(row.day)}, ${hhmm(u.from)} a ${hhmm(u.to)}</div>` +
      `<div>${CLS_LABEL[u.cls]}, ${Math.round(u.mg)} mg médio (${minLabel(Math.round((u.to - u.from) / 60000))})</div>` +
      `<div class="tt-muted">Processado, janelas de ${data.epochSec} s</div>`;
  }

  const plain = (html) => html.replace(/<\/div>/g, ". ").replace(/<[^>]+>/g, "").replace(/\.\s*\.\s*$/, ".").trim();

  function showInfo(r, t) {
    info.hidden = false;
    info.textContent = plain(tipHtml(r, t));
  }

  if (interactive) {
    box.addEventListener("pointermove", (e) => {
      const p = locate(e);
      if (!p) return;
      if (drag) {
        if (Math.abs(p.px - drag.px) > 4) drag.moved = true;
        if (drag.moved) {
          const row = data.rows[drag.r];
          const t = row.day + Math.min(1, Math.max(0, p.frac)) * DAY;
          drag.t1 = t;
          const x0 = geo.labelW + ((Math.min(drag.t0, t) - row.day) / DAY) * geo.plotW;
          const x1 = geo.labelW + ((Math.max(drag.t0, t) - row.day) / DAY) * geo.plotW;
          const rect = box.querySelector("rect.drag");
          rect.setAttribute("x", x0); rect.setAttribute("width", Math.max(1, x1 - x0));
          rect.setAttribute("y", geo.top + drag.r * (geo.rowH + geo.gap) - 2); rect.setAttribute("height", geo.rowH + 4);
          rect.setAttribute("visibility", "visible");
          tip.show(`<div class="tt-title">${hhmm(Math.min(drag.t0, t))} a ${hhmm(Math.max(drag.t0, t))}</div>`, p.px, p.py);
        }
        return;
      }
      if (e.pointerType === "mouse" || canHover()) {
        if (p.r >= 0 && p.inPlot) tip.show(tipHtml(p.r, p.t), p.px, p.py); else tip.hide();
      }
    });
    box.addEventListener("pointerleave", () => { if (!drag) tip.hide(); });
    box.addEventListener("pointerdown", (e) => {
      const p = locate(e);
      if (!p || p.r < 0) return;
      drag = { r: p.r, px: p.px, t0: p.t, t1: p.t, moved: false, type: e.pointerType, inPlot: p.inPlot };
      if (e.pointerType === "mouse") { box.setPointerCapture?.(e.pointerId); e.preventDefault(); }
    });
    const end = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      box.querySelector("rect.drag")?.setAttribute("visibility", "hidden");
      tip.hide();
      const row = data.rows[d.r];
      if (!row) return;
      if (d.moved && d.type === "mouse") {
        const snap = (t) => Math.round(t / 60000) * 60000;
        const from = snap(Math.min(d.t0, d.t1)), to = snap(Math.max(d.t0, d.t1));
        if (to - from >= 60000) { selectDay(row.day); setRange({ day: row.day, from, to }); return; }
      }
      if (e.type === "pointercancel") return;
      selectDay(row.day);
      if (d.inPlot && d.type !== "mouse") {
        showInfo(d.r, d.t0);
        const k = runAt(d.r, d.t0);
        if (k >= 0) { const u = row.runs[k]; setRange({ day: row.day, from: u.from, to: u.to }); focusKey = `${d.r}:${k}`; }
      }
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);

    // ---------- teclado (tabindex móvel entre os blocos) ----------
    box.addEventListener("keydown", (e) => {
      const g = e.target.closest?.("g.block");
      if (e.key === "Escape") { if (data.range) { setRange(null); e.preventDefault(); } return; }
      if (!g) return;
      let r = Number(g.dataset.r), k = Number(g.dataset.k);
      const row = data.rows[r];
      const move = (nr, nk) => {
        const ng = box.querySelector(`g.block[data-r="${nr}"][data-k="${nk}"]`);
        if (!ng) return;
        g.setAttribute("tabindex", "-1"); ng.setAttribute("tabindex", "0"); ng.focus();
        focusKey = `${nr}:${nk}`;
        const u = data.rows[nr].runs[nk];
        const rect = ng.querySelector("rect");
        tip.show(tipHtml(nr, u.from), Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2, Number(rect.getAttribute("y")));
      };
      // bloco mais próximo (no tempo) em outra linha com dados
      const nearest = (dir) => {
        const mid = (row.runs[k].from + row.runs[k].to) / 2 - row.day;
        for (let i = r + dir; i >= 0 && i < data.rows.length; i += dir) {
          const rr = data.rows[i];
          if (!rr.runs.length) continue;
          let best = 0, bd = Infinity;
          rr.runs.forEach((u, j) => { const d = Math.abs((u.from + u.to) / 2 - rr.day - mid); if (d < bd) { bd = d; best = j; } });
          return [i, best];
        }
        return null;
      };
      if (e.key === "ArrowRight") { e.preventDefault(); if (k + 1 < row.runs.length) move(r, k + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (k > 0) move(r, k - 1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); const n = nearest(1); if (n) move(...n); }
      else if (e.key === "ArrowUp") { e.preventDefault(); const n = nearest(-1); if (n) move(...n); }
      else if (e.key === "Home") { e.preventDefault(); move(r, 0); }
      else if (e.key === "End") { e.preventDefault(); move(r, row.runs.length - 1); }
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const u = row.runs[k];
        selectDay(row.day);
        setRange({ day: row.day, from: u.from, to: u.to });
      }
    });
    box.addEventListener("focusout", (e) => { if (!box.contains(e.relatedTarget)) tip.hide(); });
  }

  function selectDay(day) {
    if (data.selectedDay === day) return;
    data.selectedDay = day;
    describe(); ww.redraw();
    onSelectDay(day);
  }
  function setRange(range) {
    data.range = range;
    describe(); ww.redraw();
    onSelectRange(range);
  }

  return {
    update(next = {}) {
      data = { ...data, ...next, now: next.now ?? Date.now() };
      if (data.range && !data.rows.some((r) => r.day === data.range.day)) data.range = null;
      describe();
      ww.redraw();
    },
    clearSelection() { if (data.range) setRange(null); info.hidden = true; },
    get state() { return { selectedDay: data.selectedDay, range: data.range }; },
    destroy() { ww.stop(); host.replaceChildren(); host.classList.remove("acto"); },
  };
}
