// Identificación de la mano DERECHA y la IZQUIERDA del usuario.
//
// MediaPipe da para cada mano una etiqueta ("Left"/"Right") y una confianza
// (score). Dos detalles:
//  1. La etiqueta "Right" corresponde a la mano DERECHA del usuario
//     (comprobado con la cámara real en las pruebas).
//  2. La etiqueta puede dudar en algunos cuadros, o dar la misma a las dos
//     manos. Para evitarlo, cada mano se sigue entre cuadros (por la
//     posición de su muñeca) y se acumula su probabilidad de ser derecha;
//     esa probabilidad cambia poco a poco, así un cuadro dudoso no basta
//     para que la mano "cambie de bando".

import type { HandLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';

export type Side = 'derecha' | 'izquierda';

export interface IdentifiedHand {
  side: Side;
  landmarks: NormalizedLandmark[];
}

interface Track {
  x: number;      // posición de la muñeca en el cuadro anterior
  y: number;
  pRight: number; // probabilidad acumulada de que sea la mano derecha
}

// Cuánto pesa la lectura de cada cuadro frente a la historia (0 a 1).
// Es bajo a propósito: una mano no cambia de lado mientras sigue en cámara,
// así que hacen falta ~17 cuadros seguidos (~0,3 s) de lecturas contrarias
// muy seguras para cambiarla. Una mano que entra de nuevo empieza de cero.
const LEARN = 0.04;
// Distancia máxima (en coordenadas normalizadas) para considerar que una
// mano es la misma del cuadro anterior
const MAX_JUMP = 0.2;

export class HandSides {
  private tracks: Track[] = [];

  update(result: HandLandmarkerResult): IdentifiedHand[] {
    const previous = this.tracks;
    const used = new Set<Track>();
    const current: (Track & { landmarks: NormalizedLandmark[] })[] = [];

    result.landmarks.forEach((lm, i) => {
      const category = result.handedness[i][0];
      // Lectura de este cuadro: probabilidad de que sea la mano derecha
      const reading = category.categoryName === 'Right' ? category.score : 1 - category.score;

      // Se busca la mano del cuadro anterior más cercana (seguimiento)
      let match: Track | null = null;
      let best = MAX_JUMP;
      for (const t of previous) {
        const d = Math.hypot(t.x - lm[0].x, t.y - lm[0].y);
        if (!used.has(t) && d < best) {
          best = d;
          match = t;
        }
      }
      if (match) used.add(match);

      // Promedio móvil: la historia pesa más que la lectura actual
      const pRight = match ? match.pRight + (reading - match.pRight) * LEARN : reading;
      current.push({ x: lm[0].x, y: lm[0].y, pRight, landmarks: lm });
    });

    this.tracks = current;

    // Con dos manos, una es derecha y la otra izquierda: la más probable
    // de ser derecha se queda con ese papel
    if (current.length === 2) {
      const [a, b] = current;
      const right = a.pRight >= b.pRight ? a : b;
      const left = right === a ? b : a;
      return [
        { side: 'derecha', landmarks: right.landmarks },
        { side: 'izquierda', landmarks: left.landmarks },
      ];
    }
    return current.map((h) => ({ side: h.pRight >= 0.5 ? 'derecha' : 'izquierda', landmarks: h.landmarks }));
  }

  reset(): void {
    this.tracks = [];
  }
}
