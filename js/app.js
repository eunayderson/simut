// Bootstrap do painel: lê a chave da nuvem, carrega e migra os dados, monta o shell,
// inicia o roteador e a nuvem. As páginas recebem ctx = { state, animal, route, navigate, log, app }.

import { bluetoothSupport, hex } from "./ble.js?v=10";
import { log } from "./log.js?v=10";
import { getSensor, run as runSync } from "./sync.js?v=10";
import { saveSync, loadSyncs, clearAll, saveSettings, migrateLastSync, clearLastSyncs, saveLastAnimal, loadDraft } from "./store.js?v=10";
import { migrateLocal, mergeAnimals, mergeProfile, findAnimal, sensorDecision, associateSensor, LEGACY_ANIMAL_ID } from "./animals.js?v=10";
import { load as loadOnboardingEvents, save as saveOnboardingEvents } from "./metrics.js?v=10";
import { saveMarks } from "./validation.js?v=10";
import { getKey, syncAll, mergeMarks, pullProfileAndAnimals, syncProfileAndAnimals, mergeOnboarding } from "./cloud.js?v=10";
import { state, on, emit, recompute, setAnimal, currentAnimal, upsertAnimal, setAnimals, setProfile } from "./state.js?v=10";
import { startRouter, focusHeading, parse } from "./router.js?v=10";
import { createNav } from "./ui/nav.js?v=10";
import { toast } from "./ui/toast.js?v=10";
import { openModal } from "./ui/modal.js?v=10";
import { h } from "./ui/dom.js?v=10";
import { platformName } from "./ui/bt-help.js?v=10";
import { VERSION } from "./version.js?v=10";

import * as animaisPage from "./pages/animais.js?v=10";
import * as visaoGeralPage from "./pages/visao-geral.js?v=10";
import * as avancadoPage from "./pages/avancado.js?v=10";
import * as sensorPage from "./pages/sensor.js?v=10";
import * as dadosPage from "./pages/dados.js?v=10";
import * as opcoesPage from "./pages/opcoes.js?v=10";
import * as onboardingPage from "./pages/onboarding.js?v=10";

export { VERSION };

const $ = (id) => document.getElementById(id);

// ---------- erros visíveis ----------
function showError(msg) {
  if (/ResizeObserver loop/.test(String(msg))) return; // aviso benigno do navegador, não é erro do painel
  const b = $("errBanner");
  if (b) { b.hidden = false; b.textContent = `Erro: ${msg}`; }
}
window.addEventListener("error", (e) => showError(e.message));
window.addEventListener("unhandledrejection", (e) => showError(e.reason?.message || String(e.reason)));

// pular para o conteúdo sem mexer no hash (o hash é a rota)
$("skipLink")?.addEventListener("click", (e) => { e.preventDefault(); $("view").focus(); });

// ---------- sensor (um toque: conecta, baixa, salva e desconecta; js/sync.js) ----------
const sensor = getSensor(log);

function setSensorUi(patch) {
  state.sensorUi = { ...state.sensorUi, ...patch };
  emit("sensor");
}
sensor.addEventListener("disconnect", () => { if (!state.sensorUi.busy) setSensorUi({ phase: "off", text: "Sensor desconectado (economizando bateria)" }); });

// Sensor e animal (plano, 3.3): associa sensor novo, pergunta quando o sensor é de outro animal.
// Devolve o animal que fica com o download; o download nunca é descartado.
async function confirmSensor(name, animalId) {
  const animal = findAnimal(state.animals, animalId);
  const d = sensorDecision(state.animals, name, animalId);
  if (!animal || d.action === "ok") return animalId;
  if (d.action === "associate") {
    saveAnimal(associateSensor(animal, name));
    toast(`Sensor ${name} associado a ${animal.name}.`, { kind: "success" });
    log(`sensor ${name} associado a ${animal.id}`);
    return animalId;
  }
  const owner = d.owner;
  const choice = await openModal({
    title: "Sensor de outro animal",
    body: h("div", {},
      h("p", {}, `Este sensor (`, h("span", { class: "mono" }, name), `) está associado a ${owner.name}. Salvar este download para ${animal.name} mesmo assim?`),
      h("p", { class: "small muted" }, "O download já foi feito e não será perdido em nenhuma das opções.")),
    dismissValue: "keep",
    actions: [
      { label: `Trocar para ${owner.name}`, value: "owner", kind: "secondary" },
      { label: `Salvar para ${animal.name}`, value: "mine", kind: "primary", autofocus: true },
    ],
  });
  if (choice === "owner") { log(`download de ${name} salvo para ${owner.id} (dono do sensor)`); return owner.id; }
  if (choice === "mine") { saveAnimal(associateSensor(animal, name)); log(`sensor ${name} associado também a ${animal.id}`); }
  return animalId;
}

