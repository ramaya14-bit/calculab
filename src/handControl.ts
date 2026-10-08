// Mano de control: traduce gestos a desplazamiento y zoom de la vista.
//   Puño (✊)            → agarrar y desplazar
//   Solo índice (👆)     → zoom abriendo/cerrando la pinza pulgar-índice
//   Cualquier otro (✋)  → libre, no hace nada

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { dist, fingerStates } from './fingers';
import { Stabilizer } from './stabilizer';
import type { View } from './view';

export type ControlGesture = 'agarrar' | 'zoom' | 'libre';

// Suavizado: cada lectura nueva pesa 40 %; el resto viene de la anterior.
// Quita el temblor natural de la mano y del detector.
const SMOOTH = 0.4;
// Límite de zoom por cuadro, para que un salto del detector no dispare la escala
const MAX_ZOOM_STEP = 0.08;

export function classifyControl(lm: NormalizedLandmark[]): ControlGesture {
  const [, index, middle, ring, pinky] = fingerStates(lm);
  if (!middle && !ring && !pinky) {
    // El pulgar no se tiene en cuenta: un puño puede tenerlo afuera
    return index ? 'zoom' : 'agarrar';
  }
  return 'libre';
}

export class HandControl {
  gesture: ControlGesture = 'libre';
  private stabilizer = new Stabilizer<ControlGesture>(4, 'libre');
  private lastPalm: { x: number; y: number } | null = null;
  private lastPinch: number | null = null;

  update(lm: NormalizedLandmark[], view: View): ControlGesture {
    const g = this.stabilizer.push(classifyControl(lm));
    if (g !== this.gesture) {
      // Al cambiar de gesto se olvida la posición anterior para no dar saltos
      this.gesture = g;
      this.release();
    }

    if (g === 'agarrar') {
      // Centro de la palma (landmark 9) en píxeles de pantalla.
      // x se invierte (1 - x) porque la imagen se muestra en espejo.
      const raw = { x: (1 - lm[9].x) * view.width, y: lm[9].y * view.height };
      const p = this.lastPalm
        ? { x: lerp(this.lastPalm.x, raw.x), y: lerp(this.lastPalm.y, raw.y) }
        : raw;
      if (this.lastPalm) view.pan(p.x - this.lastPalm.x, p.y - this.lastPalm.y);
      this.lastPalm = p;
    }

    if (g === 'zoom') {
      // Apertura de la pinza dividida por el tamaño de la palma (0 → 9):
      // así acercar la mano a la cámara no se confunde con hacer zoom.
      const raw = dist(lm[4], lm[8]) / dist(lm[0], lm[9]);
      const pinch = this.lastPinch === null ? raw : lerp(this.lastPinch, raw);
      if (this.lastPinch !== null) {
        const factor = clamp(pinch / this.lastPinch, 1 - MAX_ZOOM_STEP, 1 + MAX_ZOOM_STEP);
        view.zoomAt(factor, view.width / 2, view.height / 2);
      }
      this.lastPinch = pinch;
    }

    return g;
  }

  // Se llama cuando la mano de control desaparece o cambia de gesto
  release(): void {
    this.lastPalm = null;
    this.lastPinch = null;
  }
}

function lerp(a: number, b: number): number {
  return a + (b - a) * SMOOTH;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
