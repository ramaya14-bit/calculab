// Dibujo del plano cartesiano (cuadrícula, ejes y números).
// Aquí se agregará después la curva de la función asignada.

import type { View } from './view';

// Elige un paso "bonito" (1, 2, 5, 10, 20, 50…) para la cuadrícula
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

// Quita decimales basura de punto flotante (0.30000000004 → 0.3)
function fmt(v: number): string {
  return String(parseFloat(v.toPrecision(6)));
}

export function drawGrid(ctx: CanvasRenderingContext2D, view: View): void {
  const { width: w, height: h } = view;
  ctx.clearRect(0, 0, w, h);

  // Una línea de cuadrícula cada ~90 píxeles, sin importar el zoom
  const step = niceStep(90 / view.scale);
  const xMin = view.toWorldX(0), xMax = view.toWorldX(w);
  const yMin = view.toWorldY(h), yMax = view.toWorldY(0);

  // Cuadrícula (se usan índices enteros para no acumular error al sumar)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = Math.ceil(xMin / step); i * step <= xMax; i++) {
    const sx = Math.round(view.toScreenX(i * step)) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (let i = Math.ceil(yMin / step); i * step <= yMax; i++) {
    const sy = Math.round(view.toScreenY(i * step)) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  // Ejes. Si un eje queda fuera de pantalla, sus números se pegan al borde
  const axisY = Math.min(h - 18, Math.max(2, view.toScreenY(0)));
  const axisX = Math.min(w - 30, Math.max(2, view.toScreenX(0)));
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, view.toScreenY(0));
  ctx.lineTo(w, view.toScreenY(0));
  ctx.moveTo(view.toScreenX(0), 0);
  ctx.lineTo(view.toScreenX(0), h);
  ctx.stroke();

  // Números de los ejes (con sombra para leerse sobre el video)
  ctx.fillStyle = '#fff';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = Math.ceil(xMin / step); i * step <= xMax; i++) {
    if (i === 0) continue;
    ctx.fillText(fmt(i * step), view.toScreenX(i * step), axisY + 4);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = Math.ceil(yMin / step); i * step <= yMax; i++) {
    if (i === 0) continue;
    ctx.fillText(fmt(i * step), axisX + 6, view.toScreenY(i * step));
  }
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------
// Herramientas de dibujo para curvas, puntos, rectas y etiquetas.
// Todas reciben coordenadas del MUNDO (x, y) salvo que se diga otra cosa.
// ---------------------------------------------------------------

const SHADOW = 'rgba(0,0,0,0.5)';

// Dibuja y = g(x) evaluando la función en cada píxel horizontal
export function plotFunction(
  ctx: CanvasRenderingContext2D, view: View, g: (x: number) => number, color: string, width = 3,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  let drawing = false;
  let prevY = 0;
  for (let px = 0; px <= view.width; px++) {
    const y = g(view.toWorldX(px));
    if (!Number.isFinite(y)) { drawing = false; continue; }
    // Se limita el valor en pantalla para que el canvas no reciba números gigantes
    const sy = Math.max(-1e4, Math.min(1e4, view.toScreenY(y)));
    if (drawing && Math.abs(sy - view.toScreenY(prevY)) > view.height) {
      // Salto grande: si el punto intermedio está entre ambos valores la curva
      // solo es empinada; si no, hay una asíntota y no se deben unir
      const mid = g(view.toWorldX(px - 0.5));
      const continuous = Number.isFinite(mid) && (mid - prevY) * (y - mid) >= 0;
      if (continuous) ctx.lineTo(px, sy);
      else ctx.moveTo(px, sy);
    } else if (drawing) {
      ctx.lineTo(px, sy);
    } else {
      ctx.moveTo(px, sy);
    }
    drawing = true;
    prevY = y;
  }
  ctx.stroke();
  ctx.restore();
}

// Recta entre dos puntos del mundo (dash = [] continua, [6, 6] punteada)
export function drawSegment(
  ctx: CanvasRenderingContext2D, view: View,
  x1: number, y1: number, x2: number, y2: number,
  color: string, width = 2, dash: number[] = [],
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(view.toScreenX(x1), view.toScreenY(y1));
  ctx.lineTo(view.toScreenX(x2), view.toScreenY(y2));
  ctx.stroke();
  ctx.restore();
}

export function drawDot(
  ctx: CanvasRenderingContext2D, view: View, x: number, y: number, color: string, r = 6,
): void {
  if (!Number.isFinite(y)) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(view.toScreenX(x), view.toScreenY(y), r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Texto en coordenadas de PANTALLA (píxeles)
export function drawLabel(
  ctx: CanvasRenderingContext2D, text: string, sx: number, sy: number,
  color = '#fff', align: CanvasTextAlign = 'left',
): void {
  ctx.save();
  ctx.font = '600 13px Inter, system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText(text, sx, sy);
  ctx.restore();
}

// Círculo hueco para discontinuidades evitables (huecos 0/0) y saltos
export function drawHollowDot(
  ctx: CanvasRenderingContext2D, view: View, x: number, y: number, color = '#5ee0ff', r = 6.5,
): void {
  if (!Number.isFinite(y)) return;
  const sx = view.toScreenX(x);
  const sy = view.toScreenY(y);
  if (sx < -20 || sx > view.width + 20 || sy < -20 || sy > view.height + 20) return;
  ctx.save();
  ctx.fillStyle = 'rgba(17,17,17,0.75)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Línea vertical punteada para asíntotas verticales (división entre cero k/0)
export function drawAsymptote(
  ctx: CanvasRenderingContext2D, view: View, x: number, label?: string,
): void {
  const sx = view.toScreenX(x);
  if (sx < -10 || sx > view.width + 10) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,107,107,0.85)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]);
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(sx, 0);
  ctx.lineTo(sx, view.height);
  ctx.stroke();
  ctx.restore();
  if (label) {
    drawLabel(ctx, label, Math.min(view.width - 10, sx + 6), 24, '#ffd1d1', 'left');
  }
}

// Tarjeta centrada sobre el plano para avisar de una indeterminación global (p. ej. x/0, 0/0)
export function drawCenterBadge(
  ctx: CanvasRenderingContext2D, view: View, title: string, subtitle: string,
): void {
  const cx = view.width / 2;
  const cy = view.height / 2;
  ctx.save();
  ctx.font = '700 16px Inter, system-ui, sans-serif';
  const w1 = ctx.measureText(title).width;
  ctx.font = '500 13px Inter, system-ui, sans-serif';
  const w2 = ctx.measureText(subtitle).width;
  const boxW = Math.min(view.width - 32, Math.max(w1, w2) + 40);
  const boxH = 68;

  ctx.fillStyle = 'rgba(17,17,17,0.78)';
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 12);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 16px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ff9e9e';
  ctx.fillText(title, cx, cy - 11, boxW - 24);

  ctx.font = '500 13px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(subtitle, cx, cy + 13, boxW - 24);
  ctx.restore();
}
