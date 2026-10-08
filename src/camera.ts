// Módulo de cámara: pide permiso y conecta el video de la webcam al <video>.

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  // getUserMedia muestra el cuadro de permiso del navegador.
  // Solo funciona en https o en localhost.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;

  // Esperamos a que el video tenga datos antes de usarlo en MediaPipe
  await new Promise<void>((resolve) => {
    video.onloadeddata = () => resolve();
  });
}

// Traduce los errores de getUserMedia a mensajes entendibles para el usuario
export function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Permiso de cámara denegado. Habilítalo en el navegador.';
    if (err.name === 'NotFoundError') return 'No se encontró ninguna cámara.';
    if (err.name === 'NotReadableError') return 'La cámara está siendo usada por otra aplicación.';
  }
  return 'No se pudo iniciar la cámara.';
}
