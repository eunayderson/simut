// Exportações em CSV (puras, testadas em tests/export.test.mjs).

import { toCsv } from "./analysis.js?v=10";
import { stateById } from "./validation.js?v=10";

// "Simut Júnior" -> "simut-junior"
export const slug = (s) => String(s || "animal").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "animal";

// CSV das janelas: formato antigo intacto, coluna "animal" acrescentada no fim.
export function windowsCsv(epochs, animalId) {
  return toCsv(epochs).split("\n").map((l, i) => `${l},${i === 0 ? "animal" : animalId}`).join("\n");
}

// CSV das marcações: horário ISO e local, estado e classe esperada.
export function marksCsv(marks) {
  const rows = ["inicio_iso,inicio_local,estado,classe"];
  for (const m of [...marks].sort((a, b) => a.t - b.t)) {
    const d = new Date(m.t);
    rows.push(`${d.toISOString()},"${d.toLocaleString("pt-BR")}",${m.s},${m.s === "fim" ? "" : stateById[m.s]?.cls ?? ""}`);
  }
  return rows.join("\n");
}
