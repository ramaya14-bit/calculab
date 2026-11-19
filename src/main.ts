// Punto de entrada: conecta cámara → MediaPipe → gestos → matemática → interfaz.

import { DrawingUtils, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { HandSides, type IdentifiedHand, type Side } from './handSides';
import { startCamera, cameraErrorMessage } from './camera';
import { createHandTracker, detectHands } from './handTracker';
import { countFingers } from './fingers';
import { Stabilizer } from './stabilizer';
import { HandControl, type ControlGesture } from './handControl';
import { View } from './view';
import { drawGrid } from './graph';
import { checkDerivatives, nearestDefined, type MathFunction } from './math';
import { DEFAULT_EXPRESSION, EXAMPLES, parseFunction, quickInspectInput } from './parser';
import {
  clearUserTemplates,
  HandwritingPad,
  loadGeminiKey,
  loadUserTemplates,
  recognizeLocal,
  recognizeWithGemini,
  saveGeminiKey,
  teachSymbol,
  TRAINABLE_SYMBOLS,
} from './handwriting';
import { MODE_NAMES, renderMode } from './modes';
import { CurveParticles } from './particles';
import { ChallengeRunner } from './challenge';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const overlay = $<HTMLCanvasElement>('overlay');
const overlayCtx = overlay.getContext('2d')!;
const graph = $<HTMLCanvasElement>('graph');
const graphCtx = graph.getContext('2d')!;
const btnCamera = $<HTMLButtonElement>('btn-camera');
const btnReset = $<HTMLButtonElement>('btn-reset');
const btnNewChallenge = $<HTMLButtonElement>('btn-new-challenge');
const msg = $('viewport-msg');
const modeIndicator = $('mode-indicator');
const results = $('results');
const fingersDebug = $('fingers-debug');
const controlStatus = $('control-status');
const help = $<HTMLDetailsElement>('ayuda');
const modeButtons = document.querySelectorAll<HTMLButtonElement>('[data-mode]');

const CONTROL_TEXT: Record<ControlGesture, string> = {
  agarrar: 'Mano izquierda: ✊ desplazando la vista',
  zoom: 'Mano izquierda: ☝ zoom con la pinza',
  libre: 'Mano izquierda: ✋ libre',
};

// ---------- Estado de la aplicación ----------
let fn: MathFunction = parseFunction(DEFAULT_EXPRESSION);
const view = new View();
const control = new HandControl();
const handSides = new HandSides();
const particles = new CurveParticles();
const challenge = new ChallengeRunner();
const modeStabilizer = new Stabilizer(8, 0);
const drawer = new DrawingUtils(overlayCtx);
let tracker: HandLandmarker | null = null;

let mode = 0;           // interacción activa (0 = explorar)
let lastHandMode = 0;   // último modo confirmado por la mano
let a = 1.5;            // punto x = a sobre la gráfica
let lastResults = '';

// ---------- Cambiar la función ----------
const fnForm = $<HTMLFormElement>('fn-form');
const fnInput = $<HTMLInputElement>('fn-input');
const fnNotice = $('fn-notice');
const fnError = $('fn-error');
const btnEqZero = $<HTMLButtonElement>('btn-eq-zero');
const btnDraw = $<HTMLButtonElement>('btn-draw');
const derivativeWarning = $('derivative-warning');

function updateLiveNotice(text: string) {
  const info = quickInspectInput(text);
  if (!info) {
    fnNotice.hidden = true;
    fnNotice.textContent = '';
    fnNotice.classList.remove('indeterminate');
    return;
  }
  fnNotice.hidden = false;
  fnNotice.textContent = info.message;
  fnNotice.classList.toggle('indeterminate', info.kind === 'indeterminate');
}

function applyFunction(expression: string) {
  try {
    fn = parseFunction(expression);
  } catch (err) {
    // Expresión inválida: se avisa y se conserva la función anterior
    fnError.hidden = false;
    fnError.textContent = (err as Error).message;
    return;
  }
  fnError.hidden = true;
  fnInput.value = expression;
  btnEqZero.classList.toggle('active', fn.isEquation);
  updateLiveNotice(expression);
  lastResults = '';

  // Verificación: las derivadas simbólicas deben coincidir con las numéricas
  if (fn.globalIndetermination) {
    derivativeWarning.hidden = true;
    derivativeWarning.textContent = '';
  } else {
    const errors = checkDerivatives(fn);
    derivativeWarning.hidden = errors.length === 0;
    derivativeWarning.textContent = errors.length ? '⚠ Revisa las derivadas: ' + errors.join(' · ') : '';
  }

  // Si hay un límite en x -> p, ubicamos x = a en p; si no, donde f esté definida
  if (typeof fn.limitTarget === 'number') {
    a = fn.limitTarget;
  } else if (!fn.globalIndetermination) {
    a = nearestDefined(fn.f, 1.5);
  }
  if (mode === 5) challenge.newChallenge(fn, view);
}

fnInput.addEventListener('input', () => {
  fnError.hidden = true;
  updateLiveNotice(fnInput.value);
});

fnForm.addEventListener('submit', (e) => {
  e.preventDefault();
  applyFunction(fnInput.value);
  fnInput.blur(); // devuelve el teclado a los atajos (1–5, flechas…)
});

// Botón rápido "= 0": iguala la expresión actual a 0 (o quita "= 0" si ya está)
btnEqZero.addEventListener('click', () => {
  const raw = fnInput.value.trim();
  if (!raw) return;
  const next = /=\s*0\s*$/.test(raw)
    ? raw.replace(/\s*=\s*0\s*$/, '').trim()
    : raw.includes('=')
      ? raw
      : `${raw} = 0`;
  applyFunction(next);
});

// ---------- Modal de escritura a mano ----------
const drawModal = $('draw-modal');
const drawClose = $<HTMLButtonElement>('draw-close');
const drawCanvas = $<HTMLCanvasElement>('draw-canvas');
const drawUndo = $<HTMLButtonElement>('draw-undo');
const drawClear = $<HTMLButtonElement>('draw-clear');
const drawRecognize = $<HTMLButtonElement>('draw-recognize');
const drawApplyNow = $<HTMLButtonElement>('draw-apply-now');
const drawRecognized = $<HTMLInputElement>('draw-recognized');
const drawUse = $<HTMLButtonElement>('draw-use');
const drawPreview = $('draw-preview');
const drawError = $('draw-error');
const teachSymbolSelect = $<HTMLSelectElement>('teach-symbol');
const teachSave = $<HTMLButtonElement>('teach-save');
const teachReset = $<HTMLButtonElement>('teach-reset');
const geminiKeyInput = $<HTMLInputElement>('gemini-key');
const geminiSave = $<HTMLButtonElement>('gemini-save');

const pad = new HandwritingPad(drawCanvas);

function refreshTeachSelect() {
  const templates = loadUserTemplates();
  const prev = teachSymbolSelect.value;
  teachSymbolSelect.innerHTML = TRAINABLE_SYMBOLS.map(
    (s) => `<option value="${s}">${s} (${(templates[s] || []).length} ✓)</option>`,
  ).join('');
  if (prev) teachSymbolSelect.value = prev;
}
refreshTeachSelect();
geminiKeyInput.value = loadGeminiKey();

function updateDrawPreview(expr: string) {
  const text = expr.trim();
  drawError.hidden = true;
  if (!text) {
    drawPreview.hidden = true;
    drawPreview.textContent = '';
    return;
  }
  try {
    const parsed = parseFunction(text);
    drawPreview.hidden = false;
    drawPreview.classList.toggle('indeterminate', Boolean(parsed.globalIndetermination));
    if (parsed.globalIndetermination) {
      drawPreview.textContent = `⚠ ${parsed.globalIndetermination.title} (${parsed.globalIndetermination.form})`;
    } else if (parsed.isEquation) {
      drawPreview.textContent = `Ecuación: ${parsed.equationText}`;
    } else {
      drawPreview.textContent = `Vista previa: ${parsed.fText}`;
    }
  } catch (err) {
    drawPreview.hidden = true;
    drawError.hidden = false;
    drawError.textContent = (err as Error).message;
  }
}

function openDrawModal() {
  drawModal.hidden = false;
  drawError.hidden = true;
  requestAnimationFrame(() => pad.resize());
}

function closeDrawModal() {
  drawModal.hidden = true;
}

async function runRecognition(applyImmediately: boolean) {
  drawError.hidden = true;
  if (!pad.strokes.length) {
    drawError.hidden = false;
    drawError.textContent = 'Primero escribe una función o ecuación en el recuadro.';
    return;
  }

  const prevLabel = drawApplyNow.textContent;
  drawRecognize.disabled = true;
  drawApplyNow.disabled = true;
  drawApplyNow.textContent = 'Reconociendo…';

  try {
    let expr = '';
    const key = loadGeminiKey();
    if (key) {
      try {
        expr = await recognizeWithGemini(pad.toPngDataUrl(), key);
      } catch {
        // Si Gemini falla o no hay red, usamos automáticamente el motor local
        expr = recognizeLocal(pad.strokes);
      }
    } else {
      expr = recognizeLocal(pad.strokes);
    }

    drawRecognized.value = expr;
    updateDrawPreview(expr);

    if (applyImmediately) {
      // Verifica que se pueda interpretar (incluyendo ecuaciones e indeterminaciones)
      parseFunction(expr);
      applyFunction(expr);
      closeDrawModal();
    }
  } catch (err) {
    drawError.hidden = false;
    drawError.textContent = (err as Error).message;
  } finally {
    drawRecognize.disabled = false;
    drawApplyNow.disabled = false;
    drawApplyNow.textContent = prevLabel;
  }
}

btnDraw.addEventListener('click', openDrawModal);
drawClose.addEventListener('click', closeDrawModal);
drawModal.addEventListener('click', (e) => {
  if (e.target === drawModal) closeDrawModal();
});
drawUndo.addEventListener('click', () => pad.undo());
drawClear.addEventListener('click', () => {
  pad.clear();
  drawRecognized.value = '';
  drawPreview.hidden = true;
  drawError.hidden = true;
});
drawRecognize.addEventListener('click', () => void runRecognition(false));
drawApplyNow.addEventListener('click', () => void runRecognition(true));
drawRecognized.addEventListener('input', () => updateDrawPreview(drawRecognized.value));
drawUse.addEventListener('click', () => {
  const expr = drawRecognized.value.trim();
  if (!expr) return;
  try {
    parseFunction(expr);
    applyFunction(expr);
    closeDrawModal();
  } catch (err) {
    drawError.hidden = false;
    drawError.textContent = (err as Error).message;
  }
});
drawRecognized.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    drawUse.click();
  }
});

