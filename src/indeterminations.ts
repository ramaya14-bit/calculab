// Detección y análisis de indeterminaciones y discontinuidades:
// - Indeterminaciones globales: k/0, 0/0, 0^0, ∞/∞, ∞ − ∞, 0·∞, 1^∞, ∞^0,
//   logaritmos de u ≤ 0, raíces pares de u < 0, polos trigonométricos exactos.
// - Indeterminaciones puntuales en funciones de x: huecos (0/0), saltos,
//   asíntotas verticales (k/0) y bordes de dominio, con cálculo de límites laterales.

import { derivative, rationalize, type MathJsInstance, type MathNode } from 'mathjs';
import { findRoots, fmt, type MathFunction } from './math';
import { pretty } from './parser';

export type IndeterminationForm =
  | '0/0'
  | 'k/0'
  | '0^0'
  | '∞/∞'
  | '∞ − ∞'
  | '0 · ∞'
  | '1^∞'
  | '∞^0'
  | 'ln(0)'
  | 'ln(u ≤ 0)'
  | '√(u < 0)'
  | 'dominio';

export interface GlobalIndetermination {
  form: IndeterminationForm;
  title: string;
  detail: string;
}

export type LimitSide =
  | { kind: 'finite'; value: number }
  | { kind: 'inf'; sign: 1 | -1 }
  | { kind: 'none' };

export type DiscontinuityKind = 'removable' | 'jump' | 'asymptote' | 'boundary' | 'oscillating';

export interface PointIndetermination {
  x: number;
  form: IndeterminationForm;
  kind: DiscontinuityKind;
  left: LimitSide;
  right: LimitSide;
  limit: number | null; // valor finito si lím⁻ = lím⁺ (o límite lateral único en borde)
  summary: string;
}

export interface SingularityGenerator {
  kind: 'division' | 'power' | 'log' | 'tan' | 'cot' | 'sec' | 'csc' | 'sqrt';
  // Funciones compiladas para evaluar subexpresiones
  primary: (x: number) => number;   // denominador, base, argumento de log/sqrt/trig
  secondary?: (x: number) => number; // numerador (division) o exponente (power)
}

export interface PointDiagnosis {
  form: IndeterminationForm;
  title: string;
  detail: string;
  limit?: number | null;
}

const ZERO_EPS = 1e-11;
const SAMPLE_XS = [-7.3, -4.1, -2.3, -1.1, -0.37, 0.29, 1.13, 2.71, 4.6, 8.2];

function safeCompile(node: MathNode): (x: number) => number {
  const code = node.compile();
  return (x: number) => {
    try {
      const v = code.evaluate({ x });
      return typeof v === 'number' ? v : NaN;
    } catch {
      return NaN;
    }
  };
}

function unwrap(node: MathNode): MathNode {
  let cur: MathNode = node;
  while (cur.type === 'ParenthesisNode') {
    cur = (cur as unknown as { content: MathNode }).content;
  }
  return cur;
}

function isIdenticallyZero(fn: (x: number) => number): boolean {
  let ok = 0;
  for (const x of SAMPLE_XS) {
    const v = fn(x);
    if (!Number.isFinite(v)) return false;
    if (Math.abs(v) > ZERO_EPS) return false;
    ok++;
  }
  return ok > 0;
}

function isIdenticallyOne(fn: (x: number) => number): boolean {
  let ok = 0;
  for (const x of SAMPLE_XS) {
    const v = fn(x);
    if (!Number.isFinite(v) || Math.abs(v - 1) > ZERO_EPS) return false;
    ok++;
  }
  return ok > 0;
}

function isAlwaysInfinite(fn: (x: number) => number): boolean {
  let ok = 0;
  for (const x of SAMPLE_XS) {
    const v = fn(x);
    if (v !== Infinity && v !== -Infinity) return false;
    ok++;
  }
  return ok > 0;
}

function isAlwaysNegative(fn: (x: number) => number): boolean {
  let ok = 0;
  for (const x of SAMPLE_XS) {
    const v = fn(x);
    if (!Number.isFinite(v) || v >= -ZERO_EPS) return false;
    ok++;
  }
  return ok > 0;
}

function isAlwaysNonPositive(fn: (x: number) => number): boolean {
  let ok = 0;
  for (const x of SAMPLE_XS) {
    const v = fn(x);
    if (!Number.isFinite(v) || v > ZERO_EPS) return false;
    ok++;
  }
  return ok > 0;
}

function hasSymbolX(node: MathNode): boolean {
  let found = false;
  node.traverse((n, path, parent) => {
    const isFn = parent?.type === 'FunctionNode' && path === 'fn';
    if (n.type === 'SymbolNode' && !isFn && (n as unknown as { name: string }).name === 'x') {
      found = true;
    }
  });
  return found;
}

function evalConst(node: MathNode): number {
  return safeCompile(node)(0);
}

