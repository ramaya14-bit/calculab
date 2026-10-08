// Módulo de reconocimiento de manos con MediaPipe Hand Landmarker.
// Por cada mano detectada devuelve 21 puntos (landmarks) con coordenadas x, y, z
// normalizadas entre 0 y 1 respecto a la imagen.

import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function createHandTracker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO', // procesa cuadro por cuadro de un video
    numHands: 2,          // una mano para el modo y otra para desplazamiento/zoom
  });
}

export function detectHands(tracker: HandLandmarker, video: HTMLVideoElement): HandLandmarkerResult {
  return tracker.detectForVideo(video, performance.now());
}