teachSave.addEventListener('click', () => {
  if (!pad.strokes.length) {
    drawError.hidden = false;
    drawError.textContent = 'Dibuja primero el símbolo que quieres enseñar.';
    return;
  }
  const sym = teachSymbolSelect.value;
  const templates = teachSymbol(sym, pad.strokes);
  pad.clear();
  drawError.hidden = true;
  refreshTeachSelect();
  const idx = TRAINABLE_SYMBOLS.indexOf(sym);
  if ((templates[sym]?.length || 0) >= 2 && idx >= 0 && idx < TRAINABLE_SYMBOLS.length - 1) {
    teachSymbolSelect.value = TRAINABLE_SYMBOLS[idx + 1];
  }
});

teachReset.addEventListener('click', () => {
  clearUserTemplates();
  refreshTeachSelect();
});

geminiSave.addEventListener('click', () => {
  saveGeminiKey(geminiKeyInput.value);
  geminiSave.textContent = geminiKeyInput.value.trim() ? 'Guardada ✓' : 'Eliminada';
  setTimeout(() => { geminiSave.textContent = 'Guardar clave'; }, 1500);
});

window.addEventListener('resize', () => {
  if (!drawModal.hidden) pad.resize();
});

// Botones de ejemplo
const examples = $('fn-examples');
for (const ex of EXAMPLES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = ex;
  b.addEventListener('click', () => applyFunction(ex));
  examples.appendChild(b);
}

