// Ajuda quando o navegador não tem Bluetooth (iPhone: Bluefy; Android: Chrome; Mac: permissão).
// Mesmos textos do painel antigo.

import { h } from "./dom.js?v=10";
import { toast } from "./toast.js?v=10";

const BLUEFY_URL = "https://apps.apple.com/br/app/bluefy-web-ble-browser/id1492822055";
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(navigator.userAgent);

// "off" pode ser falso negativo (ex.: navegador sem permissão no macOS): deixa tentar mesmo assim.
export const canTryConnect = (reason) => reason === "ok" || reason === "off";

export function platformName() { return isIOS() ? "iOS" : isAndroid() ? "Android" : "desktop"; }

// Devolve o nó da ajuda para o motivo (null quando o Bluetooth está ok).
export function btHelp(reason) {
  if (reason === "ok") return null;
  const acts = h("div", { class: "actions" });
  const addBtn = (label, onClick, primary = false) => {
    const b = h("button", { class: `btn${primary ? " primary" : ""}`, type: "button" }, label);
    b.addEventListener("click", onClick); acts.append(b); return b;
  };
  const copyBtn = () => addBtn("Copiar link do painel", async () => {
    const url = `${location.origin}${location.pathname}`;
    try { await navigator.clipboard.writeText(url); toast("Link copiado.", { kind: "success" }); }
    catch { toast(`Copie o link: ${url}`, { timeout: 12000 }); }
  });
  let text;
  if (reason === "off") {
    text = /Mac/.test(navigator.platform) && !isIOS()
      ? "O navegador diz que o Bluetooth está indisponível. No Mac isso costuma ser falta de permissão: Ajustes do Sistema > Privacidade e Segurança > Bluetooth > ative o seu navegador (Chrome ou Brave), feche e abra o navegador de novo. Você pode tentar conectar mesmo assim."
      : "O navegador diz que o Bluetooth está indisponível. Confira se o Bluetooth está ligado e se o navegador tem permissão. Você pode tentar conectar mesmo assim.";
    addBtn("Recarregar", () => location.reload());
  } else if (isIOS()) {
    text = "No iPhone, o Safari e o Chrome não conseguem usar Bluetooth em sites (limitação da Apple). Instale o app gratuito Bluefy, abra ele e cole o link do painel.";
    acts.append(h("a", { class: "btn primary", href: BLUEFY_URL, target: "_blank", rel: "noopener" }, "Baixar o Bluefy"));
    copyBtn();
  } else if (isAndroid()) {
    text = "Este navegador não tem Bluetooth para sites. Abra o painel no Google Chrome.";
    acts.append(h("a", { class: "btn primary", href: `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end` }, "Abrir no Chrome"));
    copyBtn();
  } else {
    text = "Este navegador não tem Bluetooth para sites. Use o Google Chrome ou o Microsoft Edge. Você ainda pode importar arquivos .bin (em Dados).";
    copyBtn();
  }
  return h("div", { class: "bt-help", role: "note" }, h("p", {}, text), acts);
}