/**
 * Inspecciona el árbol de la expresión en busca de indeterminaciones globales
 * (formas como k/0, 0/0, 0^0, ∞/∞, ∞ − ∞, 0·∞, 1^∞, ∞^0, ln(0), √(−1), tan(π/2)…).
 */
export function detectGlobalIndetermination(
  root: MathNode,
  _math?: MathJsInstance,
): GlobalIndetermination | null {
  let found: GlobalIndetermination | null = null;

  function inspect(raw: MathNode): void {
    if (found) return;
    const node = unwrap(raw);

    // Recorrer hijos primero para detectar indeterminaciones internas (ej. 1 + 5/0)
    if (node.type === 'OperatorNode') {
      const op = node as unknown as { fn: string; args: MathNode[] };
      for (const arg of op.args) inspect(arg);
      if (found) return;

      const [a, b] = op.args;
      if (!a) return;

      if (op.fn === 'divide' && b) {
        const fa = safeCompile(a);
        const fb = safeCompile(b);
        const denZero = isIdenticallyZero(fb);
        const numZero = isIdenticallyZero(fa);
        const numInf = isAlwaysInfinite(fa);
        const denInf = isAlwaysInfinite(fb);

        if (denZero) {
          if (numZero) {
            found = {
              form: '0/0',
              title: 'Indeterminación 0/0',
              detail: 'El numerador y el denominador son ambos 0: la expresión 0/0 es una forma indeterminada y no tiene valor definido.',
            };
          } else {
            found = {
              form: 'k/0',
              title: 'Indeterminado (división entre cero: k/0)',
              detail: 'No es posible dividir entre cero: el denominador vale 0, así que la expresión no tiene valor en ℝ. (A diferencia de 0/0, un número k ≠ 0 entre 0 no es una forma indeterminada sino una operación no definida: cerca de ese punto la función tiende a ±∞.)',
            };
          }
          return;
        }
        if (numInf && denInf) {
          found = {
            form: '∞/∞',
            title: 'Indeterminación ∞/∞',
            detail: 'Cociente de infinitos (∞/∞): es una forma indeterminada y no tiene un valor numérico único.',
          };
          return;
        }
      }

      if (op.fn === 'multiply' && b) {
        const fa = safeCompile(a);
        const fb = safeCompile(b);
        if ((isIdenticallyZero(fa) && isAlwaysInfinite(fb)) || (isAlwaysInfinite(fa) && isIdenticallyZero(fb))) {
          found = {
            form: '0 · ∞',
            title: 'Indeterminación 0 · ∞',
            detail: 'El producto de cero por infinito (0 · ∞) es una forma indeterminada.',
          };
          return;
        }
      }

      if ((op.fn === 'subtract' || op.fn === 'add') && b) {
        const fa = safeCompile(a);
        const fb = safeCompile(b);
        if (isAlwaysInfinite(fa) && isAlwaysInfinite(fb)) {
          const sa = Math.sign(fa(0));
          const sb = Math.sign(fb(0));
          const opposite = op.fn === 'subtract' ? sa === sb : sa === -sb;
          if (opposite) {
            found = {
              form: '∞ − ∞',
              title: 'Indeterminación ∞ − ∞',
              detail: 'La diferencia de infinitos del mismo signo (∞ − ∞) es una forma indeterminada.',
            };
            return;
          }
        }
      }

      if (op.fn === 'pow' && b) {
        const fa = safeCompile(a);
        const fb = safeCompile(b);
        const baseZero = isIdenticallyZero(fa);
        const expZero = isIdenticallyZero(fb);
        const baseOne = isIdenticallyOne(fa);
        const baseInf = isAlwaysInfinite(fa);
        const expInf = isAlwaysInfinite(fb);

        if (baseZero && expZero) {
          found = {
            form: '0^0',
            title: 'Indeterminación 0⁰',
            detail: 'Elevar cero a la potencia cero (0⁰) es una forma indeterminada en cálculo.',
          };
          return;
        }
        if (baseZero && isAlwaysNegative(fb)) {
          found = {
            form: 'k/0',
            title: 'Indeterminado (división entre cero: 0⁻ⁿ)',
            detail: 'Elevar 0 a un exponente negativo equivale a dividir entre 0 (1/0ⁿ), lo cual es indeterminado.',
          };
          return;
        }
        if (baseOne && expInf) {
          found = {
            form: '1^∞',
            title: 'Indeterminación 1^∞',
            detail: 'La expresión 1^∞ es una forma indeterminada.',
          };
          return;
        }
        if (baseInf && expZero) {
          found = {
            form: '∞^0',
            title: 'Indeterminación ∞⁰',
            detail: 'La expresión ∞⁰ es una forma indeterminada.',
          };
          return;
        }
      }
      return;
    }

    if (node.type === 'FunctionNode') {
      const fnNode = node as unknown as { fn: { name: string }; args: MathNode[] };
      for (const arg of fnNode.args) inspect(arg);
      if (found) return;

      const name = fnNode.fn.name;
      const arg = fnNode.args[0];
      if (!arg) return;
      const fArg = safeCompile(arg);
      const isConst = !hasSymbolX(arg);

      if (name === 'log' || name === 'log10' || name === 'log2') {
        if (isIdenticallyZero(fArg)) {
          found = {
            form: 'ln(0)',
            title: 'Indeterminado (logaritmo de 0)',
            detail: 'El logaritmo en 0 no está definido (tiende a −∞); requiere un argumento estrictamente positivo (u > 0).',
          };
          return;
        }
        if (isAlwaysNonPositive(fArg)) {
          found = {
            form: 'ln(u ≤ 0)',
            title: 'Indeterminado en ℝ (logaritmo de número no positivo)',
            detail: 'El logaritmo real solo existe cuando su argumento es mayor que cero (u > 0).',
          };
          return;
        }
      }

      if (name === 'sqrt') {
        if (isAlwaysNegative(fArg)) {
          found = {
            form: '√(u < 0)',
            title: 'Indeterminado en ℝ (raíz par de número negativo)',
            detail: 'La raíz cuadrada real solo está definida para valores mayores o iguales que cero (u ≥ 0).',
          };
          return;
        }
      }

      if ((name === 'tan' || name === 'sec') && isConst) {
        const v = evalConst(arg);
        if (Number.isFinite(v) && Math.abs(Math.cos(v)) < ZERO_EPS) {
          found = {
            form: 'k/0',
            title: `Indeterminado (${name} con coseno igual a 0)`,
            detail: `${name}(u) divide entre cos(u), que vale 0 en múltiplos impares de π/2 (división entre cero).`,
          };
          return;
        }
      }

      if ((name === 'cot' || name === 'csc') && isConst) {
        const v = evalConst(arg);
        if (Number.isFinite(v) && Math.abs(Math.sin(v)) < ZERO_EPS) {
          found = {
            form: 'k/0',
            title: `Indeterminado (${name} con seno igual a 0)`,
            detail: `${name}(u) divide entre sin(u), que vale 0 en múltiplos enteros de π (división entre cero).`,
          };
          return;
        }
      }

      if ((name === 'asin' || name === 'acos') && isConst) {
        const v = evalConst(arg);
        if (Number.isFinite(v) && Math.abs(v) > 1 + ZERO_EPS) {
          found = {
            form: 'dominio',
            title: `Indeterminado en ℝ (${name} fuera de [−1, 1])`,
            detail: `La función ${name}(u) solo está definida en los reales cuando −1 ≤ u ≤ 1.`,
          };
          return;
        }
      }
    }
  }

  inspect(root);
  return found;
}

