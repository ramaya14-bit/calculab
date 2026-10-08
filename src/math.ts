// Motor matemático: herramientas numéricas para encontrar raíces, puntos
// críticos, discontinuidades e intervalos de crecimiento de CUALQUIER función.
// La función en sí la construye parser.ts a partir del texto del usuario.

export interface MathFunction {
  f: (x: number) => number;
  df: (x: number) => number;   // primera derivada f'(x)
  d2f: (x: number) => number;  // segunda derivada f''(x)
  fText: string;
  dfText: string;
  d2fText: string;
  symbolic: boolean;           // true si las derivadas se obtuvieron simbólicamente
}

// Derivada numérica por diferencia central:
//   g'(x) ≈ [g(x + h) − g(x − h)] / 2h
// Es la definición de derivada con un h pequeño en lugar del límite.
export function numericDerivative(g: (x: number) => number, x: number, h = 1e-4): number {
  return (g(x + h) - g(x - h)) / (2 * h);
}

// Compara las derivadas simbólicas con las numéricas en varios puntos.
// Sirve para comprobar que la derivación es correcta.
// Devuelve una lista de errores (vacía si todo coincide).
export function checkDerivatives(fn: MathFunction, from = -5, to = 5, samples = 60): string[] {
  const errors: string[] = [];
  const pairs: [string, (x: number) => number, (x: number) => number][] = [
    ["f'", fn.df, fn.f],
    ["f''", fn.d2f, fn.df],
  ];
  for (const [name, written, base] of pairs) {
    for (let i = 0; i <= samples; i++) {
      // El desplazamiento 0.0137 evita caer justo en puntos especiales (x = 0…)
      const x = from + ((to - from) * i) / samples + 0.0137;
      const expected = numericDerivative(base, x);
      const actual = written(x);
      if (!Number.isFinite(expected) || !Number.isFinite(actual)) continue;
      if (Math.abs(actual - expected) > 1e-3 * Math.max(1, Math.abs(expected))) {
        errors.push(`${name}(x) no coincide en x = ${x.toFixed(2)}: simbólica ${actual.toFixed(4)}, numérica ${expected.toFixed(4)}`);
        break;
      }
    }
  }
  return errors;
}

// Bisección: si g cambia de signo en [a, b], parte el intervalo a la mitad
// repetidamente hasta encerrar el punto de cambio (teorema del valor intermedio).
function bisect(g: (x: number) => number, a: number, b: number): number {
  let ga = g(a);
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const gm = g(m);
    if (ga * gm <= 0) {
      b = m;
    } else {
      a = m;
      ga = gm;
    }
  }
  return (a + b) / 2;
}

// Búsqueda ternaria del mínimo de |g| en [a, b]
function minimizeAbs(g: (x: number) => number, a: number, b: number): number {
  for (let i = 0; i < 80; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (Math.abs(g(m1)) < Math.abs(g(m2))) b = m2;
    else a = m1;
  }
  return (a + b) / 2;
}

function sample(g: (x: number) => number, xMin: number, xMax: number, n: number): number[] {
  const dx = (xMax - xMin) / n;
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) ys.push(g(xMin + i * dx));
  return ys;
}

// Busca las raíces de g en [xMin, xMax] recorriendo n subintervalos.
// Detecta cambios de signo (y los refina con bisección) y también raíces
// "que tocan" el eje sin cruzarlo, como x² en x = 0.
export function findRoots(g: (x: number) => number, xMin: number, xMax: number, n = 1500): number[] {
  const dx = (xMax - xMin) / n;
  const ys = sample(g, xMin, xMax, n);

  // Si g vale 0 en buena parte del intervalo (p. ej. f'' de una recta),
  // no tiene raíces aisladas: es idénticamente cero
  if (ys.filter((y) => y === 0).length > n * 0.2) return [];

  const roots: number[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = xMin + i * dx;
    const y0 = ys[i], y1 = ys[i + 1];
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;

    if (y0 === 0) {
      roots.push(x0);
    } else if (y0 * y1 < 0) {
      const r = bisect(g, x0, x0 + dx);
      // Un cambio de signo con valor enorme es una asíntota, no una raíz
      if (Math.abs(g(r)) < 1e-6) roots.push(r);
    } else if (i > 0 && Math.abs(y0) < Math.abs(ys[i - 1]) && Math.abs(y0) < Math.abs(y1)) {
      // Mínimo local de |g|: se refina y, si llega a ~0, es una raíz que
      // toca el eje sin cruzarlo
      const m = minimizeAbs(g, x0 - dx, x0 + dx);
      if (Math.abs(g(m)) < 1e-6) roots.push(m);
    }
  }
  // Elimina duplicados muy cercanos
  return roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]) > dx);
}

// "Rupturas" de g: bordes del dominio (pasa de definida a no definida) y
// saltos de signo que no son raíces (asíntotas, como 1/x en x = 0).
export function findBreaks(g: (x: number) => number, xMin: number, xMax: number, n = 800): number[] {
  const dx = (xMax - xMin) / n;
  const ys = sample(g, xMin, xMax, n);
  const breaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = xMin + i * dx;
    const ok0 = Number.isFinite(ys[i]);
    const ok1 = Number.isFinite(ys[i + 1]);
    if (ok0 !== ok1) {
      breaks.push(domainEdge(g, x0, x0 + dx)); // borde del dominio
    } else if (ok0 && ys[i] * ys[i + 1] < 0) {
      const r = bisect(g, x0, x0 + dx);
      if (!(Math.abs(g(r)) < 1e-6)) breaks.push(r); // salto, no raíz
    }
  }
  // Un solo punto no definido (como 1/x en x = 0) produce dos bordes casi
  // iguales, uno a cada lado: se funden en uno
  const merged: number[] = [];
  for (const b of breaks) {
    const last = merged[merged.length - 1];
    if (last !== undefined && b - last < dx * 1.5) merged[merged.length - 1] = (last + b) / 2;
    else merged.push(b);
  }
  return merged;
}