async function syncSensor({ withToast = false } = {}) {
  const animal = currentAnimal();
  if (!animal || state.sensorUi.busy) return null;
  const t = withToast ? toast("Procurando sensor...", { persistent: true }) : null;
  setSensorUi({ busy: true, error: null, pct: null, progress: "" });
  try {
    const r = await runSync({
      animalId: animal.id,
      sensor, log,
      confirmSensor,
      onState: (phase, text) => { setSensorUi({ phase, text }); t?.update(text); },
      onProgress: ({ pct, text }) => {
        setSensorUi({ pct: pct ?? state.sensorUi.pct, progress: text });
        if (t && pct !== null) t.progress(pct, text);
      },
      onInfo: ({ clock, level }) => setSensorUi({ clock: clock ? clock.getTime() : null, level }),
    });
    setSensorUi({ busy: false });
    t?.update(r.text, { kind: "success", timeout: 6000 });
    await reload();
    cloudSync();
    if (r.animalId && r.animalId !== animal.id) navigate(`#/a/${r.animalId}/sensor`);
    return r;
  } catch (e) {
    const cancelled = e.name === "NotFoundError";
    setSensorUi({ busy: false, error: cancelled ? null : e.message, progress: cancelled ? "" : `Erro: ${e.message}` });
    if (t) { if (cancelled) t.update("Nenhum sensor escolhido.", { timeout: 4000 }); else t.update(`Erro: ${e.message}`, { kind: "error", timeout: 10000 }); }
    return null;
  }
}

// ---------- dados ----------
async function reload() {
  try { state.syncs = await loadSyncs(); }
  catch (e) { log(`armazenamento indisponível: ${e.message}`); state.syncs = []; }
  recompute();
}

// Importa .bin gerado pelo script do Mac. Formato: repetição de [tamanho u16 LE][pacote].
async function importBin(file) {
  const animal = currentAnimal();
  if (!file || !animal) return 0;
  const buf = new Uint8Array(await file.arrayBuffer());
  const packets = [];
  for (let i = 0; i + 2 <= buf.length;) {
    const n = buf[i] | (buf[i + 1] << 8); i += 2;
    if (n < 9 || i + n > buf.length) break;
    packets.push(buf.slice(i, i + n)); i += n;
  }
  if (!packets.length) return 0;
  const endAt = file.lastModified || Date.now();
  await saveSync({ id: Date.now(), endAt, source: `arquivo ${file.name}`, packets, animalId: animal.id });
  log(`importado ${file.name}: ${packets.length} pacotes (${animal.name})`);
  await reload();
  cloudSync();
  return packets.length;
}

// "Apagar dados deste aparelho": mesmo comportamento do painel antigo (downloads e últimos downloads).
async function clearLocal() {
  await clearAll();
  clearLastSyncs();
  log("dados deste aparelho apagados (downloads)");
  await reload();
}

function updateSettings(global) {
  state.settings = global;
  saveSettings(global);
  emit("settings");
  recompute();
}

function saveAnimal(animal) {
  const a = upsertAnimal(animal);
  if (a.id === state.animalId) recompute();
  cloudSync();
  return a;
}

function saveProfile(p) {
  setProfile({ ...p, updatedAt: Date.now() });
  cloudSync();
}

// ---------- nuvem ----------
function cloudUi(text, ok = null) {
  state.cloud = { text, ok };
  emit("cloud");
}
let cloudAgain = false;
async function cloudSync() {
  if (!state.cloudKey) { cloudUi("Desligada"); return; }
  if (state.cloudBusy) { cloudAgain = true; return; }
  state.cloudBusy = true;
  cloudUi("Sincronizando...");
  try {
    const r = await syncAll(state.cloudKey, state.syncs, log);
    for (const s of r.down) await saveSync(s);
    state.marks.splice(0, state.marks.length, ...(await mergeMarks(state.cloudKey, state.marks)));
    saveMarks(state.marks);
    const pa = await syncProfileAndAnimals(state.cloudKey, { profile: state.profile, animals: state.animals }, log);
    setAnimals(pa.animals);
    if (pa.profile) setProfile(pa.profile);
    saveOnboardingEvents(await mergeOnboarding(state.cloudKey, loadOnboardingEvents()));
    if (r.down.length) await reload(); else emit("data");
    cloudUi(`Salva, ${r.total} ${r.total === 1 ? "download" : "downloads"} (${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`, true);
  } catch (e) {
    log(`erro na nuvem: ${e.message}`);
    cloudUi(navigator.onLine ? `Erro: ${e.message}` : "Sem internet, tento de novo depois", false);
  } finally {
    state.cloudBusy = false;
    if (cloudAgain) { cloudAgain = false; cloudSync(); }
  }
}
window.addEventListener("online", () => cloudSync());