// ---------- Cambiar de modo (mano, botones o teclado) ----------
function setMode(m: number) {
  if (m === 5 && mode !== 5) challenge.newChallenge(fn, view);
  mode = m;
  modeIndicator.textContent = `Modo ${m} · ${MODE_NAMES[m]}`;
  modeButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.mode) === m));
  btnNewChallenge.hidden = m !== 5;
}

function resetAll() {
  view.reset();
  a = nearestDefined(fn.f, 1.5);
  lastHandMode = 0;
  setMode(0);
}

// ---------- Tamaño del plano ----------
// El canvas se dibuja a la resolución real de la pantalla (devicePixelRatio)
// para que las líneas no se vean borrosas en pantallas de alta densidad.
function resizeGraph() {
  const dpr = window.devicePixelRatio || 1;
  view.width = graph.clientWidth;
  view.height = graph.clientHeight;
  graph.width = view.width * dpr;
  graph.height = view.height * dpr;
  graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeGraph);
resizeGraph();
view.reset(); // escala inicial según el ancho de la pantalla
setMode(0);
applyFunction(DEFAULT_EXPRESSION);

// ---------- Cámara ----------
btnCamera.addEventListener('click', async () => {
  btnCamera.disabled = true;
  msg.textContent = 'Solicitando permiso de cámara…';
  try {
    await startCamera(video);
    msg.textContent = 'Cargando modelo de manos…';
    tracker = await createHandTracker();
    msg.textContent = '';
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  } catch (err) {
    console.error(err);
    msg.textContent = cameraErrorMessage(err);
    btnCamera.disabled = false;
  }
});