// Bisección sobre "¿g está definida?": ubica el borde del dominio entre a y b
// (en uno de los dos extremos g existe y en el otro no)
function domainEdge(g: (x: number) => number, a: number, b: number): number {
  const okA = Number.isFinite(g(a));
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (Number.isFinite(g(m)) === okA) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

export type CriticalType = 'máximo' | 'mínimo' | 'ni máximo ni mínimo';

export interface CriticalPoint {
  x: number;
  y: number;
  type: CriticalType;
  noDerivative: boolean; // true si en ese punto f'(x) no existe (como |x| en 0)
}

// Criterio de la primera derivada: si f' pasa de + a − es máximo; de − a +, mínimo
function classify(fn: MathFunction, x: number, h: number): CriticalType {
  const left = fn.df(x - h);
  const right = fn.df(x + h);
  return left > 0 && right < 0 ? 'máximo' : left < 0 && right > 0 ? 'mínimo' : 'ni máximo ni mínimo';
}

// Puntos críticos: donde f'(x) = 0 o donde f'(x) no existe pero f sí es
// continua (picos como |x| en x = 0).
export function criticalPoints(fn: MathFunction, xMin: number, xMax: number): CriticalPoint[] {
  const h = (xMax - xMin) * 1e-4;
  const points: CriticalPoint[] = findRoots(fn.df, xMin, xMax)
    .filter((x) => Number.isFinite(fn.f(x)))
    .map((x) => ({ x, y: fn.f(x), type: classify(fn, x, h), noDerivative: false }));

  for (const x of findBreaks(fn.df, xMin, xMax)) {
    // f debe existir y ser continua a ambos lados del punto
    const tiny = (xMax - xMin) * 1e-6;
    const near = (xMax - xMin) * 1e-3;
    const yl = fn.f(x - tiny), yr = fn.f(x + tiny);
    if (!Number.isFinite(yl) || !Number.isFinite(yr)) continue;
    if (Math.abs(yl - yr) > 1e-3 * (1 + Math.abs(yl))) continue;
    // …y no dispararse al acercarse (descarta asíntotas como 1/x² en 0)
    if (Math.abs(yl) > 10 * Math.abs(fn.f(x - near)) + 1) continue;
    if (points.some((p) => Math.abs(p.x - x) < h * 10)) continue;
    points.push({ x, y: (yl + yr) / 2, type: classify(fn, x, h), noDerivative: true });
  }
  return points.sort((p, q) => p.x - q.x);
}

export interface Interval {
  from: number;
  to: number;
  increasing: boolean;
}

// Intervalos de crecimiento. Se corta el rango visible en los puntos
// críticos y en las rupturas (asíntotas, bordes del dominio); dentro de cada
// trozo el signo de f' no cambia, así que basta evaluarlo en el centro.
export function monotonyIntervals(fn: MathFunction, xMin: number, xMax: number, critical: CriticalPoint[]): Interval[] {
  const breaks = [...findBreaks(fn.f, xMin, xMax), ...findBreaks(fn.df, xMin, xMax)];
  const cuts = [xMin, xMax, ...critical.map((c) => c.x), ...breaks].sort((p, q) => p - q);

  const intervals: Interval[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i], to = cuts[i + 1];
    if (to - from < (xMax - xMin) * 1e-4) continue;
    // Se prueba el centro y, si no está definido, puntos cercanos
    let d = NaN;
    for (const t of [0.5, 0.25, 0.75]) {
      const x = from + (to - from) * t;
      if (Number.isFinite(fn.f(x)) && Number.isFinite(fn.df(x))) { d = fn.df(x); break; }
    }
    if (!Number.isFinite(d) || d === 0) continue;

    const increasing = d > 0;
    const prev = intervals[intervals.length - 1];
    // Se unen tramos vecinos con el mismo sentido si los separa un punto
    // crítico que no es extremo (como x³ en x = 0), no una ruptura
    const joinable = prev && prev.to === from && prev.increasing === increasing &&
      critical.some((c) => c.x === from && c.type === 'ni máximo ni mínimo');
    if (joinable) prev.to = to;
    else intervals.push({ from, to, increasing });
  }
  return intervals;
}

// Primer punto cercano a x0 donde f está definida (para colocar x = a)
export function nearestDefined(f: (x: number) => number, x0: number): number {
  for (let k = 0; k <= 200; k++) {
    for (const x of [x0 + k * 0.05, x0 - k * 0.05]) {
      if (Number.isFinite(f(x))) return x;
    }
  }
  return x0;
}

// Formato de números para la interfaz: 3 decimales como máximo y signo
// menos tipográfico (−) para que se lea mejor
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return 'no definido';
  if (Math.abs(v) < 1e-9) return '0';
  return String(Number(v.toFixed(3))).replace('-', '−');
}
