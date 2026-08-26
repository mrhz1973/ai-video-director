/**
 * Issue #88 — explicit operator help text for visible controls.
 * Do not invent help from labels alone.
 */
import { setControlHelp } from "./tooltip.mjs";

export const CONTROL_HELP = Object.freeze({
  projectNew: "Crea un nuovo progetto. Il progetto corrente non viene eliminato.",
  projectSave: "Salva le modifiche del progetto corrente senza avviare alcuna generazione.",
  projectSaveAs: "Salva una copia del progetto con un nuovo nome. Non avvia render.",
  projectDelete: "Elimina il progetto selezionato dopo conferma. Non usare per rimuovere singoli asset.",
  promptClear: "Cancella solo il testo del prompt. Non modifica Input, Batch o coda.",
  promptHistoryToggle: "Mostra o nasconde la cronologia dei prompt recenti di questa sessione.",
  promptHistoryClear: "Svuota la cronologia prompt in memoria locale. Non cancella file o render.",
  send: "Invia una sola clip con prompt, Input e impostazioni correnti. Non modifica il Batch.",
  inspectorToggle: "Nasconde o ripristina l'Inspector. La larghezza salvata non viene persa.",
  tabAsset: "Apre la libreria asset (Elements, Locations, Objects, Audio).",
  tabInput: "Apre l'assegnazione Input del workflow corrente.",
  groupCreate: "Crea un nuovo gruppo nella categoria asset attiva.",
  assetDropzone: "Trascina qui i file o clicca per scegliere file da aggiungere alla libreria.",
  gpuPowerToggle: "Mostra o nasconde i profili ECO / BALANCED / NORMAL. Non cambia il limite GPU.",
  gpuEco: "Imposta il limite GPU sul profilo ECO configurato. Modifica realmente il power limit.",
  gpuBalanced: "Imposta il limite GPU sul profilo BALANCED configurato. Modifica realmente il power limit.",
  gpuNormal: "Imposta il limite GPU sul profilo NORMAL configurato. Modifica realmente il power limit.",
  gpuHelperHelp: "Mostra le istruzioni di installazione dell'helper amministrativo GPU.",
  batchPrepare: "Crea i job del Batch a partire da prompt, Input e impostazioni della Scena corrente. Non avvia generazione.",
  batchExpandAll: "Espande tutti i job preparati per modificarli.",
  batchCollapseAll: "Comprime tutti i job preparati per ridurre l'ingombro.",
  batchGlobalApply: "Copia Megapixel, Aspect e Steps globali su ogni job preparato. Non avvia render.",
  batchAdd: "Aggiunge un nuovo job al Batch preparato (duplica l'ultimo se già esistono job).",
  batchReset: "Svuota il Batch preparato. Non cancella render già completati.",
  batchAddToQueue: "Copia il Batch preparato nella Coda. Non avvia ancora la generazione.",
  batchQueue: "Avvia subito questo Batch senza passare dalla Coda multi-batch.",
  batchInterruptCurrent: "Interrompe solo il render corrente quando il Director ne possiede l'autorità.",
  batchInterruptAll: "Ferma il Batch corrente secondo le regole di ownership; non svuota indiscriminatamente la coda ComfyUI.",
  batchLegacyRecover: "Recupera un Batch locale trovato da una sessione precedente.",
  batchRuntimeToggle: "Mostra o nasconde i dettagli dell'ultima esecuzione Batch.",
  batchQueueArm: "Avvia l'esecuzione sequenziale dei Batch attualmente in coda.",
  batchQueueResume: "Riprende la coda dopo pausa o recovery, senza reinventare il piano.",
  batchQueueInterruptCurrent: "Interrompe solo il job corrente della coda quando il Director ne ha l'autorità.",
  batchQueueInterruptAll: "Ferma il Batch in esecuzione nella coda secondo le regole di ownership.",
  archiveChooseFolder: "Scegli la cartella di destinazione dell'archivio locale Director.",
  archiveOpenFolder: "Apre la cartella archivio configurata nel file manager.",
  cloudMirrorChooseFolder: "Scegli la cartella locale sincronizzata usata come mirror cloud.",
  cloudMirrorOpenFolder: "Apre la cartella mirror cloud configurata.",
  cloudMirrorEnabled: "Attiva o disattiva la copia automatica nella cartella cloud locale.",
  sessionGalleryClear: "Rimuove solo l'elenco clip in memoria sessione; non cancella i file.",
  sessionOpenVideo: "Apre il video originale in una nuova scheda.",
  sessionDownloadMp4: "Scarica il file MP4 originale senza ricodifica.",
  sessionShowFolder: "Apre la cartella del file originale e lo seleziona. Non copia né sposta il video.",
  sessionCloudCopy: "Copia il file nella cartella locale sincronizzata configurata. Non garantisce che il provider cloud abbia già completato l'upload remoto.",
  lightboxClose: "Chiude l'anteprima grande senza modificare assegnazioni o progetto.",
  workflowScena: "Vista Scena: prompt, Input e generazione singola.",
  workflowBatch: "Vista Batch: prepara più job dalla Scena senza avviarli automaticamente.",
  workflowCoda: "Vista Coda: esecuzione sequenziale dei Batch in coda.",
  workflowOutput: "Vista Output: clip di sessione, archivio e mirror cloud.",
  moveUp: "Sposta l'elemento verso l'alto nell'ordine.",
  moveDown: "Sposta l'elemento verso il basso nell'ordine.",
  duplicate: "Duplica questo elemento.",
  remove: "Rimuove questo elemento dall'elenco preparato o dalla libreria (non cancella file ComfyUI).",
  memberRemove: "Rimuove il membro dal gruppo libreria. Non cancella il file da ComfyUI.",
  addFile: "Aggiunge file immagine o audio al gruppo selezionato."
});