/**
 * Extrae las subexpresiones que pueden provocar indeterminaciones puntuales
 * (denominadores, bases de potencias, argumentos de log/sqrt/trig).
 */
export function extractSingularityGenerators(root: MathNode): SingularityGenerator[] {
  const list: SingularityGenerator[] = [];

  root.traverse((raw) => {
    const node = unwrap(raw);
    if (node.type === 'OperatorNode') {
      const op = node as unknown as { fn: string; args: MathNode[] };
      if (op.fn === 'divide' && op.args.length === 2) {
        const [num, den] = op.args;
        if (hasSymbolX(den)) {
          list.push({
            kind: 'division',
            primary: safeCompile(den),
            secondary: safeCompile(num),
          });
        }
      } else if (op.fn === 'pow' && op.args.length === 2) {
        const [base, exp] = op.args;
        if (hasSymbolX(base)) {
          list.push({
            kind: 'power',
            primary: safeCompile(base),
            secondary: safeCompile(exp),
          });
        }
      }
    } else if (node.type === 'FunctionNode') {
      const fnNode = node as unknown as { fn: { name: string }; args: MathNode[] };
      const name = fnNode.fn.name;
      const arg = fnNode.args[0];
      if (!arg || !hasSymbolX(arg)) return;
      if (name === 'log' || name === 'log10' || name === 'log2') {
        list.push({ kind: 'log', primary: safeCompile(arg) });
      } else if (name === 'tan') {
        list.push({ kind: 'tan', primary: safeCompile(arg) });
      } else if (name === 'cot') {
        list.push({ kind: 'cot', primary: safeCompile(arg) });
      } else if (name === 'sec') {
        list.push({ kind: 'sec', primary: safeCompile(arg) });
      } else if (name === 'csc') {
        list.push({ kind: 'csc', primary: safeCompile(arg) });
      } else if (name === 'sqrt') {
        list.push({ kind: 'sqrt', primary: safeCompile(arg) });
      }
    }
  });

  return list;
}

