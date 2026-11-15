import { test } from "node:test";
import assert from "node:assert/strict";
import { placePopover } from "../js/ui/place.js";

const vp = { width: 360, height: 640 };

test("placePopover: cabe abaixo e alinhado à direita do botão", () => {
  const p = placePopover({ left: 300, right: 324, top: 100, bottom: 124 }, { width: 200, height: 120 }, vp);
  assert.deepEqual(p, { left: 124, top: 130, above: false });
});

test("placePopover: nunca sai pela esquerda nem pela direita (margem de 16 px)", () => {
  const left = placePopover({ left: 10, right: 34, top: 100, bottom: 124 }, { width: 320, height: 100 }, vp);
  assert.equal(left.left, 16);
  const right = placePopover({ left: 340, right: 364, top: 100, bottom: 124 }, { width: 328, height: 100 }, vp);
  assert.equal(right.left + 328 <= 360 - 16, true);
});

test("placePopover: abre para cima quando não cabe abaixo", () => {
  const p = placePopover({ left: 100, right: 124, top: 560, bottom: 584 }, { width: 200, height: 200 }, vp);
  assert.equal(p.above, true);
  assert.equal(p.top, 560 - 6 - 200);
});

test("placePopover: maior que a tela fica preso dentro dela", () => {
  const p = placePopover({ left: 100, right: 124, top: 300, bottom: 324 }, { width: 200, height: 900 }, vp);
  assert.equal(p.top, 16);
});