export function applyStaticControlHelp(documentRef = typeof document !== "undefined" ? document : null) {
  if (!documentRef?.getElementById) return;
  const map = {
    projectNew: CONTROL_HELP.projectNew,
    projectSave: CONTROL_HELP.projectSave,
    projectSaveAs: CONTROL_HELP.projectSaveAs,
    projectDelete: CONTROL_HELP.projectDelete,
    promptClear: CONTROL_HELP.promptClear,
    promptHistoryToggle: CONTROL_HELP.promptHistoryToggle,
    promptHistoryClear: CONTROL_HELP.promptHistoryClear,
    send: CONTROL_HELP.send,
    inspectorToggle: CONTROL_HELP.inspectorToggle,
    "tab-asset": CONTROL_HELP.tabAsset,
    "tab-input": CONTROL_HELP.tabInput,
    groupCreate: CONTROL_HELP.groupCreate,
    assetDropzone: CONTROL_HELP.assetDropzone,
    gpuPowerToggle: CONTROL_HELP.gpuPowerToggle,
    gpuPowerHelperHelp: CONTROL_HELP.gpuHelperHelp,
    batchPrepare: CONTROL_HELP.batchPrepare,
    batchExpandAll: CONTROL_HELP.batchExpandAll,
    batchCollapseAll: CONTROL_HELP.batchCollapseAll,
    batchGlobalApply: CONTROL_HELP.batchGlobalApply,
    batchAdd: CONTROL_HELP.batchAdd,
    batchReset: CONTROL_HELP.batchReset,
    batchAddToQueue: CONTROL_HELP.batchAddToQueue,
    batchQueue: CONTROL_HELP.batchQueue,
    batchInterruptCurrent: CONTROL_HELP.batchInterruptCurrent,
    batchInterruptAll: CONTROL_HELP.batchInterruptAll,
    batchLegacyRecover: CONTROL_HELP.batchLegacyRecover,
    batchQueueArm: CONTROL_HELP.batchQueueArm,
    batchQueueResume: CONTROL_HELP.batchQueueResume,
    batchQueueInterruptCurrent: CONTROL_HELP.batchQueueInterruptCurrent,
    batchQueueInterruptAll: CONTROL_HELP.batchQueueInterruptAll,
    archiveChooseFolder: CONTROL_HELP.archiveChooseFolder,
    archiveOpenFolder: CONTROL_HELP.archiveOpenFolder,
    cloudMirrorChooseFolder: CONTROL_HELP.cloudMirrorChooseFolder,
    cloudMirrorOpenFolder: CONTROL_HELP.cloudMirrorOpenFolder,
    cloudMirrorEnabled: CONTROL_HELP.cloudMirrorEnabled,
    sessionGalleryClear: CONTROL_HELP.sessionGalleryClear
  };
  for (const [id, text] of Object.entries(map)) {
    const el = documentRef.getElementById(id);
    if (el) setControlHelp(el, text);
  }
  for (const btn of documentRef.querySelectorAll?.("[data-gpu-power-mode]") || []) {
    const mode = btn.getAttribute("data-gpu-power-mode");
    if (mode === "eco") setControlHelp(btn, CONTROL_HELP.gpuEco);
    else if (mode === "balanced") setControlHelp(btn, CONTROL_HELP.gpuBalanced);
    else if (mode === "normal") setControlHelp(btn, CONTROL_HELP.gpuNormal);
  }
  for (const btn of documentRef.querySelectorAll?.("[data-workflow-view]") || []) {
    const view = btn.getAttribute("data-workflow-view");
    if (view === "scena") setControlHelp(btn, CONTROL_HELP.workflowScena);
    else if (view === "batch") setControlHelp(btn, CONTROL_HELP.workflowBatch);
    else if (view === "coda") setControlHelp(btn, CONTROL_HELP.workflowCoda);
    else if (view === "output") setControlHelp(btn, CONTROL_HELP.workflowOutput);
  }
}

/** Inventory helper for tests: buttons/links/role=button that should carry help. */
export function inventoryActionControls(root) {
  const nodes = [];
  const selector = "button, a[href], [role='button'], summary.h3-disclosure-summary";
  for (const el of root.querySelectorAll?.(selector) || []) {
    if (el.hidden) continue;
    if (el.getAttribute?.("aria-hidden") === "true") continue;
    nodes.push(el);
  }
  return nodes;
}

export function controlsMissingHelp(root) {
  return inventoryActionControls(root).filter(el => {
    const wrap = el.closest?.("[data-help-wrap='1']");
    if (wrap?.getAttribute?.("data-help")) return false;
    return !String(el.getAttribute?.("data-help") || "").trim();
  });
}