// Redondea raíces que son casi exactamente enteros o fracciones sencillas (ej. 1.999999999 -> 2)
function snapExact(x: number, tol = 1e-6): number {
  const nearestInt = Math.round(x);
  if (Math.abs(x - nearestInt) < tol) return nearestInt;
  const nearestHalf = Math.round(x * 2) / 2;
  if (Math.abs(x - nearestHalf) < tol) return nearestHalf;
  // Múltiplos de pi/2 (para tan, sec, cot, csc)
  const kPi2 = Math.round(x / (Math.PI / 2));
  if (kPi2 !== 0 && Math.abs(x - kPi2 * (Math.PI / 2)) < tol) return kPi2 * (Math.PI / 2);
  return x;
}

// Estima el límite lateral de f(x) cuando x -> x0 + dir * 0⁺ (dir = -1 o +1)
export function estimateOneSidedLimit(f: (x: number) => number, x0: number, dir: -1 | 1): LimitSide {
  const scale = Math.max(1, Math.abs(x0));
  const epsilons = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6];
  const vals: number[] = [];

  for (const e of epsilons) {
    const y = f(x0 + dir * e * scale);
    if (Number.isFinite(y)) vals.push(y);
  }
  if (vals.length < 3) return { kind: 'none' };

  const last = vals[vals.length - 1];
  const prev = vals[vals.length - 2];
  const prev2 = vals[vals.length - 3];

  // Convergencia a un valor finito: las diferencias se achican
  const d1 = Math.abs(last - prev);
  const d2 = Math.abs(prev - prev2);
  if (d1 < 1e-2 * (1 + Math.abs(last)) && d1 <= d2 + 1e-4 && Math.abs(last) < 1e6) {
    return { kind: 'finite', value: snapExact(last, 1e-5) };
  }

  // Divergencia a +∞ o −∞: crece en magnitud con el mismo signo
  const sameSign = Math.sign(last) !== 0 && Math.sign(last) === Math.sign(prev) && Math.sign(prev) === Math.sign(prev2);
  if (sameSign && Math.abs(last) > Math.abs(prev) * 1.4 && Math.abs(last) > 20) {
    return { kind: 'inf', sign: Math.sign(last) > 0 ? 1 : -1 };
  }

  // Divergencia logarítmica lenta (como ln(x) cerca de 0): crece en cada década
  if (sameSign && Math.abs(last) > Math.abs(prev) + 1.5 && Math.abs(prev) > Math.abs(prev2) + 1.5 && Math.abs(last) > 8) {
    return { kind: 'inf', sign: Math.sign(last) > 0 ? 1 : -1 };
  }

  return { kind: 'none' };
}

// Nombre correcto de cada forma: 0/0, ∞/∞, 0^0… son INDETERMINACIONES (el valor
// depende del límite); k/0 con k ≠ 0 no es indeterminación sino división entre
// cero (la función no está definida y aparece una asíntota).
export function formLabel(form: IndeterminationForm): string {
  switch (form) {
    case 'k/0': return 'división entre cero (k/0)';
    case 'ln(0)': return 'logaritmo de 0';
    case 'ln(u ≤ 0)': return 'logaritmo no positivo';
    case '√(u < 0)': return 'raíz de negativo';
    case 'dominio': return 'fuera del dominio';
    default: return `indeterminación ${form}`;
  }
}

