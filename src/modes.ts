// Las cinco interacciones. Cada modo dibuja sobre el plano y devuelve el
// HTML con los resultados matemáticos que se muestran en el panel.

import { criticalPoints, findRoots, fmt, monotonyIntervals, type MathFunction } from './math';
import { drawDot, drawLabel, drawSegment, plotFunction } from './graph';
import { CurveParticles, DOWN_COLOR, UP_COLOR } from './particles';
import type { ChallengeRunner } from './challenge';
import type { View } from './view';

export const MODE_NAMES = [
  'Explorar',
  'Evaluar f(a) y pendiente',
  'Recta tangente',
  "f(x), f'(x) y f''(x)",
  'Puntos críticos, máximos y mínimos',
  'Reto aplicado',
];

const C = {
  f: '#ffffff',
  df: '#ffc94d',
  d2f: '#5ee0ff',
  point: '#8e2a8f',
  tangent: '#ff5c8a',
  max: '#ff6b6b',
  min: '#4da3ff',
};

// Versiones oscuras de los mismos colores, legibles sobre el panel blanco
const P = {
  f: '#111',
  df: '#b26a00',
  d2f: '#0e7490',
  tangent: '#c2185b',
  max: '#c62828',
  min: '#1565c0',
};

export interface ModeContext {
  ctx: CanvasRenderingContext2D;
  view: View;
  fn: MathFunction;
  a: number;
  particles: CurveParticles;
  challenge: ChallengeRunner;
}

export function renderMode(mode: number, m: ModeContext): string {
  switch (mode) {
    case 1: return evaluate(m);
    case 2: return tangent(m);
    case 3: return derivatives(m);
    case 4: return critical(m);
    case 5: return challenge(m);
    default: return explore(m);
  }
}

// Fila "etiqueta: valor" del panel de resultados
const row = (label: string, value: string, color = '') =>
  `<div class="row"><span${color ? ` style="color:${color}"` : ''}>${label}</span><strong>${value}</strong></div>`;
const note = (text: string) => `<p class="note">${text}</p>`;

// Aviso cuando x = a cae fuera del dominio de f (p. ej. ln x con a < 0)
const outOfDomain = (fn: MathFunction, a: number) =>
  row('Función', fn.fText) + row('a', fmt(a)) +
  note(`f no está definida en x = ${fmt(a)}. Mueve el punto a una zona donde exista la gráfica.`);

// Interpretación del signo de la pendiente
function slopeMeaning(m: number): string {
  if (!Number.isFinite(m)) return "La derivada no existe en este punto (por ejemplo, un pico o una tangente vertical).";
  if (Math.abs(m) < 1e-3) return 'La pendiente es 0: la tangente es horizontal. Aquí puede haber un máximo o un mínimo.';
  return m > 0
    ? `La pendiente es positiva: la función <b>crece</b> en este punto. Si x avanza un poco, f(x) sube unas ${fmt(m)} veces ese avance.`
    : `La pendiente es negativa: la función <b>decrece</b> en este punto. Si x avanza un poco, f(x) baja unas ${fmt(-m)} veces ese avance.`;
}

// ---------- Modo 0: solo la función ----------
function explore({ ctx, view, fn }: ModeContext): string {
  plotFunction(ctx, view, fn.f, C.f);
  return row('Función', fn.fText) +
    note('Muestra de 1 a 5 dedos con la mano derecha (o usa los botones / teclas 1–5) para elegir una interacción.');
}

