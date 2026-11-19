// Lector de funciones y ecuaciones: convierte el texto que escribe el usuario
// (por ejemplo "x^3 - 3x", "(x^2-4)/(x-2)", "x^2 - 4 = 0" o "x/0") en una
// MathFunction con sus derivadas, análisis de indeterminaciones y raíces.

import { create, all, type MathNode } from 'mathjs';
import {
  detectGlobalIndetermination,
  extractSingularityGenerators,
  type GlobalIndetermination,
} from './indeterminations';
import { numericDerivative, type MathFunction } from './math';

// predictable: true hace que sqrt(-1) o log(-1) den NaN en lugar de un
// número complejo; así "fuera del dominio" siempre es NaN.
const math = create(all, { predictable: true });

export const DEFAULT_EXPRESSION = 'x^3 - 3x';

export const EXAMPLES = [
  'x^3 - 3x',
  'x^4 - 4x^2',
  'sin(x)',
  'e^x',
  'ln(x)',
  '1/x',
  '(x^2-4)/(x-2)',
  'sin(x)/x',
  'x^2 - 4 = 0',
  'x/0',
  'abs(x)',
];

// Nombres que no son variables (constantes de math.js)
const CONSTANTS = new Set(['e', 'pi', 'E', 'PI', 'Infinity']);

const FROM_SUPERSCRIPT: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-',
};