// Com chave: traz perfil e animais da nuvem antes de decidir qualquer coisa (até 4 s).
// Um aparelho novo aberto pelo link já vê o que foi cadastrado em outro. Se falhar, segue com o local.
async function pullCloudProfile() {
  if (!state.cloudKey) return;
  try {
    const r = await pullProfileAndAnimals(state.cloudKey, { timeoutMs: 4000 });
    const a = mergeAnimals(state.animals, r.animals);
    setAnimals(a.animals);
    const p = mergeProfile(state.profile, r.profile);
    if (p.profile) setProfile(p.profile);
  } catch (e) { log(`nuvem (perfil e animais): ${e.message}`); }
}

// Dados antigos (sem animalId) pertencem ao Simut. Só cria o animal; nada é apagado.
function migrate() {
  migrateLastSync();
  const m = migrateLocal({ syncs: state.syncs, marks: state.marks, animals: state.animals, profile: state.profile, hasCloudKey: !!state.cloudKey });
  if (m.changed) log(`migração: animal ${LEGACY_ANIMAL_ID} criado com ${state.syncs.length} download(s)`);
  if (m.changed) setAnimals(m.animals);
  state.hasLegacyData = m.hasLegacyData;
}

// ---------- shell e rotas ----------
const view = $("view");
const nav = createNav();
const PAGES = {
  "visao-geral": visaoGeralPage, avancado: avancadoPage, sensor: sensorPage, dados: dadosPage, opcoes: opcoesPage,
};
const app = { syncSensor, reload, importBin, clearLocal, updateSettings, saveAnimal, saveProfile, cloudSync };

function resolve(route) {
  const base = { state, route, navigate, log, app };
  if (route.name === "onboarding") return { page: onboardingPage, ctx: base };
  if (route.name === "animal") {
    setAnimal(route.animalId);
    saveLastAnimal(route.animalId);
    return { page: PAGES[route.section], ctx: { ...base, animal: currentAnimal() } };
  }
  return { page: animaisPage, ctx: base };
}

let router = null;
function navigate(path, opts) { router?.navigate(path, opts); }

function onRoute(route) {
  nav.update({ route, animal: route.name === "animal" ? currentAnimal() : null });
  document.title = route.name === "animal" ? `${currentAnimal()?.name || "Animal"} | SIMUT` : route.name === "onboarding" ? "Boas-vindas | SIMUT" : "Seus animais | SIMUT";
  focusHeading(view);
}

// O nome do animal na navegação acompanha edições.
on((reason) => {
  if (reason !== "animals" || !router) return;
  const r = router.route;
  if (r.name === "animal") nav.update({ route: r, animal: currentAnimal() });
});

// ---------- início ----------
(async () => {
  state.cloudKey = getKey();
  bluetoothSupport().then((bt) => {
    state.bt = bt;
    log(`painel iniciado (bluetooth: ${bt}${bt === "ok" ? "" : `, ${platformName()}`})`);
    emit("sensor");
  });
  await reload();
  await pullCloudProfile();
  migrate();
  router = startRouter({
    view, resolve, onRoute,
    guardCtx: () => ({ profile: state.profile, animals: state.animals, draft: loadDraft(), onboarding: true }),
    onError: (e) => { log(`erro na página: ${e.message}`); showError(e.message); console.error(e); },
  });
  router.start();
  cloudUi(state.cloudKey ? "Conectando..." : "Desligada");
  cloudSync();
})();

// depuração no console (mantém os nomes do painel antigo)
const showBtHelp = (reason) => { state.bt = reason; emit("sensor"); };
window.simut = { state, recompute, hex, showBtHelp, navigate, parse, get route() { return router?.route; } };
