# CalcuLab

Laboratorio interactivo de cálculo diferencial. Proyecto de aula del curso de Cálculo Diferencial — Fundación Universitaria del Área Andina.

**Estudiante:** Ricardo Andrés Amaya Hernández · **Docente:** Dellerlin Astrid Cepeda Orozco

La aplicación reconoce las manos con la cámara y permite explorar cualquier función f(x) con gestos:

| Mano derecha | Acción |
| --- | --- |
| 1 dedo | Evaluar f(a) y observar la pendiente |
| 2 dedos | Construir la recta tangente en x = a |
| 3 dedos | Mostrar f(x), f'(x) y f''(x) |
| 4 dedos | Puntos críticos, máximos y mínimos |
| 5 dedos | Reto aplicado (razón de cambio) |

La mano izquierda mueve la vista (puño) y hace zoom (pinza pulgar–índice). Sin cámara funciona con botones, teclado y mouse.

## Tecnologías

HTML, CSS y TypeScript · Vite · MediaPipe Hand Landmarker (reconocimiento de manos) · math.js (derivadas simbólicas) · Canvas 2D (gráficas y partículas).

## Ejecutar en local

Requiere Node.js 18 o superior.

```bash
npm install
npm run dev
```

Abrir `http://localhost:5173`, pulsar **Ver Cámara** y aceptar el permiso.

## Estructura

| Archivo (`src/`) | Qué hace |
| --- | --- |
| `main.ts` | Ciclo principal: conecta cámara, gestos, matemática e interfaz |
| `camera.ts`, `handTracker.ts` | Cámara y MediaPipe |
| `handSides.ts` | Distingue la mano derecha de la izquierda |
| `fingers.ts`, `stabilizer.ts` | Conteo de dedos y estabilización |
| `handControl.ts`, `view.ts` | Desplazamiento y zoom del plano |
| `parser.ts` | Lee la función escrita y calcula sus derivadas |
| `math.ts` | Raíces, puntos críticos e intervalos de crecimiento |
| `modes.ts`, `challenge.ts` | Las cinco interacciones y el reto |
| `graph.ts`, `particles.ts` | Dibujo del plano, curvas y partículas |
