import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, windowsCsv, marksCsv } from "../js/export.js";
import { toCsv } from "../js/analysis.js";
import { epochsFrom, at } from "./helpers.mjs";

test("slug tira acentos e espaços", () => {
  assert.equal(slug("Simut Júnior"), "simut-junior");
  assert.equal(slug("  Mia!! "), "mia");
  assert.equal(slug(""), "animal");
});

test("windowsCsv mantém as colunas antigas e acrescenta animal no fim", () => {
  const ep = epochsFrom(at(10), ["rest", "vig"]);
  const old = toCsv(ep).split("\n");
  const rows = windowsCsv(ep, "simut").split("\n");
  assert.equal(rows[0], `${old[0]},animal`);
  assert.equal(rows[1], `${old[1]},simut`);
  assert.equal(rows.length, 3);
});

test("marksCsv traz estado e classe esperada, fim sem classe, em ordem de tempo", () => {
  const rows = marksCsv([{ t: at(10, 5), s: "fim" }, { t: at(10), s: "trotando", a: "a-1" }]).split("\n");
  assert.equal(rows[0], "inicio_iso,inicio_local,estado,classe");
  assert.match(rows[1], /,trotando,vig$/);
  assert.match(rows[2], /,fim,$/);
});
