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
import { DEFAULT_EXPRESSION, EXAMPLES, parseFunction } from './parser';
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
const fnError = $('fn-error');
const derivativeWarning = $('derivative-warning');

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

  // Verificación: las derivadas simbólicas deben coincidir con las numéricas
  const errors = checkDerivatives(fn);
  derivativeWarning.hidden = errors.length === 0;
  derivativeWarning.textContent = errors.length ? '⚠ Revisa las derivadas: ' + errors.join(' · ') : '';

  // El punto a se coloca donde la función esté definida (p. ej. ln x exige x > 0)
  a = nearestDefined(fn.f, 1.5);
  if (mode === 5) challenge.newChallenge(fn, view);
}

fnForm.addEventListener('submit', (e) => {
  e.preventDefault();
  applyFunction(fnInput.value);
  fnInput.blur(); // devuelve el teclado a los atajos (1–5, flechas…)
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

    if (roles.mode) {
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
    } else {
      setHandStatus(fingersDebug, 'derecha', 'Mano derecha: no detectada (elige el modo)');
    }

    if (roles.control) {
      setHandStatus(controlStatus, 'izquierda', CONTROL_TEXT[control.update(roles.control, view)]);
    } else {
      control.release();
      setHandStatus(controlStatus, 'izquierda', 'Mano izquierda: no detectada (mueve y hace zoom)');
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
  // Mientras se escribe la función, las teclas son texto, no atajos
  if (e.target instanceof HTMLInputElement) return;
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
