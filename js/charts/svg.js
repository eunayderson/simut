// Peças comuns dos gráficos: SVG no tamanho real do contêiner (texto nunca estica),
// redesenho ao redimensionar, tooltip que não sai da tela e formatação curta.

let n = 0;
export const uid = (p = "c") => `${p}${++n}`;

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const CLS_NAME = { rest: "repouso", light: "leve", vig: "intenso" };
export const CLS_LABEL = { rest: "Repouso", light: "Leve", vig: "Intenso" };
export const CLS_FILL = { rest: "var(--cat-rest)", light: "var(--cat-light)", vig: "var(--cat-vig)" };

export const hhmm = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
export const dm = (t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const weekday = (t) => new Date(t).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
export const minLabel = (m) => {
  if (!m) return "0 min";
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h}h${r ? ` ${String(r).padStart(2, "0")}` : ""}` : `${r} min`;
};
export const clockLabel = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

// Hachura de "sem dados" (ausência nunca é cor lisa).
export const hatchDef = (id) =>
  `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
  `<rect width="6" height="6" fill="var(--cat-none)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--cat-none-hatch)" stroke-width="2"/></pattern>`;

export const isWide = () => typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches;
export const canHover = () => typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

// Observa a largura do contêiner e chama draw(largura) quando muda.
export function watchWidth(el, draw) {
  let last = -1;
  const run = () => {
    const w = Math.round(el.clientWidth);
    if (w > 0 && w !== last) { last = w; draw(w); }
  };
  // o ResizeObserver já agrupa por quadro; desenhar aqui não realimenta (a altura muda, a largura não)
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(run) : null;
  ro?.observe(el);
  const onWin = () => run();
  window.addEventListener("resize", onWin);
  return {
    redraw() { last = -1; run(); },
    stop() { ro?.disconnect(); window.removeEventListener("resize", onWin); },
  };
}

// Tooltip HTML posicionado dentro do contêiner (que precisa de position: relative).
export function makeTooltip(host) {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.hidden = true;
  tip.setAttribute("role", "presentation");
  host.append(tip);
  return {
    el: tip,
    show(html, x, y) {
      tip.innerHTML = html;
      tip.hidden = false;
      const hw = host.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = x + 12, top = y - th - 10;
      if (left + tw > hw - 4) left = Math.max(4, x - tw - 12);
      if (top < 0) top = y + 16;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    },
    hide() { tip.hidden = true; },
  };
}
