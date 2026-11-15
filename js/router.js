// Roteamento por hash (plano, seção 2.2) e guard de entrada (seção 4).
// parse e guard são puras (tests/router.test.mjs). #k=CHAVE e ?k=CHAVE são lidos por
// cloud.getKey() antes do router; hashes que não começam com "#/" são tratados como vazios.

export const SECTIONS = ["visao-geral", "avancado", "sensor", "dados", "opcoes"];
export const SECTION_LABEL = {
  "visao-geral": "Visão Geral", avancado: "Avançado", sensor: "Sensor", dados: "Dados", opcoes: "Opções",
};

// Devolve { name, ... }:
//   { name: "empty" } | { name: "unknown", path }
//   { name: "onboarding", step: 1..4 | null, flow: "adicionar" | null }
//   { name: "animais" }
//   { name: "animal", animalId, section }
export function parse(hash = "") {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw.startsWith("/")) return { name: "empty" };
  const [pathPart, query = ""] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const params = new URLSearchParams(query);
  if (!parts.length) return { name: "empty" };
  if (parts[0] === "onboarding") {
    if (parts.length > 2) return { name: "unknown", path: pathPart };
    let step = null;
    if (parts[1] !== undefined) {
      step = Number(parts[1]);
      if (!Number.isInteger(step) || step < 1 || step > 4) return { name: "unknown", path: pathPart };
    }
    return { name: "onboarding", step, flow: params.get("fluxo") === "adicionar" ? "adicionar" : null };
  }
  if (parts[0] === "animais" && parts.length === 1) return { name: "animais" };
  if (parts[0] === "a" && parts[1] && parts.length <= 3) {
    const section = parts[2] || "visao-geral";
    if (!SECTIONS.includes(section)) return { name: "unknown", path: pathPart };
    return { name: "animal", animalId: parts[1], section };
  }
  return { name: "unknown", path: pathPart };
}

export const animalPath = (id, section = "visao-geral") => `#/a/${encodeURIComponent(id)}/${section}`;

// Guard de entrada. Devolve o hash para onde redirecionar, ou null (rota liberada).
// ctx = { profile, animals, draft, onboarding (liga a exigência do onboarding) }
// Regras: sem onboarding concluído vai para o onboarding; quem já concluiu só entra no
// onboarding para adicionar um animal (nunca vê o formulário de novo); rota vazia ou
// inválida vai para a grade; animal inexistente vai para a grade.
export function guard(route, { profile = null, animals = [], draft = null, onboarding = true } = {}) {
  const done = !!profile?.onboardingDone;
  if (route.name === "onboarding") {
    if (!onboarding || !done) return null;
    if (route.flow === "adicionar" || draft?.flow === "adicionar") return null;
    return "#/animais";
  }
  if (onboarding && !done) return "#/onboarding";
  if (route.name === "animais") return null;
  if (route.name === "animal") return animals.some((a) => a.id === route.animalId) ? null : "#/animais";
  return "#/animais";
}

// Roteador do navegador. resolve(route) devolve { page, ctx }; a página exporta mount(el, ctx)
// e o retorno de mount pode ter unmount(). onRoute(route) roda depois de montar.
export function startRouter({ view, resolve, guardCtx, onRoute = () => {}, onError = (e) => { throw e; } }) {
  let current = null;
  let depth = 0;

  function handle() {
    const route = parse(location.hash);
    const redirect = guard(route, guardCtx());
    if (redirect && depth < 4) {
      depth++;
      history.replaceState(null, "", `${location.pathname}${location.search}${redirect}`);
      return handle();
    }
    depth = 0;
    try { current?.inst?.unmount?.(); } catch (e) { onError(e); }
    current = null;
    view.replaceChildren();
    window.scrollTo(0, 0);
    const { page, ctx } = resolve(route);
    let inst = null;
    try { inst = page.mount(view, ctx) || null; } catch (e) { onError(e); }
    current = { route, inst };
    onRoute(route);
    return route;
  }

  window.addEventListener("hashchange", handle);
  return {
    start: handle,
    refresh: handle,
    get route() { return current?.route || parse(location.hash); },
    navigate(path, { replace = false } = {}) {
      if (location.hash === path) { handle(); return; }
      if (replace) { history.replaceState(null, "", `${location.pathname}${location.search}${path}`); handle(); }
      else location.hash = path;
    },
  };
}

// Move o foco para o título da página (leitor de tela anuncia a rota nova).
export function focusHeading(view) {
  const h1 = view.querySelector("h1");
  if (!h1) return;
  if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
  h1.focus({ preventScroll: true });
}