// Ajusta la escritura habitual en clase a la sintaxis de math.js
function normalizeExpr(input: string): string {
  return input
    .trim()
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (seq) => `^(${seq.split('').map((c) => FROM_SUPERSCRIPT[c]).join('')})`)
    .replace(/[−–]/g, '-')
    .replace(/[·×]/g, '*')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√\s*([a-zA-Z0-9_.]+)/g, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi')
    .replace(/∞/g, 'Infinity')
    .replace(/\binf\b/gi, 'Infinity')
    .replace(/\bln\s*\(/gi, 'log(')  // en math.js log(x) es el logaritmo natural
    .replace(/\bsen\s*\(/gi, 'sin(')
    .replace(/\btg\s*\(/gi, 'tan(');
}

// Quita el prefijo "f(x) =" o "y =" cuando abre la expresión
function stripFnPrefix(input: string): string {
  return input.trim().replace(/^(?:f\s*\(\s*x\s*\)|y)\s*=\s*/i, '');
}

// Detecta un prefijo de límite: "lim x->2 (x^2-4)/(x-2)" o "lím x→0 sin(x)/x"
function extractLimitPrefix(input: string): { target: number | 'inf' | '-inf'; body: string } | null {
  const m = input
    .trim()
    .match(/^(?:l[ií]m|limit)\s*(?:_?\s*\{|\()?\s*x\s*(?:->|→)\s*([+-]?(?:\d+(?:\.\d+)?|inf|infinity|∞))\s*(?:\}|\))?\s*(.+)$/i);
  if (!m) return null;
  const rawTarget = m[1].trim().toLowerCase();
  const body = m[2].trim();
  if (!body) return null;
  if (rawTarget === 'inf' || rawTarget === '+inf' || rawTarget === 'infinity' || rawTarget === '+infinity' || rawTarget === '∞' || rawTarget === '+∞') {
    return { target: 'inf', body };
  }
  if (rawTarget === '-inf' || rawTarget === '-infinity' || rawTarget === '-∞') {
    return { target: '-inf', body };
  }
  const n = Number(rawTarget);
  return Number.isFinite(n) ? { target: n, body } : null;
}

// Verifica que solo aparezca la variable x (además de constantes y funciones)
function assertOnlyX(node: MathNode): void {
  const unknown = new Set<string>();
  node.traverse((n, path, parent) => {
    const isFunctionName = parent?.type === 'FunctionNode' && path === 'fn';
    if (n.type === 'SymbolNode' && !isFunctionName) {
      const name = (n as unknown as { name: string }).name;
      if (name !== 'x' && !CONSTANTS.has(name)) unknown.add(name);
    }
  });
  if (unknown.size > 0) {
    throw new Error(`Variable desconocida: ${[...unknown].join(', ')}. Usa solo x.`);
  }
}

// Convierte un árbol de math.js en una función de JavaScript. Cualquier
// resultado que no sea un número real (error, complejo…) se vuelve NaN.
function compile(node: MathNode): (x: number) => number {
  const code = node.compile();
  return (x) => {
    try {
      const v = code.evaluate({ x });
      return typeof v === 'number' ? v : NaN;
    } catch {
      return NaN;
    }
  };
}

// Texto legible para el panel: 3 * x ^ 2 → 3x², log → ln, pi → π
const SUPERSCRIPT: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function pretty(node: MathNode): string {
  return node
    .toString({ parenthesis: 'auto', implicit: 'hide' })
    .replace(/\s*\^\s*(\d+)(?![\d.])/g, (_, d: string) => d.split('').map((c) => SUPERSCRIPT[c]).join(''))
    .replace(/\s*\^\s*/g, '^')
    .replace(/(\d)\s*\*?\s*(?=[a-zA-Z(])/g, '$1') // 3 * x o 3 x → 3x
    .replace(/\babs\(([^()]*)\)/g, '|$1|')
    .replace(/\s*\*\s*/g, '·')
    .replace(/\blog\(/g, 'ln(')
    .replace(/\bpi\b/g, 'π')
    .replace(/\bInfinity\b/g, '∞')
    .replace(/-/g, '−');
}

function isLiteralZero(text: string): boolean {
  const t = text.trim().replace(/^\(+|\)+$/g, '').trim();
  return /^[+-]?0(?:\.0+)?$/.test(t);
}

function buildIndeterminateFunction(
  rawExpression: string,
  fText: string,
  indet: GlobalIndetermination,
  isEquation: boolean,
  equationText?: string,
  limitTarget?: number | 'inf' | '-inf' | null,
): MathFunction {
  const nan = () => NaN;
  return {
    f: nan,
    df: nan,
    d2f: nan,
    fText,
    dfText: "f'(x) = indeterminada",
    d2fText: "f''(x) = indeterminada",
    symbolic: false,
    rawExpression,
    isEquation,
    equationText,
    globalIndetermination: indet,
    singularityGenerators: [],
    limitTarget: limitTarget ?? null,
  };
}

/**
 * Lee la expresión (función, ecuación "= 0" / "A = B", límite o indeterminación)
 * y devuelve la MathFunction con sus derivadas y análisis de indeterminaciones.
 * Lanza un Error en español solo cuando hay un error de sintaxis o variable inválida.
 */
export function parseFunction(input: string): MathFunction {
  const rawTrimmed = input.trim();
  if (rawTrimmed === '') throw new Error('Escribe una función o ecuación de x, por ejemplo x^2 - 4 o x^2 - 4 = 0.');

  let working = rawTrimmed;
  let limitTarget: number | 'inf' | '-inf' | null = null;

  const lim = extractLimitPrefix(working);
  if (lim) {
    limitTarget = lim.target;
    working = lim.body;
  }

  working = stripFnPrefix(working);
  if (working === '') throw new Error('Escribe una función o ecuación de x, por ejemplo x^2 - 4 o x^2 - 4 = 0.');

  // Comprobar si es una ecuación (contiene "=")
  let isEquation = false;
  let equationText: string | undefined;
  let node: MathNode;
  let lhsNode: MathNode | null = null;
  let rhsNode: MathNode | null = null;

  if (working.includes('=')) {
    const parts = working.split('=');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      throw new Error('Usa un solo signo "=" con una expresión a cada lado, por ejemplo x^2 - 4 = 0.');
    }
    isEquation = true;
    const lhsText = normalizeExpr(parts[0]);
    const rhsText = normalizeExpr(parts[1]);
    try {
      lhsNode = math.parse(lhsText);
      rhsNode = math.parse(rhsText);
    } catch (err) {
      throw new Error(`No se entiende la ecuación: ${(err as Error).message}`);
    }
    assertOnlyX(lhsNode);
    assertOnlyX(rhsNode);

    if (isLiteralZero(rhsText)) {
      node = lhsNode;
      equationText = `${pretty(lhsNode)} = 0`;
    } else if (isLiteralZero(lhsText)) {
      node = rhsNode;
      equationText = `${pretty(rhsNode)} = 0`;
    } else {
      node = math.parse(`(${lhsText}) - (${rhsText})`);
      equationText = `${pretty(lhsNode)} = ${pretty(rhsNode)}  ⇔  ${pretty(node)} = 0`;
    }
  } else {
    const text = normalizeExpr(working);
    try {
      node = math.parse(text);
    } catch (err) {
      throw new Error(`No se entiende la expresión: ${(err as Error).message}`);
    }
    assertOnlyX(node);
  }

  const fText = `f(x) = ${pretty(node)}`;

  // 1) Detectar indeterminaciones globales (k/0, 0/0, 0^0, ∞/∞, ln(0), √(-1)…)
  const globalIndet =
    (lhsNode && detectGlobalIndetermination(lhsNode, math)) ||
    (rhsNode && detectGlobalIndetermination(rhsNode, math)) ||
    detectGlobalIndetermination(node, math);

  if (globalIndet) {
    return buildIndeterminateFunction(rawTrimmed, fText, globalIndet, isEquation, equationText, limitTarget);
  }

  const singularityGenerators = extractSingularityGenerators(node);
  const rawF = compile(node);

  // En JS/mathjs 0^0 evalúa a 1; en cálculo es una forma indeterminada (0^0 → NaN)
  const powerGens = singularityGenerators.filter((g) => g.kind === 'power');
  const f =
    powerGens.length === 0
      ? rawF
      : (x: number) => {
          for (const g of powerGens) {
            const b = g.primary(x);
            const e = g.secondary ? g.secondary(x) : 1;
            if (Number.isFinite(b) && Math.abs(b) < 1e-12 && Number.isFinite(e) && Math.abs(e) < 1e-12) {
              return NaN;
            }
          }
          return rawF(x);
        };

  // Comprobar si la función está definida en al menos algún punto real de [-10, 10]
  let definedCount = 0;
  let zeroCount = 0;
  let constVal: number | null = null;
  let allSameConst = true;

  for (let x = -10; x <= 10; x += 0.37) {
    const y = f(x);
    if (Number.isFinite(y)) {
      definedCount++;
      if (Math.abs(y) < 1e-11) zeroCount++;
      if (constVal === null) constVal = y;
      else if (Math.abs(y - constVal) > 1e-9) allSameConst = false;
    }
  }

  if (definedCount === 0) {
    return buildIndeterminateFunction(
      rawTrimmed,
      fText,
      {
        form: 'dominio',
        title: 'Indeterminado / Fuera del dominio real',
        detail: 'La expresión no produce valores reales finitos en [−10, 10] (puede implicar división entre cero, raíz negativa o logaritmo no positivo).',
      },
      isEquation,
      equationText,
      limitTarget,
    );
  }

  let equationKind: 'normal' | 'identity' | 'contradiction' | undefined;
  if (isEquation) {
    if (allSameConst && zeroCount === definedCount) equationKind = 'identity';
    else if (allSameConst && constVal !== null && Math.abs(constVal) > 1e-9) equationKind = 'contradiction';
    else equationKind = 'normal';
  }

  // La derivada solo existe donde existe f. La fórmula simbólica puede dar
  // valores fuera del dominio (la derivada de ln x es 1/x, que "funciona"
  // para x < 0), así que se anula donde f no está definida.
  const inDomain = (g: (x: number) => number) => (x: number) => (Number.isFinite(f(x)) ? g(x) : NaN);

  // Derivación simbólica. Si math.js no sabe derivar alguna parte,
  // se usa la derivada numérica (diferencia central) como respaldo.
  try {
    const d1 = math.simplify(math.derivative(node, 'x'));
    const d2 = math.simplify(math.derivative(d1, 'x'));
    return {
      f,
      df: inDomain(compile(d1)),
      d2f: inDomain(compile(d2)),
      fText,
      dfText: `f'(x) = ${pretty(d1)}`,
      d2fText: `f''(x) = ${pretty(d2)}`,
      symbolic: true,
      rawExpression: rawTrimmed,
      isEquation,
      equationText,
      equationKind,
      globalIndetermination: null,
      singularityGenerators,
      limitTarget,
    };
  } catch {
    const df = (x: number) => numericDerivative(f, x);
    return {
      f,
      df,
      d2f: (x: number) => numericDerivative(df, x, 1e-3),
      fText,
      dfText: "f'(x) (calculada numéricamente)",
      d2fText: "f''(x) (calculada numéricamente)",
      symbolic: false,
      rawExpression: rawTrimmed,
      isEquation,
      equationText,
      equationKind,
      globalIndetermination: null,
      singularityGenerators,
      limitTarget,
    };
  }
}

export interface LiveInspection {
  kind: 'indeterminate' | 'equation' | 'limit';
  message: string;
}

/**
 * Inspección rápida mientras el usuario escribe para avisar automáticamente
 * de indeterminaciones (como x/0, 5/0, 0/0, 0^0, ln(0), √(-1)…) o ecuaciones "= 0".
 */
export function quickInspectInput(raw: string): LiveInspection | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseFunction(trimmed);
    if (parsed.globalIndetermination) {
      return {
        kind: 'indeterminate',
        message: `⚠ ${parsed.globalIndetermination.title} — ${parsed.globalIndetermination.detail}`,
      };
    }
    if (parsed.limitTarget !== null && parsed.limitTarget !== undefined) {
      return {
        kind: 'limit',
        message: `Límite detectado (${parsed.fText} cuando x → ${parsed.limitTarget === 'inf' ? '+∞' : parsed.limitTarget === '-inf' ? '−∞' : parsed.limitTarget}). Pulsa Graficar para analizarlo.`,
      };
    }
    if (parsed.isEquation) {
      return {
        kind: 'equation',
        message: `Ecuación detectada (${parsed.equationText}): al graficar se mostrarán sus soluciones donde f(x) = 0.`,
      };
    }
    return null;
  } catch {
    return null;
  }
}