function capitalize(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function fmtLimitSide(side: LimitSide): string {
  if (side.kind === 'finite') return fmt(side.value);
  if (side.kind === 'inf') return side.sign > 0 ? '+∞' : '−∞';
  return 'no existe';
}

function classifySingularity(
  f: (x: number) => number,
  x0: number,
  form: IndeterminationForm,
): PointIndetermination {
  const left = estimateOneSidedLimit(f, x0, -1);
  const right = estimateOneSidedLimit(f, x0, 1);

  let kind: DiscontinuityKind;
  let limit: number | null = null;
  let summary: string;

  if (left.kind === 'finite' && right.kind === 'finite') {
    if (Math.abs(left.value - right.value) < 1e-2 * (1 + Math.abs(left.value))) {
      limit = (left.value + right.value) / 2;
      kind = 'removable';
      summary = `${formLabel(form)} (discontinuidad evitable / hueco) · lím = ${fmt(limit)}`;
    } else {
      kind = 'jump';
      summary = `${formLabel(form)} (salto) · lím⁻ = ${fmt(left.value)}, lím⁺ = ${fmt(right.value)}`;
    }
  } else if (left.kind === 'inf' || right.kind === 'inf') {
    kind = 'asymptote';
    const desc =
      left.kind === 'none'
        ? `lím⁺ = ${fmtLimitSide(right)}`
        : right.kind === 'none'
          ? `lím⁻ = ${fmtLimitSide(left)}`
          : `lím⁻ = ${fmtLimitSide(left)}, lím⁺ = ${fmtLimitSide(right)}`;
    summary = `${formLabel(form)} (asíntota vertical) · ${desc}`;
  } else if (left.kind === 'finite' && right.kind === 'none') {
    limit = left.value;
    kind = 'boundary';
    summary = `${formLabel(form)} (borde de dominio) · lím⁻ = ${fmt(limit)}`;
  } else if (right.kind === 'finite' && left.kind === 'none') {
    limit = right.value;
    kind = 'boundary';
    summary = `${formLabel(form)} (borde de dominio) · lím⁺ = ${fmt(limit)}`;
  } else {
    kind = 'oscillating';
    summary = `${formLabel(form)} · el límite no existe`;
  }

  return { x: x0, form, kind, left, right, limit, summary };
}

// Caché por función y ventana visible para mantener 60 FPS en el bucle de dibujo
const cache = new WeakMap<MathFunction, { key: string; points: PointIndetermination[] }>();

/**
 * Encuentra todas las indeterminaciones puntuales de fn visibles en [xMin, xMax].
 */
export function findPointIndeterminations(
  fn: MathFunction,
  xMin: number,
  xMax: number,
): PointIndetermination[] {
  if (fn.globalIndetermination) return [];

  const span = xMax - xMin;
  if (!(span > 0)) return [];

  const key = `${xMin.toFixed(3)}:${xMax.toFixed(3)}`;
  const hit = cache.get(fn);
  if (hit && hit.key === key) return hit.points;

  const candidates: { x: number; form: IndeterminationForm }[] = [];

  for (const gen of fn.singularityGenerators) {
    if (gen.kind === 'division') {
      const roots = findRoots(gen.primary, xMin, xMax, 600);
      for (const raw of roots) {
        const x0 = snapExact(raw);
        if (Math.abs(gen.primary(x0)) > 1e-4) continue;
        const numVal = gen.secondary ? gen.secondary(x0) : 1;
        let form: IndeterminationForm = 'k/0';
        if (Number.isFinite(numVal) && Math.abs(numVal) < 1e-7) form = '0/0';
        else if (!Number.isFinite(numVal)) form = '∞/∞';
        candidates.push({ x: x0, form });
      }
    } else if (gen.kind === 'power') {
      const roots = findRoots(gen.primary, xMin, xMax, 400);
      for (const raw of roots) {
        const x0 = snapExact(raw);
        if (Math.abs(gen.primary(x0)) > 1e-4) continue;
        const eVal = gen.secondary ? gen.secondary(x0) : 1;
        if (Number.isFinite(eVal) && Math.abs(eVal) < 1e-7) {
          candidates.push({ x: x0, form: '0^0' });
        } else if (Number.isFinite(eVal) && eVal < -1e-7) {
          candidates.push({ x: x0, form: 'k/0' });
        }
      }
    } else if (gen.kind === 'log') {
      const roots = findRoots(gen.primary, xMin, xMax, 400);
      for (const raw of roots) {
        const x0 = snapExact(raw);
        if (Math.abs(gen.primary(x0)) > 1e-4) continue;
        candidates.push({ x: x0, form: 'ln(0)' });
      }
    } else if (gen.kind === 'tan' || gen.kind === 'sec') {
      const roots = findRoots((x) => Math.cos(gen.primary(x)), xMin, xMax, 600);
      for (const raw of roots) {
        const x0 = snapExact(raw);
        if (Math.abs(Math.cos(gen.primary(x0))) > 1e-4) continue;
        candidates.push({ x: x0, form: 'k/0' });
      }
    } else if (gen.kind === 'cot' || gen.kind === 'csc') {
      const roots = findRoots((x) => Math.sin(gen.primary(x)), xMin, xMax, 600);
      for (const raw of roots) {
        const x0 = snapExact(raw);
        if (Math.abs(Math.sin(gen.primary(x0))) > 1e-4) continue;
        candidates.push({ x: x0, form: 'k/0' });
      }
    }
  }

  // Deduplicar candidatos muy cercanos (priorizando 0/0 sobre k/0 si se solapan)
  candidates.sort((a, b) => a.x - b.x);
  const merged: { x: number; form: IndeterminationForm }[] = [];
  const mergeTol = Math.max(1e-4, span * 1e-3);
  for (const c of candidates) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(c.x - prev.x) < mergeTol) {
      if (prev.form !== '0/0' && c.form === '0/0') prev.form = '0/0';
    } else {
      merged.push({ ...c });
    }
  }

  // Limitar a un máximo razonable (por ejemplo si el usuario hace zoom muy lejos en tan(x))
  const limited = merged.slice(0, 14);
  const points = limited.map((c) => classifySingularity(fn.f, c.x, c.form));
  cache.set(fn, { key, points });
  return points;
}

/**
 * Diagnóstico específico en el punto x = a (cuando f(a) no está definida o
 * x = a está sobre una indeterminación).
 */