// ---------- Papeles de cada mano ----------
// Siempre por lateralidad real (ver handSides.ts), nunca por posición:
// la mano DERECHA elige el modo y mueve x = a; la IZQUIERDA controla la vista.
const HAND_COLOR: Record<Side, string> = { derecha: '#ff4fd8', izquierda: '#2ee6c8' };

function assignRoles(hands: IdentifiedHand[]) {
  return {
    mode: hands.find((h) => h.side === 'derecha')?.landmarks,
    control: hands.find((h) => h.side === 'izquierda')?.landmarks,
  };
}

// Etiqueta de color junto a la muñeca con el lado y el papel de la mano.
// Se dibuja en el plano (sin espejo) para que el texto se lea al derecho.
function tagHand(lm: NormalizedLandmark[], side: Side, text: string) {
  const x = (1 - lm[0].x) * view.width;
  const y = lm[0].y * view.height + 26;
  graphCtx.save();
  graphCtx.font = '700 13px Inter, system-ui, sans-serif';
  const w = graphCtx.measureText(text).width + 20;
  graphCtx.fillStyle = HAND_COLOR[side];
  graphCtx.beginPath();
  graphCtx.roundRect(x - w / 2, y - 12, w, 24, 12);
  graphCtx.fill();
  graphCtx.fillStyle = '#111';
  graphCtx.textAlign = 'center';
  graphCtx.textBaseline = 'middle';
  graphCtx.fillText(text, x, y);
  graphCtx.restore();
}

// Línea de estado de cada mano en el panel, con su color
function setHandStatus(el: HTMLElement, side: Side, text: string) {
  el.innerHTML = `<span class="hand-dot" style="background:${HAND_COLOR[side]}"></span>${text}`;
}

