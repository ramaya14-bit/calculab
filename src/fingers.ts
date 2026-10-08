// Conteo de dedos levantados a partir de los 21 landmarks de MediaPipe.
//
// Mapa de índices (cada dedo: base → punta):
//   0  = muñeca
//   Pulgar:  1 CMC, 2 MCP, 3 IP,  4 punta
//   Índice:  5 MCP, 6 PIP, 7 DIP, 8 punta
//   Medio:   9 MCP, 10 PIP, 11 DIP, 12 punta
//   Anular: 13 MCP, 14 PIP, 15 DIP, 16 punta
//   Meñique: 17 MCP, 18 PIP, 19 DIP, 20 punta
//
// Recuerda: en la imagen, y crece HACIA ABAJO (y = 0 arriba, y = 1 abajo).

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// Distancia entre dos landmarks (puedes usarla o no, según tu método)
export function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Pares [punta, PIP] de índice, medio, anular y meñique
const FINGERS: [number, number][] = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];

/**
 * Devuelve cuántos dedos están levantados (0 a 5).
 *
 * Índice a meñique: un dedo está extendido si su punta está más lejos de la
 * muñeca (0) que su articulación PIP. Al usar distancias (y no solo "y"),
 * funciona aunque la mano esté inclinada.
 *
 * Pulgar: se mueve de lado, así que lo comparamos con la base del meñique (17):
 * está abierto si su punta (4) se aleja de 17 más que su articulación IP (3).
 * El factor 1.1 exige un margen para que el pulgar "a medias" no cuente.
 */
export function countFingers(lm: NormalizedLandmark[]): number {
  return fingerStates(lm).filter(Boolean).length;
}

/**
 * Estado de cada dedo: [pulgar, índice, medio, anular, meñique],
 * true = levantado. Lo usa la mano de control para reconocer gestos
 * concretos (puño, índice solo…), no solo cuántos dedos hay.
 */
export function fingerStates(lm: NormalizedLandmark[]): boolean[] {
  const wrist = lm[0];
  const thumb = dist(lm[4], lm[17]) > dist(lm[3], lm[17]) * 1.1;
  const others = FINGERS.map(([tip, pip]) => dist(lm[tip], wrist) > dist(lm[pip], wrist));
  return [thumb, ...others];
}
