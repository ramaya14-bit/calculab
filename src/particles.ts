// Partículas que recorren la curva de izquierda a derecha.
// El color indica el signo de f'(x): verde si la función crece y rojo si
// decrece. Así el crecimiento y el decrecimiento se "ven" moverse.

import type { MathFunction } from './math';
import type { View } from './view';

export const UP_COLOR = '#3ddc84';
export const DOWN_COLOR = '#ff6b6b';

interface Particle {
  x: number;    // posición en el mundo
  life: number; // cuadros que le quedan antes de reaparecer
}

const COUNT = 80;
const SPEED_PX = 1.5; // avance horizontal por cuadro, en píxeles

export class CurveParticles {
  private particles: Particle[] = [];

  update(view: View): void {
    const xMin = view.toWorldX(0);
    const xMax = view.toWorldX(view.width);
    while (this.particles.length < COUNT) this.particles.push(spawn(xMin, xMax));

    for (const p of this.particles) {
      p.x += SPEED_PX / view.scale;
      p.life--;
      // Si sale de la vista o se agota, reaparece en un lugar al azar
      if (p.x > xMax || p.x < xMin || p.life <= 0) Object.assign(p, spawn(xMin, xMax));
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: View, fn: MathFunction): void {
    ctx.save();
    for (const p of this.particles) {
      const y = fn.f(p.x);
      const slope = fn.df(p.x);
      if (!Number.isFinite(y) || !Number.isFinite(slope)) continue;
      ctx.globalAlpha = Math.min(1, p.life / 30); // se desvanecen al final
      ctx.fillStyle = slope > 0 ? UP_COLOR : slope < 0 ? DOWN_COLOR : '#fff';
      ctx.beginPath();
      ctx.arc(view.toScreenX(p.x), view.toScreenY(y), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function spawn(xMin: number, xMax: number): Particle {
  return { x: xMin + Math.random() * (xMax - xMin), life: 60 + Math.random() * 120 };
}
