// Lector de funciones: convierte el texto que escribe el usuario
// (por ejemplo "x^3 - 3x" o "sin(x)/x") en una MathFunction con sus
// derivadas, usando math.js para derivar simbólicamente.

import { create, all, type MathNode } from 'mathjs';
import { numericDerivative, type MathFunction } from './math';

// predictable: true hace que sqrt(-1) o log(-1) den NaN en lugar de un
// número complejo; así "fuera del dominio" siempre es NaN.
const math = create(all, { predictable: true });

export const DEFAULT_EXPRESSION = 'x^3 - 3x';

export const EXAMPLES = ['x^3 - 3x', 'x^4 - 4x^2', 'sin(x)', 'e^x', 'ln(x)', '1/x', 'x/(x^2+1)', 'abs(x)'];

// Nombres que no son variables (constantes de math.js)
const CONSTANTS = new Set(['e', 'pi', 'E', 'PI']);

// Ajusta la escritura habitual en clase a la sintaxis de math.js
function normalize(input: string): string {
  return input
    .trim()
    .replace(/^(f\s*\(\s*x\s*\)|y)\s*=/i, '') // quita "f(x) =" o "y =" si lo escribieron
    .replace(/−/g, '-')
    .replace(/[·×]/g, '*')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi')
    .replace(/\bln\s*\(/g, 'log(')  // en math.js log(x) es el logaritmo natural
    .replace(/\bsen\s*\(/g, 'sin(')
    .replace(/\btg\s*\(/g, 'tan(');
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
    .replace(/-/g, '−');
}

/**
 * Lee la expresión y devuelve la función con sus derivadas.
 * Lanza un Error con un mensaje en español si la expresión no sirve.
 */
export function parseFunction(input: string): MathFunction {
  const text = normalize(input);
  if (text === '') throw new Error('Escribe una función de x, por ejemplo x^2 - 4.');

  let node: MathNode;
  try {
    node = math.parse(text);
  } catch (err) {
    throw new Error(`No se entiende la expresión: ${(err as Error).message}`);
  }

  // Solo se permite la variable x (además de las constantes e y π)
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

  const f = compile(node);
  // La función debe estar definida en al menos algún punto de [−10, 10]
  let defined = false;
  for (let x = -10; x <= 10 && !defined; x += 0.37) defined = Number.isFinite(f(x));
  if (!defined) throw new Error('La función no está definida (o no existe) entre x = −10 y x = 10.');

  const fText = `f(x) = ${pretty(node)}`;

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
    };
  }
}