export function diagnoseAtPoint(
  fn: MathFunction,
  a: number,
  visiblePoints: PointIndetermination[],
  snapTol = 1e-3,
): PointDiagnosis | null {
  if (fn.globalIndetermination) {
    return {
      form: fn.globalIndetermination.form,
      title: fn.globalIndetermination.title,
      detail: fn.globalIndetermination.detail,
    };
  }

  // 1. ¿Está x = a sobre una indeterminación puntual detectada?
  const near = visiblePoints.find((p) => Math.abs(p.x - a) <= snapTol);
  if (near) {
    const extra =
      near.kind === 'removable' && near.limit !== null
        ? `La función no está definida en x = ${fmt(near.x)}, pero el límite sí existe: lím x→${fmt(near.x)} f(x) = ${fmt(near.limit)} (hueco en la gráfica).`
        : near.kind === 'jump'
          ? `Salto en x = ${fmt(near.x)}: lím⁻ = ${fmtLimitSide(near.left)} y lím⁺ = ${fmtLimitSide(near.right)}, por lo que el límite no existe.`
          : near.kind === 'asymptote'
            ? `Asíntota vertical en x = ${fmt(near.x)}: lím⁻ = ${fmtLimitSide(near.left)}, lím⁺ = ${fmtLimitSide(near.right)}.`
            : `No está definida en x = ${fmt(near.x)} (${near.summary}).`;
    return {
      form: near.form,
      title: `${capitalize(formLabel(near.form))} en x = ${fmt(near.x)}`,
      detail: extra,
      limit: near.limit,
    };
  }

  // 2. Si f(a) no es finito, revisar los generadores estructurales en x = a
  if (!Number.isFinite(fn.f(a))) {
    for (const gen of fn.singularityGenerators) {
      const v = gen.primary(a);
      if (gen.kind === 'division' && Number.isFinite(v) && Math.abs(v) < 1e-6) {
        const num = gen.secondary ? gen.secondary(a) : 1;
        const form: IndeterminationForm = Number.isFinite(num) && Math.abs(num) < 1e-6 ? '0/0' : 'k/0';
        const info = classifySingularity(fn.f, a, form);
        return {
          form,
          title: `${capitalize(formLabel(form))} en x = ${fmt(a)}`,
          detail: info.summary,
          limit: info.limit,
        };
      }
      if (gen.kind === 'log' && Number.isFinite(v) && v <= ZERO_EPS) {
        return {
          form: Math.abs(v) < 1e-6 ? 'ln(0)' : 'ln(u ≤ 0)',
          title: `Indeterminado en x = ${fmt(a)} (logaritmo)`,
          detail: `El argumento del logaritmo vale ${fmt(v)} ≤ 0; en ℝ exige argumento estrictamente positivo.`,
        };
      }
      if (gen.kind === 'sqrt' && Number.isFinite(v) && v < -ZERO_EPS) {
        return {
          form: '√(u < 0)',
          title: `Indeterminado en x = ${fmt(a)} (raíz negativa)`,
          detail: `El radicando vale ${fmt(v)} < 0; la raíz cuadrada real requiere radicando ≥ 0.`,
        };
      }
    }
    return {
      form: 'dominio',
      title: `No definida en x = ${fmt(a)}`,
      detail: `f no está definida en x = ${fmt(a)} (fuera del dominio real).`,
    };
  }

  return null;
}

export interface LimitReport {
  targetText: string;
  directText: string;
  indetermination?: IndeterminationForm;
  leftText?: string;
  rightText?: string;
  resultText: string;
}

/**
 * Evalúa el límite de fn cuando x -> target (número finito o ±∞).
 */
export function evaluateLimit(fn: MathFunction, target: number | 'inf' | '-inf'): LimitReport {
  if (target === 'inf' || target === '-inf') {
    const sign = target === 'inf' ? 1 : -1;
    const targetText = sign > 0 ? '+∞' : '−∞';
    const xs = [1e2, 1e3, 1e4, 1e5].map((v) => sign * v);
    const ys = xs.map((x) => fn.f(x));
    const last = ys[ys.length - 1];
    const prev = ys[ys.length - 2];

    let resultText = 'no existe';
    if (Number.isFinite(last) && Number.isFinite(prev)) {
      if (Math.abs(last - prev) < 1e-2 * (1 + Math.abs(last))) {
        resultText = fmt(snapExact(last, 1e-4));
      } else if (Math.sign(last) === Math.sign(prev) && Math.abs(last) > Math.abs(prev) * 1.4 && Math.abs(last) > 50) {
        resultText = last > 0 ? '+∞' : '−∞';
      }
    }
    return {
      targetText,
      directText: `Evaluación asintótica cuando x → ${targetText}`,
      resultText,
    };
  }

  const direct = fn.f(target);
  const directOk = Number.isFinite(direct);
  const left = estimateOneSidedLimit(fn.f, target, -1);
  const right = estimateOneSidedLimit(fn.f, target, 1);

  let indet: IndeterminationForm | undefined;
  if (!directOk) {
    const diag = diagnoseAtPoint(fn, target, findPointIndeterminations(fn, target - 1, target + 1), 1e-4);
    if (diag) indet = diag.form;
  }

  let resultText = 'no existe';
  if (left.kind === 'finite' && right.kind === 'finite' && Math.abs(left.value - right.value) < 1e-2 * (1 + Math.abs(left.value))) {
    resultText = fmt((left.value + right.value) / 2);
  } else if (left.kind === 'inf' && right.kind === 'inf' && left.sign === right.sign) {
    resultText = left.sign > 0 ? '+∞' : '−∞';
  } else if (left.kind === 'finite' && right.kind === 'none') {
    resultText = `${fmt(left.value)} (solo por la izquierda)`;
  } else if (right.kind === 'finite' && left.kind === 'none') {
    resultText = `${fmt(right.value)} (solo por la derecha)`;
  }

  return {
    targetText: fmt(target),
    directText: directOk ? `f(${fmt(target)}) = ${fmt(direct)}` : `Indeterminado${indet ? ` (${indet})` : ''}`,
    indetermination: indet,
    leftText: fmtLimitSide(left),
    rightText: fmtLimitSide(right),
    resultText,
  };
}