// ---------- Modo 1: evaluar f(a) y ver la pendiente ----------
function evaluate({ ctx, view, fn, a }: ModeContext): string {
  const fa = fn.f(a);
  const m = fn.df(a);
  plotFunction(ctx, view, fn.f, C.f);
  if (!Number.isFinite(fa)) return outOfDomain(fn, a);

  // Líneas guía punteadas desde el punto hasta los ejes
  drawSegment(ctx, view, a, 0, a, fa, '#fff', 1.5, [5, 5]);
  drawSegment(ctx, view, 0, fa, a, fa, '#fff', 1.5, [5, 5]);

  // Triángulo de pendiente: avanzar Δx en horizontal y subir m·Δx.
  // Δx se acorta si la pendiente es grande, para que la subida quepa (~100 px)
  const run = Math.min(70, 100 / Math.max(Math.abs(m), 1e-9)) / view.scale;
  drawSegment(ctx, view, a, fa, a + run, fa, C.df, 2);
  drawSegment(ctx, view, a + run, fa, a + run, fa + m * run, C.df, 2);
  drawLabel(ctx, `m = ${fmt(m)}`, view.toScreenX(a + run) + 8, view.toScreenY(fa + (m * run) / 2), C.df);

  drawDot(ctx, view, a, fa, C.point, 7);
  drawLabel(ctx, `P(${fmt(a)}, ${fmt(fa)})`, view.toScreenX(a) - 10, view.toScreenY(fa) - 18, '#fff', 'right');

  return row('Función', fn.fText) +
    row('a', fmt(a)) +
    row('f(a)', fmt(fa)) +
    row("Pendiente f'(a)", fmt(m), P.df) +
    note(slopeMeaning(m));
}

// ---------- Modo 2: recta tangente en x = a ----------
function tangent({ ctx, view, fn, a }: ModeContext): string {
  const fa = fn.f(a);
  const m = fn.df(a);
  const b = fa - m * a; // ordenada al origen: y = m·x + b
  const line = (x: number) => fa + m * (x - a);

  plotFunction(ctx, view, fn.f, C.f);
  if (!Number.isFinite(fa)) return outOfDomain(fn, a);
  if (!Number.isFinite(m)) {
    drawDot(ctx, view, a, fa, C.point, 7);
    return row('Función', fn.fText) + row('Punto', `(${fmt(a)}, ${fmt(fa)})`) +
      note("f'(a) no existe aquí, así que no hay una recta tangente con pendiente definida.");
  }
  const x0 = view.toWorldX(0);
  const x1 = view.toWorldX(view.width);
  drawSegment(ctx, view, x0, line(x0), x1, line(x1), C.tangent, 2.5);
  drawDot(ctx, view, a, fa, C.point, 7);

  const sign = (v: number) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
  return row('Función', fn.fText) +
    row('Punto de tangencia', `(${fmt(a)}, ${fmt(fa)})`) +
    row("Pendiente m = f'(a)", fmt(m), P.df) +
    row('Fórmula', 'y = f(a) + f\'(a)(x − a)') +
    row('Sustituyendo', `y = ${fmt(fa)} ${sign(m)}(x ${sign(-a)})`) +
    row('Recta tangente', `y = ${fmt(m)}x ${sign(b)}`, P.tangent) +
    note('La tangente toca la curva en el punto y tiene su misma pendiente: es la mejor aproximación lineal de f cerca de x = a.');
}

