// Diagnóstico: buffer das últimas 400 linhas, com assinatura para quem mostra o log.

const MAX = 400;
const lines = [];
const subs = new Set();

export function log(msg) {
  const line = `${new Date().toLocaleTimeString("pt-BR")}  ${msg}`;
  lines.push(line);
  if (lines.length > MAX) lines.shift();
  for (const fn of subs) {
    try { fn(line, lines); } catch { /* um assinante com erro não derruba o log */ }
  }
  return line;
}

export const logLines = () => lines.slice();
export const logText = () => lines.join("\n");

// subscribe((linha, todas) => ...) devolve a função que cancela.
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
