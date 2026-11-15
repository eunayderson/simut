// Formatação para a interface (pt-BR). Funções puras.

// 0 -> "0 min", 45 -> "45 min", 90 -> "1h 30", 120 -> "2h"
export function fmtMin(m) {
  if (!m) return "0 min";
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h}h${r ? ` ${String(r).padStart(2, "0")}` : ""}` : `${r} min`;
}

export const hhmm = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// "14/11"
export const fmtDayMonth = (t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };

// "14/11/2026"
export const fmtDate = (t) => new Date(t).toLocaleDateString("pt-BR");

// "14/11/2026, 21:03:00"
export const fmtDateTime = (t) => new Date(t).toLocaleString("pt-BR");

// "14/11 21:03"
export const fmtShort = (t) => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// "sex., 14/11"
export const fmtWeekday = (t) => new Date(t).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

export const isSameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
export const isToday = (t, now = Date.now()) => isSameDay(t, now);

// plural(1, "download") -> "1 download"; plural(2, "momento ativo", "momentos ativos")
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

export const fmtInt = (n) => Number(n || 0).toLocaleString("pt-BR");

export const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "-");

// Número decimal em pt-BR: 12.5 -> "12,5"
export const fmtDec = (v, digits = 1) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: digits }) : "-");

export const CLS_NAME = { rest: "repouso", light: "leve", vig: "intenso" };
export const CLS_LABEL = { rest: "Repouso", light: "Leve", vig: "Intenso" };