// ---------- Modo 3: f, f' y f'' juntas ----------
function derivatives({ ctx, view, fn, a }: ModeContext): string {
  plotFunction(ctx, view, fn.d2f, C.d2f, 2);
  plotFunction(ctx, view, fn.df, C.df, 2.5);
  plotFunction(ctx, view, fn.f, C.f, 3);

  // Línea vertical en x = a que corta las tres curvas
  drawSegment(ctx, view, a, view.toWorldY(0), a, view.toWorldY(view.height), '#fff', 1, [4, 6]);
  drawDot(ctx, view, a, fn.d2f(a), C.d2f, 5);
  drawDot(ctx, view, a, fn.df(a), C.df, 5);
  drawDot(ctx, view, a, fn.f(a), C.point, 6);

  // Puntos de inflexión (f'' = 0 y cambia de signo)
  const xMin = view.toWorldX(0);
  const xMax = view.toWorldX(view.width);
  for (const x of findRoots(fn.d2f, xMin, xMax)) {
    drawDot(ctx, view, x, fn.f(x), C.d2f, 5);
    drawLabel(ctx, 'inflexión', view.toScreenX(x) + 8, view.toScreenY(fn.f(x)) + 14, '#fff');
  }

  // Leyenda
  drawLabel(ctx, fn.fText, 12, 16, C.f);
  drawLabel(ctx, fn.dfText, 12, 34, C.df);
  drawLabel(ctx, fn.d2fText, 12, 52, C.d2f);

  const d1 = fn.df(a);
  const d2 = fn.d2f(a);
  const growth = Math.abs(d1) < 1e-3 ? "f'(a) = 0: f no crece ni decrece en ese instante" :
    d1 > 0 ? "f'(a) > 0 → f <b>crece</b>" : "f'(a) < 0 → f <b>decrece</b>";
  const concavity = Math.abs(d2) < 1e-3 ? "f''(a) = 0: posible punto de inflexión" :
    d2 > 0 ? "f''(a) > 0 → f es <b>cóncava hacia arriba</b> (f' crece)" : "f''(a) < 0 → f es <b>cóncava hacia abajo</b> (f' decrece)";

  return row(fn.fText, `f(${fmt(a)}) = ${fmt(fn.f(a))}`, P.f) +
    row(fn.dfText, `f'(${fmt(a)}) = ${fmt(d1)}`, P.df) +
    row(fn.d2fText, `f''(${fmt(a)}) = ${fmt(d2)}`, P.d2f) +
    note(`${growth}. ${concavity}.`) +
    note("Observa: donde f' cruza el eje x, f tiene un máximo o un mínimo; donde f'' cruza el eje x, f cambia de concavidad.");
}

// ---------- Modo 4: puntos críticos, máximos y mínimos ----------
function critical({ ctx, view, fn, particles }: ModeContext): string {
  const xMin = view.toWorldX(0);
  const xMax = view.toWorldX(view.width);
  const points = criticalPoints(fn, xMin, xMax);
  const intervals = monotonyIntervals(fn, xMin, xMax, points);

  // Franja inferior: verde donde crece, roja donde decrece
  for (const it of intervals) {
    ctx.fillStyle = it.increasing ? UP_COLOR : DOWN_COLOR;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(view.toScreenX(it.from), view.height - 8, view.toScreenX(it.to) - view.toScreenX(it.from), 8);
    ctx.globalAlpha = 1;
  }

  plotFunction(ctx, view, fn.f, C.f);
  particles.update(view);
  particles.draw(ctx, view, fn);

  for (const p of points) {
    const color = p.type === 'máximo' ? C.max : p.type === 'mínimo' ? C.min : '#fff';
    drawSegment(ctx, view, p.x - 60 / view.scale, p.y, p.x + 60 / view.scale, p.y, color, 2, [4, 4]);
    drawDot(ctx, view, p.x, p.y, color, 7);
    const offset = p.type === 'mínimo' ? 20 : -20;
    drawLabel(ctx, `${p.type} (${fmt(p.x)}, ${fmt(p.y)})`, view.toScreenX(p.x), view.toScreenY(p.y) + offset, '#fff', 'center');
  }

  const list = points.length === 0
    ? note('No hay puntos críticos en la zona visible: prueba a desplazar o alejar la vista.')
    : points.map((p) => {
        const color = p.type === 'máximo' ? P.max : p.type === 'mínimo' ? P.min : '';
        const kind = p.type === 'ni máximo ni mínimo' ? p.type : `${p.type} local`;
        const detail = p.noDerivative ? "f' no existe" : `f'' = ${fmt(fn.d2f(p.x))}`;
        return row(`x = ${fmt(p.x)}`, `${kind}, f = ${fmt(p.y)} · ${detail}`, color);
      }).join('');
  const growth = intervals
    .map((it) => `<span style="color:${it.increasing ? UP_COLOR : DOWN_COLOR}">${it.increasing ? 'crece' : 'decrece'} en (${fmt(it.from)}, ${fmt(it.to)})</span>`)
    .join(' · ');

  return row('Función', fn.fText) +
    row('Puntos críticos', "f'(x) = 0 o f'(x) no existe") + list +
    note(intervals.length ? `En la zona visible: ${growth}.` : 'La función no crece ni decrece en la zona visible (es constante o no está definida).') +
    note("Criterio: si f' pasa de + a −, hay un máximo; si pasa de − a +, un mínimo. Con f'': f'' < 0 confirma máximo y f'' > 0, mínimo.");
}