// ---------- Paso a paso del límite (como en una clase) ----------

export interface LimitStep {
  title: string;
  text: string;   // explicación
  math?: string;  // cuenta o fórmula
  final?: boolean;
}

// Texto legible de un polinomio con coeficientes ascendentes [c0, c1, c2…]
function polyText(c: number[]): string {
  const parts: string[] = [];
  for (let i = c.length - 1; i >= 0; i--) {
    const v = Math.round(c[i] * 1e9) / 1e9;
    if (v === 0) continue;
    const abs = Math.abs(v);
    const coef = abs === 1 && i > 0 ? '' : fmt(abs);
    const pow = i === 0 ? '' : i === 1 ? 'x' : `x${String(i).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])}`;
    parts.push(`${v < 0 ? '−' : '+'} ${coef}${pow}`);
  }
  if (!parts.length) return '0';
  const t = parts.join(' ');
  return t.startsWith('+ ') ? t.slice(2) : '−' + t.slice(2);
}

function polyEval(c: number[], x: number): number {
  return c.reduceRight((acc, v) => acc * x + v, 0);
}

// Divide el polinomio entre (x − p) por Ruffini; devuelve el cociente
function ruffini(c: number[], p: number): number[] {
  const desc = [...c].reverse();
  const q: number[] = [desc[0]];
  for (let i = 1; i < desc.length - 1; i++) q.push(desc[i] + q[i - 1] * p);
  return q.reverse();
}

function polyCoefficients(node: MathNode): number[] | null {
  try {
    const r = rationalize(node, {}, true) as unknown as { coefficients: number[]; variables: string[]; denominator: unknown };
    if (r.denominator || !r.coefficients?.length) return null;
    return r.coefficients;
  } catch {
    return null;
  }
}

const wrapP = (t: string) => (/[+−\s]/.test(t) ? `(${t})` : t);
const xMinus = (p: number) => (p === 0 ? 'x' : p > 0 ? `(x − ${fmt(p)})` : `(x + ${fmt(-p)})`);

/**
 * Construye la resolución paso a paso de lím x→p f(x): sustitución directa,
 * identificación de la forma, resolución (factorizar y cancelar o L'Hôpital),
 * tabla de aproximación por ambos lados y conclusión.
 */
