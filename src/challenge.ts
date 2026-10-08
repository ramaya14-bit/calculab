// Reto aplicado (modo 5): la función se interpreta como una magnitud que
// cambia con el tiempo t, en uno de varios contextos (movimiento, temperatura).
// Su derivada es la RAZÓN DE CAMBIO de esa magnitud:
//   movimiento:   s(t) posición → s'(t) velocidad → s''(t) aceleración
//   temperatura:  T(t) grados   → T'(t) ritmo de calentamiento → T''(t)
// El usuario mueve el instante t con el dedo hasta cumplir la condición.

import { findRoots, fmt, type MathFunction } from './math';
import type { View } from './view';

// ---------- Contextos (situaciones aplicadas) ----------
export interface Context {
  intro: string;      // planteamiento de la situación
  value: string;      // nombre de la magnitud, p. ej. "Posición s(t)"
  rate: string;       // nombre de la razón de cambio, p. ej. "Velocidad s'(t)"
  rate2: string;      // nombre de la segunda derivada
  rateUnit: string;   // unidades de la razón de cambio
  marker: string;     // etiqueta del indicador lateral en el plano
  still: string;      // qué significa razón de cambio = 0 en este contexto
  rateZero2: string;  // qué significa segunda derivada = 0
}

const CONTEXTS: Context[] = [
  {
    intro: 'Un objeto se mueve en línea recta. Su posición, en metros, en el instante t (segundos) es s(t) = f(t).',
    value: 'Posición s(t)',
    rate: "Velocidad v(t) = s'(t)",
    rate2: "Aceleración a(t) = s''(t)",
    rateUnit: 'm/s',
    marker: 'objeto',
    still: 'el objeto está en reposo: su velocidad es 0 y puede cambiar de sentido',
    rateZero2: 'la aceleración es 0: la velocidad deja de bajar y empieza a subir (o al revés)',
  },
  {
    intro: 'En un experimento, la temperatura de una sustancia, en °C, t horas después de empezar es T(t) = f(t).',
    value: 'Temperatura T(t)',
    rate: "Ritmo de cambio T'(t)",
    rate2: "Cambio del ritmo T''(t)",
    rateUnit: '°C/h',
    marker: 'termómetro',
    still: 'la temperatura deja de subir o bajar por un instante: ritmo de cambio 0',
    rateZero2: 'el ritmo de calentamiento alcanza su valor más alto o más bajo',
  },
];

// ---------- Tipos de reto ----------
type Kind = 'reposo' | 'tasa' | 'valorMedio' | 'inflexion' | 'valor';
const KINDS: Kind[] = ['reposo', 'tasa', 'valorMedio', 'inflexion', 'valor'];

export interface Challenge {
  context: Context;
  title: string;
  statement: string;
  hint: string;
  answer: string;
  solutions: number[];                    // instantes t que cumplen el reto
  secant?: { t1: number; t2: number };    // solo en el reto de valor medio
}

// El objetivo debe mantenerse este número de cuadros (~0,5 s) para contar
const HOLD_FRAMES = 30;
// Margen de acierto, en píxeles de pantalla
const TOLERANCE_PX = 12;
// La pista aparece tras ~12 s sin resolver
const HINT_FRAMES = 12 * 60;

export class ChallengeRunner {
  challenge: Challenge | null = null;
  solved = false;
  solvedCount = 0;  // retos superados en la sesión
  progress = 0;     // 0 a 1 mientras se mantiene el punto en el objetivo
  showHint = false;
  private next = 0;
  private holdFrames = 0;
  private elapsed = 0;

  // Crea el siguiente reto, alternando tipos y contextos. Si un tipo no
  // tiene solución en la zona visible, se pasa al siguiente.
  newChallenge(fn: MathFunction, view: View): void {
    const xMin = view.toWorldX(0);
    const xMax = view.toWorldX(view.width);
    this.challenge = null;
    for (let i = 0; i < KINDS.length; i++) {
      const k = this.next % KINDS.length;
      const kind = KINDS[k];
      // En cada vuelta por los tipos se desplaza el contexto, para que
      // todos los tipos de reto aparezcan con todos los contextos
      const round = Math.floor(this.next / KINDS.length);
      const context = CONTEXTS[(k + round) % CONTEXTS.length];
      this.next++;
      const c = build(kind, context, fn, xMin, xMax, view.toWorldY(view.height), view.toWorldY(0));
      // Solo valen soluciones donde la función existe
      if (c) c.solutions = c.solutions.filter((t) => Number.isFinite(fn.f(t)));
      if (c && c.solutions.length > 0) {
        this.challenge = c;
        break;
      }
    }
    this.solved = false;
    this.holdFrames = 0;
    this.progress = 0;
    this.elapsed = 0;
    this.showHint = false;
  }

  update(t: number, view: View): void {
    if (!this.challenge || this.solved) return;
    this.elapsed++;
    if (this.elapsed > HINT_FRAMES) this.showHint = true;

    const tol = TOLERANCE_PX / view.scale;
    const near = this.challenge.solutions.some((s) => Math.abs(s - t) < tol);
    this.holdFrames = near ? this.holdFrames + 1 : 0;
    this.progress = this.holdFrames / HOLD_FRAMES;
    if (this.holdFrames >= HOLD_FRAMES) {
      this.solved = true;
      this.solvedCount++;
    }
  }
}

// Instante al azar dentro de la vista (zona central) donde f está definida
function randomDefinedT(fn: MathFunction, xMin: number, span: number): number | null {
  for (let i = 0; i < 30; i++) {
    const t = xMin + (0.15 + 0.7 * Math.random()) * span;
    if (Number.isFinite(fn.f(t)) && Number.isFinite(fn.df(t))) return t;
  }
  return null;
}