// ---------- Modo 5: reto aplicado ----------
function challenge({ ctx, view, fn, a, challenge: runner }: ModeContext): string {
  const s = fn.f(a);
  const v = fn.df(a);
  const acc = fn.d2f(a);
  const c = runner.challenge;
  plotFunction(ctx, view, fn.f, C.f);

  // Reto de valor medio: secante punteada entre t1 y t2 (razón promedio)
  if (c?.secant) {
    const { t1, t2 } = c.secant;
    const m = (fn.f(t2) - fn.f(t1)) / (t2 - t1);
    const x0 = view.toWorldX(0), x1 = view.toWorldX(view.width);
    drawSegment(ctx, view, x0, fn.f(t1) + m * (x0 - t1), x1, fn.f(t1) + m * (x1 - t1), C.d2f, 2, [8, 6]);
    drawDot(ctx, view, t1, fn.f(t1), C.d2f, 6);
    drawDot(ctx, view, t2, fn.f(t2), C.d2f, 6);
  }

  // Tangente corta en t: su pendiente ES la razón de cambio instantánea
  if (Number.isFinite(s) && Number.isFinite(v)) {
    const half = 70 / view.scale / Math.sqrt(1 + v * v); // ~70 px de largo a cada lado
    drawSegment(ctx, view, a - half, s - v * half, a + half, s + v * half, C.tangent, 3);
  }
  drawDot(ctx, view, a, s, C.point, 7);

  // Indicador lateral (objeto o termómetro) que sube y baja a la altura f(t)
  const trackX = view.toWorldX(view.width - 40);
  drawSegment(ctx, view, trackX, view.toWorldY(0), trackX, view.toWorldY(view.height), 'rgba(255,255,255,0.6)', 4);
  drawSegment(ctx, view, a, s, trackX, s, '#fff', 1, [3, 5]);
  // Flecha: cuánto cambiaría la magnitud en 0,5 unidades de tiempo
  if (Number.isFinite(v)) drawSegment(ctx, view, trackX, s, trackX, s + v * 0.5, C.df, 4);
  drawDot(ctx, view, trackX, s, runner.solved ? UP_COLOR : C.tangent, 10);
  drawLabel(ctx, c?.context.marker ?? 'objeto', view.width - 54, view.toScreenY(s), '#fff', 'right');

  runner.update(a, view);
  if (!c) return note('Ningún reto tiene solución en la zona visible. Desplaza o aleja la vista y pulsa "Nuevo reto".');

  const status = runner.solved
    ? `<p class="success">✔ ¡Reto superado! ${c.answer}</p>`
    : `<div class="progress"><div style="width:${Math.round(runner.progress * 100)}%"></div></div>` +
      (runner.showHint ? `<p class="note">💡 <b>Pista:</b> ${c.hint}</p>` : '');

  return `<h3>${c.title}</h3>` + note(c.statement) +
    row('Instante t', fmt(a)) +
    row(c.context.value, fmt(s)) +
    row(`${c.context.rate} (${c.context.rateUnit})`, fmt(v), P.df) +
    row(c.context.rate2, fmt(acc), P.d2f) +
    status +
    note(`Retos superados: <b>${runner.solvedCount}</b> · Pulsa "Nuevo reto" (o N) para otro.`);
}
