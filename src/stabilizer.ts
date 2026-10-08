// Estabilizador: un valor solo se acepta si se repite varios cuadros seguidos.
// Evita "parpadeos" cuando MediaPipe duda entre dos lecturas.

export class Stabilizer<T> {
  private candidate: T;
  private frames = 0;

  constructor(private framesToConfirm: number, private value: T) {
    this.candidate = value;
  }

  push(reading: T): T {
    if (reading === this.candidate) {
      this.frames++;
    } else {
      this.candidate = reading;
      this.frames = 1;
    }
    if (this.frames >= this.framesToConfirm) this.value = this.candidate;
    return this.value;
  }
}