function build(
  kind: Kind, c: Context, fn: MathFunction, xMin: number, xMax: number, yMin: number, yMax: number,
): Challenge | null {
  const span = xMax - xMin;

  if (kind === 'valor') {
    // Valor objetivo tomado de un instante al azar: siempre tiene solución
    // (sirve incluso para funciones lineales)
    const t0 = randomDefinedT(fn, xMin, span);
    if (t0 === null) return null;
    const target = Number(fn.f(t0).toFixed(1));
    const name = c.value.split(' ')[0].toLowerCase();
    return {
      context: c,
      title: 'Reto: interpretar la gráfica',
      statement: `${c.intro} ¿En qué instante la ${name} vale ${fmt(target)}? Mueve t hasta encontrarlo y fíjate en la razón de cambio en ese momento.`,
      hint: `Imagina una recta horizontal a la altura ${fmt(target)} y busca dónde corta a la curva.`,
      answer: `En ese instante f(t) = ${fmt(target)}. La razón de cambio que ves en el panel dice si en ese momento la ${name} estaba subiendo (positiva) o bajando (negativa).`,
      solutions: findRoots((t) => fn.f(t) - target, xMin, xMax),
    };
  }

  if (kind === 'reposo') {
    return {
      context: c,
      title: 'Reto: razón de cambio cero',
      statement: `${c.intro} Mueve t hasta un instante en que ${c.still}.`,
      hint: 'Busca un punto donde la recta tangente quede horizontal (pendiente 0): una cima o un valle de la curva.',
      answer: `Ahí la razón de cambio es 0. En la gráfica es un punto crítico de f (f'(t) = 0).`,
      solutions: findRoots(fn.df, xMin, xMax),
    };
  }

  if (kind === 'tasa') {
    // Razón de cambio objetivo tomada de un instante al azar dentro de la
    // vista, así se garantiza que el reto tiene solución
    const t0 = randomDefinedT(fn, xMin, span);
    if (t0 === null) return null;
    const target = Number(fn.df(t0).toFixed(1));
    return {
      context: c,
      title: 'Reto: razón de cambio exacta',
      statement: `${c.intro} Encuentra un instante en que la razón de cambio sea ${fmt(target)} ${c.rateUnit}.`,
      hint: `La razón de cambio es la pendiente de la tangente. Busca donde la tangente tenga pendiente ${fmt(target)}${target > 0 ? ' (subiendo)' : target < 0 ? ' (bajando)' : ''}.`,
      answer: `La pendiente de la tangente en ese instante es ${fmt(target)}: esa es la razón de cambio instantánea, en ${c.rateUnit}.`,
      solutions: findRoots((t) => fn.df(t) - target, xMin, xMax),
    };
  }

  if (kind === 'valorMedio') {
    // Intervalo [t1, t2] dentro de la vista: la razón de cambio PROMEDIO es
    // la pendiente de la secante; el teorema del valor medio garantiza un
    // instante intermedio donde la razón INSTANTÁNEA es igual a ella.
    // Se prueban varios intervalos y se usa el primero cuyos dos extremos
    // se vean en pantalla.
    const visible = (y: number) => Number.isFinite(y) && y > yMin && y < yMax;
    const pair = [[0.2, 0.8], [0.25, 0.75], [0.3, 0.7], [0.35, 0.65], [0.15, 0.55], [0.45, 0.85]]
      .map(([p, q]) => [Number((xMin + p * span).toFixed(1)), Number((xMin + q * span).toFixed(1))])
      .find(([t1, t2]) => visible(fn.f(t1)) && visible(fn.f(t2)));
    if (!pair) return null;
    const [t1, t2] = pair;
    const mean = (fn.f(t2) - fn.f(t1)) / (t2 - t1);
    // Los negativos se escriben entre paréntesis al restar: 2 − (−2)
    const p = (v: number) => (v < 0 ? `(${fmt(v)})` : fmt(v));
    return {
      context: c,
      title: 'Reto: razón de cambio promedio e instantánea',
      statement: `${c.intro} Entre t = ${fmt(t1)} y t = ${fmt(t2)} la razón de cambio promedio fue ` +
        `[f(${fmt(t2)}) − f(${fmt(t1)})] / (${fmt(t2)} − ${p(t1)}) = ${fmt(mean)} ${c.rateUnit} (pendiente de la secante punteada). ` +
        'Encuentra un instante entre ellos en que la razón de cambio instantánea sea igual a la promedio.',
      hint: 'Busca un punto entre los dos extremos donde la tangente sea paralela a la secante punteada.',
      answer: 'Teorema del valor medio: si f es continua y derivable en el intervalo, existe al menos un instante en que la razón instantánea iguala a la promedio (tangente paralela a la secante).',
      solutions: findRoots((t) => fn.df(t) - mean, t1, t2),
      secant: { t1, t2 },
    };
  }

  return {
    context: c,
    title: 'Reto: segunda derivada cero',
    statement: `${c.intro} Encuentra el instante en que ${c.rateZero2}, es decir, f''(t) = 0.`,
    hint: 'Busca donde la curva cambia de "abrirse hacia arriba" a "abrirse hacia abajo": un punto de inflexión.',
    answer: 'Ahí la razón de cambio alcanza un máximo o un mínimo y la curva cambia de concavidad: es un punto de inflexión de f.',
    solutions: findRoots(fn.d2f, xMin, xMax),
  };
}
