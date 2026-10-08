// Vista del plano cartesiano: convierte coordenadas matemáticas (x, y)
// a píxeles de pantalla y viceversa. El desplazamiento y el zoom solo
// cambian el centro (cx, cy) y la escala; la gráfica se redibuja con eso.

const DEFAULT_SCALE = 60; // píxeles por unidad
const MIN_SCALE = 5;
const MAX_SCALE = 2000;

export class View {
  cx = 0;               // coordenada x del mundo en el centro de la pantalla
  cy = 0;               // coordenada y del mundo en el centro de la pantalla
  scale = DEFAULT_SCALE;
  width = 0;            // tamaño del área en píxeles CSS
  height = 0;

  toScreenX(x: number): number { return this.width / 2 + (x - this.cx) * this.scale; }
  // En pantalla y crece hacia abajo; en matemáticas hacia arriba: por eso el signo menos
  toScreenY(y: number): number { return this.height / 2 - (y - this.cy) * this.scale; }
  toWorldX(px: number): number { return this.cx + (px - this.width / 2) / this.scale; }
  toWorldY(py: number): number { return this.cy - (py - this.height / 2) / this.scale; }

  // Mueve el contenido dx, dy píxeles (como arrastrar el papel)
  pan(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.scale;
    this.cy += dyPx / this.scale;
  }

  // Acerca (factor > 1) o aleja (factor < 1) manteniendo fijo el punto (px, py)
  zoomAt(factor: number, px: number, py: number): void {
    const wx = this.toWorldX(px);
    const wy = this.toWorldY(py);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    // Recolocamos el centro para que (wx, wy) siga bajo el mismo píxel
    this.cx = wx - (px - this.width / 2) / this.scale;
    this.cy = wy + (py - this.height / 2) / this.scale;
  }

  // Vuelve al estado inicial: origen al centro y unas 10 unidades de ancho,
  // así en teléfono y en computador se ve la misma porción del plano
  reset(): void {
    this.cx = 0;
    this.cy = 0;
    this.scale = this.width > 0 ? this.width / 10 : DEFAULT_SCALE;
  }
}