export function buildLimitSteps(fn: MathFunction, p: number): LimitStep[] {
  const steps: LimitStep[] = [];
  const P = fmt(p);
  steps.push({ title: 'Planteamiento', text: `Queremos saber a qué valor se acerca f(x) cuando x tiende a ${P}.`, math: `lím x→${P} ${fn.fText.replace(/^f\(x\) = /, '')}` });

  const direct = fn.f(p);
  const root = fn.node ? unwrap(fn.node) : null;
  const isQuotient = root?.type === 'OperatorNode' && (root as unknown as { fn: string }).fn === 'divide';
  const [numNode, denNode] = isQuotient ? (root as unknown as { args: MathNode[] }).args : [null, null];
  const num = numNode ? safeCompile(numNode) : null;
  const den = denNode ? safeCompile(denNode) : null;

  if (Number.isFinite(direct)) {
    steps.push({ title: 'Sustitución directa', text: `Sustituimos x = ${P}: la función está definida, así que el límite es ese valor (si f es continua ahí).`, math: `f(${P}) = ${fmt(direct)}` });
  } else if (num && den && Math.abs(den(p)) < 1e-9) {
    const nv = num(p);
    const zeroOverZero = Number.isFinite(nv) && Math.abs(nv) < 1e-9;
    steps.push({
      title: 'Sustitución directa',
      text: zeroOverZero
        ? `Al sustituir x = ${P} el numerador y el denominador valen 0: obtenemos 0/0, una forma indeterminada. No significa que el límite no exista; hay que transformar la expresión.`
        : `Al sustituir x = ${P} el denominador vale 0 pero el numerador vale ${fmt(nv)}: es k/0 (división entre cero). No es una indeterminación: la función crece sin límite (asíntota vertical). Hay que mirar el signo por cada lado.`,
      math: `numerador → ${fmt(nv)}, denominador → 0  ⇒  ${zeroOverZero ? '0/0' : `${fmt(nv)}/0`}`,
    });

    if (zeroOverZero) {
      const cn = polyCoefficients(numNode!);
      const cd = polyCoefficients(denNode!);
      if (cn && cd) {
        // Factorizar: ambos polinomios tienen la raíz x = p, se cancela (x − p)
        let a = cn, b = cd, k = 0;
        while (a.length > 1 && b.length > 1 && Math.abs(polyEval(a, p)) < 1e-9 && Math.abs(polyEval(b, p)) < 1e-9 && k < 6) {
          a = ruffini(a, p); b = ruffini(b, p); k++;
        }
        const factor = k > 1 ? `${xMinus(p)}^${k}` : xMinus(p);
        const nb = polyEval(b, p);
        const reduced = b.length === 1 && b[0] === 1 ? polyText(a) : `${wrapP(polyText(a))} / ${wrapP(polyText(b))}`;
        steps.push({
          title: 'Factorizar y simplificar',
          text: `Como x = ${P} anula numerador y denominador, ambos tienen el factor ${factor} (división sintética / Ruffini). Lo cancelamos, ya que x ≠ ${P} al calcular el límite.`,
          math: `[${factor}·${wrapP(polyText(a))}] / [${factor}·${wrapP(polyText(b))}]  =  ${reduced}`,
        });
        if (Math.abs(nb) > 1e-9) {
          steps.push({ title: 'Sustituir de nuevo', text: 'Ahora la expresión simplificada sí se puede evaluar.', math: `${reduced} en x = ${P}  →  ${fmt(polyEval(a, p) / nb)}` });
        }
      } else {
        // Regla de L'Hôpital: lím f/g = lím f'/g' (se repite mientras siga 0/0)
        try {
          let n = numNode!, d = denNode!;
          const lines: string[] = [];
          let value: number | null = null;
          for (let i = 0; i < 3 && value === null; i++) {
            n = derivative(n, 'x');
            d = derivative(d, 'x');
            const vn = safeCompile(n)(p);
            const vd = safeCompile(d)(p);
            if (!Number.isFinite(vn) || !Number.isFinite(vd)) break;
            if (Math.abs(vd) > 1e-9) {
              value = vn / vd;
              lines.push(`(${pretty(n)}) / (${pretty(d)})  en x = ${P}  →  ${fmt(vn)} / ${fmt(vd)} = ${fmt(value)}`);
            } else if (Math.abs(vn) < 1e-9) {
              lines.push(`(${pretty(n)}) / (${pretty(d)})  en x = ${P}  →  0/0 otra vez, derivamos de nuevo`);
            } else break;
          }
          // Solo se muestra si L'Hôpital realmente resuelve el límite
          if (value !== null) {
            steps.push({
              title: "Regla de L'Hôpital",
              text: "Con la forma 0/0 podemos derivar numerador y denominador por separado: lím f(x)/g(x) = lím f'(x)/g'(x).",
              math: lines.join('\n'),
            });
          }
        } catch {
          // si no se puede derivar, la tabla de aproximación decide
        }
      }
    }
  } else {
    const diag = diagnoseAtPoint(fn, p, findPointIndeterminations(fn, p - 1, p + 1), 1e-4);
    steps.push({ title: 'Sustitución directa', text: `Al sustituir x = ${P} la expresión no está definida (${diag ? formLabel(diag.form) : 'fuera del dominio'}): hay que mirar más de cerca.`, math: `f(${P}) no está definida` });
  }

  // Tabla de aproximación por izquierda y derecha
  const hs = [0.1, 0.01, 0.001];
  const cell = (x: number) => `f(${fmt(x)}) = ${Number.isFinite(fn.f(x)) ? fmt(fn.f(x)) : '—'}`;
  steps.push({
    title: 'Tabla de aproximación',
    text: `Nos acercamos a ${P} por la izquierda y por la derecha.`,
    math: `por la izquierda: ${hs.map((h) => cell(p - h)).join(', ')}\npor la derecha: ${[...hs].reverse().map((h) => cell(p + h)).join(', ')}`,
  });

  const rep = evaluateLimit(fn, p);
  const exists = !rep.resultText.startsWith('no existe');
  steps.push({
    title: 'Conclusión',
    text: exists
      ? rep.resultText.includes('∞')
        ? 'Ambos lados crecen sin límite en la misma dirección: el límite es infinito (asíntota vertical).'
        : Number.isFinite(direct)
          ? 'Ambos lados se acercan al mismo valor.'
          : `Ambos lados se acercan al mismo valor. f(${P}) no existe (círculo hueco en la gráfica), pero el límite sí.`
      : `Los límites laterales no coinciden (lím⁻ = ${rep.leftText}, lím⁺ = ${rep.rightText}): el límite no existe.`,
    math: `lím x→${P} f(x) = ${rep.resultText}`,
    final: true,
  });
  return steps;
}
