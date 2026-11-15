// Posição de um popover preso à tela (puro, testado em tests/place.test.mjs).
// btn: retângulo do botão (viewport). size: { width, height } do popover. vp: { width, height }.
// Alinha a borda direita com a do botão; se não couber, empurra para dentro (margem de 16 px).
// Abre abaixo; se não couber abaixo e couber acima, abre acima; senão fica preso na tela.
export function placePopover(btn, size, vp, { gap = 6, margin = 16 } = {}) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  const left = clamp(btn.right - size.width, margin, Math.max(margin, vp.width - margin - size.width));
  const below = btn.bottom + gap;
  const aboveTop = btn.top - gap - size.height;
  let top, above = false;
  if (below + size.height <= vp.height - margin) top = below;
  else if (aboveTop >= margin) { top = aboveTop; above = true; }
  else top = clamp(below, margin, Math.max(margin, vp.height - margin - size.height));
  return { left, top, above };
}