// ---------- Ciclo principal (~60 veces por segundo) ----------
// Corre siempre, con o sin cámara, para que el control con mouse funcione.
function loop() {
  let roles: ReturnType<typeof assignRoles> = { mode: undefined, control: undefined };

  if (tracker && video.readyState >= 2) {
    const result = detectHands(tracker, video);
    const hands = handSides.update(result);
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    // Cada mano con su color: esqueleto del color del lado, articulaciones blancas
    for (const hand of hands) {
      const color = HAND_COLOR[hand.side];
      drawer.drawConnectors(hand.landmarks, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 4 });
      drawer.drawLandmarks(hand.landmarks, { color: '#ffffff', fillColor: color, radius: 4 });
    }
    roles = assignRoles(hands);

    if (roles.mode && drawModal.hidden) {
      // El modo solo cambia cuando el conteo estabilizado cambia; así los
      // botones y el teclado no son sobrescritos en cada cuadro
      const raw = countFingers(roles.mode);
      const handMode = modeStabilizer.push(raw);
      if (handMode !== lastHandMode) {
        lastHandMode = handMode;
        setMode(handMode);
      }
      // La punta del índice (landmark 8) mueve el punto x = a, con suavizado
      if (mode > 0) {
        const target = view.toWorldX((1 - roles.mode[8].x) * view.width);
        a += (target - a) * 0.35;
      }
      setHandStatus(fingersDebug, 'derecha', `Mano derecha: ${raw} ${raw === 1 ? 'dedo' : 'dedos'} → modo ${mode}`);
    } else if (!roles.mode) {
      setHandStatus(fingersDebug, 'derecha', 'Mano derecha: no detectada (elige el modo)');
    }

    if (roles.control && drawModal.hidden) {
      setHandStatus(controlStatus, 'izquierda', CONTROL_TEXT[control.update(roles.control, view)]);
    } else {
      control.release();
      if (!roles.control) setHandStatus(controlStatus, 'izquierda', 'Mano izquierda: no detectada (mueve y hace zoom)');
    }
  }

  drawGrid(graphCtx, view);
  const html = renderMode(mode, { ctx: graphCtx, view, fn, a, particles, challenge });
  // Solo se toca el DOM si los resultados cambiaron
  if (html !== lastResults) {
    results.innerHTML = html;
    lastResults = html;
  }
  if (roles.mode) tagHand(roles.mode, 'derecha', `Derecha · ${countFingers(roles.mode)}`);
  if (roles.control) tagHand(roles.control, 'izquierda', `Izquierda · ${control.gesture}`);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- Control alternativo: botones ----------
modeButtons.forEach((b) => b.addEventListener('click', () => setMode(Number(b.dataset.mode))));
btnReset.addEventListener('click', resetAll);
btnNewChallenge.addEventListener('click', () => challenge.newChallenge(fn, view));
$('info-link').addEventListener('click', () => { help.open = true; });

// ---------- Control alternativo: teclado ----------
window.addEventListener('keydown', (e) => {
  if (!drawModal.hidden) {
    if (e.key === 'Escape') {
      closeDrawModal();
      e.preventDefault();
    }
    return;
  }
  // Mientras se escribe la función, las teclas son texto, no atajos
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  if (e.key >= '0' && e.key <= '5') setMode(Number(e.key));
  else if (e.key === 'ArrowLeft') a -= 10 / view.scale;
  else if (e.key === 'ArrowRight') a += 10 / view.scale;
  else if (e.key === 'r' || e.key === 'R') resetAll();
  else if ((e.key === 'n' || e.key === 'N') && mode === 5) challenge.newChallenge(fn, view);
  else return;
  e.preventDefault();
});

// ---------- Control alternativo: mouse / touch ----------
// Arrastrar desplaza la vista; un clic sin arrastrar coloca x = a ahí.
let dragging: { x: number; y: number } | null = null;
let dragDistance = 0;

graph.addEventListener('pointerdown', (e) => {
  dragging = { x: e.offsetX, y: e.offsetY };
  dragDistance = 0;
  graph.setPointerCapture(e.pointerId);
});
graph.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.offsetX - dragging.x;
  const dy = e.offsetY - dragging.y;
  dragDistance += Math.hypot(dx, dy);
  view.pan(dx, dy);
  dragging = { x: e.offsetX, y: e.offsetY };
});
graph.addEventListener('pointerup', (e) => {
  if (dragging && dragDistance < 4) a = view.toWorldX(e.offsetX);
  dragging = null;
});
graph.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Rueda hacia arriba (deltaY < 0) acerca; el zoom se centra en el puntero
  view.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
}, { passive: false });
graph.addEventListener('dblclick', () => view.reset());
