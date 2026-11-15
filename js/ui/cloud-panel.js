// Painel da nuvem (chave, conectar, sincronizar agora, link, desconectar) como módulo montável.
// Mesmos ids do painel antigo. A chave nunca é exibida.
//
// ctx = {
//   state,          // { cloudKey }
//   sync(),         // sincroniza tudo com a nuvem (definido pelo app)
//   statusEls,      // elementos extras que mostram o estado (ex.: #kvCloud)
//   log, ui: { confirm, alert, prompt } (padrão: diálogos nativos)
// }

import { setKey, forgetKey } from "../cloud.js?v=10";

const nativeUi = {
  confirm: async (text) => window.confirm(text),
  alert: async (text) => window.alert(text),
  prompt: async (text, value) => window.prompt(text, value),
};

export const KEY_PATTERN = /^[A-Za-z0-9_-]{30,}$/;

export function mount(el, ctx) {
  const state = ctx.state;
  const ui = { ...nativeUi, ...(ctx.ui || {}) };
  const statusEls = ctx.statusEls || [];
  const $ = (id) => el.querySelector(`#${id}`);

  el.innerHTML = `
    <h3>Nuvem</h3>
    <p class="small" id="cloudStatus" aria-live="polite" hidden></p>
    <div id="cloudOff" hidden>
      <p class="small muted">Este aparelho está conectado à nuvem do Simut. Para conectar outro aparelho, copie o link e abra lá uma vez.</p>
      <div class="actions">
        <button class="btn" id="cloudNow" type="button">Sincronizar nuvem agora</button>
        <button class="btn" id="cloudLink" type="button">Copiar link para outro aparelho</button>
        <button class="btn ghost danger" id="cloudForget" type="button">Desconectar deste aparelho</button>
      </div>
    </div>
    <div id="cloudOn">
      <p class="small muted">Cole a chave do Simut para guardar e juntar os dados de todos os aparelhos na nuvem.</p>
      <div class="actions">
        <input class="key-input" id="cloudKeyInput" type="password" placeholder="Chave do Simut" aria-label="Chave do Simut" autocomplete="off">
        <button class="btn primary" id="cloudConnect" type="button">Conectar nuvem</button>
      </div>
    </div>`;

  let last = { text: state.cloudKey ? "Conectando..." : "Desligada", ok: null };

  function setStatus(text, ok = null) {
    last = { text, ok };
    for (const s of [...statusEls, ctx.showInline ? $("cloudStatus") : null].filter(Boolean)) {
      s.textContent = text;
      s.dataset.ok = ok === null ? "" : String(ok);
    }
    if (ctx.showInline) $("cloudStatus").hidden = false;
    $("cloudOn").hidden = !!state.cloudKey;
    $("cloudOff").hidden = !state.cloudKey;
  }

  $("cloudConnect").addEventListener("click", () => {
    const k = $("cloudKeyInput").value.trim();
    if (!KEY_PATTERN.test(k)) { setStatus(`Chave inválida (${k.length} caracteres). Cole de novo, sem espaços.`, false); return; }
    setKey(k); state.cloudKey = k; $("cloudKeyInput").value = ""; ctx.sync?.();
  });
  $("cloudKeyInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("cloudConnect").click(); });
  $("cloudLink").addEventListener("click", async () => {
    const link = `${location.origin}${location.pathname}#k=${state.cloudKey}`;
    try { await navigator.clipboard.writeText(link); await ui.alert("Link copiado. Abra esse link uma vez no outro aparelho e ele já fica conectado à nuvem. Não compartilhe com outras pessoas."); }
    catch { await ui.prompt("Copie o link (não compartilhe):", link); }
  });
  $("cloudNow").addEventListener("click", () => ctx.sync?.());
  $("cloudForget").addEventListener("click", async () => {
    if (!(await ui.confirm("Desconectar este aparelho da nuvem? Os dados continuam na nuvem e neste navegador."))) return;
    forgetKey(); state.cloudKey = null; setStatus("Desligada");
  });

  setStatus(last.text, last.ok);
  return { setStatus, get status() { return last; }, unmount() { el.replaceChildren(); } };
}
