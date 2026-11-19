// Reconocimiento de escritura a mano para funciones y ecuaciones.
// Funciona 100% en el navegador sin claves ni servidor externo:
//  1) Detecta estructuras 2D: fracciones (barra horizontal con numerador/denominador),
//     signo =, +, -, x, raíz √ y exponentes (superíndices).
//  2) Clasifica cada trazo/símbolo mediante nube de puntos ($P) con plantillas
//     integradas + plantillas personalizadas ("Enseñar mi letra" en localStorage).
//  3) Opcionalmente permite usar una clave propia de Gemini (guardada solo en el
//     navegador del usuario) para OCR con visión, con respaldo local automático.

export type Point = [number, number];
export type Stroke = Point[];

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

interface Token {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  h: number;
  w: number;
  isAtom?: boolean;
}

const TEMPLATES_KEY = 'calculab-handwriting-templates';
const GEMINI_KEY_STORAGE = 'calculab-gemini-key';

export const TRAINABLE_SYMBOLS = [
  'x', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '+', '-', '=', '/', '(', ')', '.', '√', 's', 'i', 'n', 'c', 'o', 't', 'a', 'l', 'e',
];

// ---------- Utilidades geométricas ----------

function strokeBox(t: Stroke): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of t) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return { x0, y0, x1, y1, w, h, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function groupBox(strokes: Stroke[]): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return { x0, y0, x1, y1, w, h, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function strokeLength(t: Stroke): number {
  let len = 0;
  for (let i = 1; i < t.length; i++) {
    len += Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]);
  }
  return len;
}

function straightness(t: Stroke): number {
  if (t.length < 2) return 1;
  const len = strokeLength(t);
  if (len < 1e-6) return 1;
  const direct = Math.hypot(t[t.length - 1][0] - t[0][0], t[t.length - 1][1] - t[0][1]);
  return direct / len;
}

function isHorizontalBar(t: Stroke, b: BBox): boolean {
  return b.w > 16 && b.w > b.h * 2.4 && straightness(t) > 0.82;
}

function isVerticalBar(t: Stroke, b: BBox): boolean {
  return b.h > 14 && b.h > b.w * 2.3 && straightness(t) > 0.82;
}

function segmentsIntersect(a: Stroke, b: Stroke): boolean {
  // Comprueba intersección entre segmentos simplificados de dos trazos
  const ccw = (p: Point, q: Point, r: Point) => (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0]);
  const cross = (p1: Point, p2: Point, q1: Point, q2: Point) =>
    ccw(p1, q1, q2) !== ccw(p2, q1, q2) && ccw(p1, p2, q1) !== ccw(p1, p2, q2);

  const stepA = Math.max(1, Math.floor(a.length / 12));
  const stepB = Math.max(1, Math.floor(b.length / 12));
  for (let i = 0; i < a.length - 1; i += stepA) {
    const a2 = a[Math.min(a.length - 1, i + stepA)];
    for (let j = 0; j < b.length - 1; j += stepB) {
      const b2 = b[Math.min(b.length - 1, j + stepB)];
      if (cross(a[i], a2, b[j], b2)) return true;
    }
  }
  return false;
}

// ---------- Nube de puntos normalizada ($P) ----------

export function toPointCloud(strokes: Stroke[], count = 40): Point[] {
  const lengths = strokes.map(strokeLength);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const pts: Point[] = [];

  strokes.forEach((t, si) => {
    if (t.length < 2) {
      pts.push([t[0][0], t[0][1]]);
      return;
    }
    const cum = [0];
    for (let i = 1; i < t.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]));
    }
    const k = Math.max(3, Math.round((count * lengths[si]) / total));
    let j = 1;
    for (let q = 0; q < k; q++) {
      const d = (cum[cum.length - 1] * q) / (k - 1);
      while (j < t.length - 1 && cum[j] < d) j++;
      const u = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
      pts.push([t[j - 1][0] + (t[j][0] - t[j - 1][0]) * u, t[j - 1][1] + (t[j][1] - t[j - 1][1]) * u]);
    }
  });

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const scale = Math.max(x1 - x0, y1 - y0) || 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return pts.map(([x, y]) => [Math.round(((x - cx) / scale) * 1000) / 1000, Math.round(((y - cy) / scale) * 1000) / 1000]);
}

function halfDist(A: Point[], B: Point[]): number {
  let sum = 0;
  for (const a of A) {
    let best = Infinity;
    for (const b of B) {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / A.length;
}

function cloudDist(A: Point[], B: Point[]): number {
  return halfDist(A, B) + halfDist(B, A);
}

// ---------- Plantillas integradas (multi-variante) ----------

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 16): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function poly(...pts: Point[]): Stroke {
  return pts;
}

interface Prototype {
  symbol: string;
  cloud: Point[];
  aspectMin?: number;
  aspectMax?: number;
}

function buildPrototypes(): Prototype[] {
  const raw: { symbol: string; strokes: Stroke[]; aspectMin?: number; aspectMax?: number }[] = [
    // 0
    { symbol: '0', strokes: [arc(0, 0, 0.36, 0.5, -Math.PI / 2, (3 * Math.PI) / 2, 24)] },
    { symbol: '0', strokes: [arc(0, 0, 0.48, 0.48, -Math.PI / 2, (3 * Math.PI) / 2, 24)] },
    // 1
    { symbol: '1', strokes: [poly([0, -0.5], [0, 0.5])], aspectMax: 0.45 },
    { symbol: '1', strokes: [poly([-0.22, -0.25], [0.05, -0.5], [0.05, 0.5])], aspectMax: 0.7 },
    { symbol: '1', strokes: [poly([-0.2, -0.28], [0, -0.5], [0, 0.5]), poly([-0.25, 0.5], [0.25, 0.5])], aspectMax: 0.8 },
    // 2
    { symbol: '2', strokes: [[...arc(0, -0.22, 0.3, 0.25, Math.PI * 1.1, Math.PI * 0.15, 12), [-0.32, 0.48], [0.34, 0.48]]] },
    { symbol: '2', strokes: [poly([-0.3, -0.35], [0, -0.5], [0.3, -0.3], [0.25, -0.05], [-0.32, 0.48], [0.34, 0.48])] },
    // 3
    {
      symbol: '3',
      strokes: [
        [
          ...arc(0, -0.25, 0.28, 0.24, Math.PI * 1.2, Math.PI * 0.5, 10),
          ...arc(0, 0.24, 0.3, 0.25, -Math.PI * 0.5, Math.PI * 0.85, 12),
        ],
      ],
    },
    // 4 (abierto de 2 trazos y cerrado de 1/2 trazos)
    { symbol: '4', strokes: [poly([-0.25, -0.5], [-0.3, 0.08], [0.35, 0.08]), poly([0.12, -0.5], [0.12, 0.5])] },
    { symbol: '4', strokes: [poly([0.12, -0.5], [-0.32, 0.12], [0.36, 0.12]), poly([0.12, -0.5], [0.12, 0.5])] },
    { symbol: '4', strokes: [poly([0.15, 0.5], [0.15, -0.5], [-0.32, 0.1], [0.34, 0.1])] },
    // 5 (1 trazo y 2 trazos)
    {
      symbol: '5',
      strokes: [
        [
          [0.3, -0.48],
          [-0.25, -0.48],
          [-0.28, -0.05],
          ...arc(0, 0.2, 0.3, 0.28, -Math.PI * 0.75, Math.PI * 0.85, 14),
        ],
      ],
    },
    {
      symbol: '5',
      strokes: [
        [[-0.25, -0.48], [-0.28, -0.05], ...arc(0, 0.2, 0.3, 0.28, -Math.PI * 0.75, Math.PI * 0.85, 14)],
        poly([-0.25, -0.48], [0.32, -0.48]),
      ],
    },
    // 6
    {
      symbol: '6',
      strokes: [
        [
          [0.24, -0.48],
          [-0.1, -0.32],
          [-0.28, 0.05],
          ...arc(0, 0.22, 0.28, 0.26, Math.PI, -Math.PI, 18),
        ],
      ],
    },
    // 7 (simple y tachado)
    { symbol: '7', strokes: [poly([-0.32, -0.48], [0.32, -0.48], [-0.1, 0.5])] },
    { symbol: '7', strokes: [poly([-0.32, -0.48], [0.32, -0.48], [-0.1, 0.5]), poly([-0.18, 0], [0.22, 0])] },
    // 8
    {
      symbol: '8',
      strokes: [
        [...arc(0, -0.24, 0.26, 0.24, Math.PI / 2, (5 * Math.PI) / 2, 14), ...arc(0, 0.24, 0.28, 0.24, -Math.PI / 2, (3 * Math.PI) / 2, 14)],
      ],
    },
    // 9
    {
      symbol: '9',
      strokes: [
        [...arc(0, -0.22, 0.28, 0.25, 0, Math.PI * 2, 16), [0.28, -0.22], [0.16, 0.5]],
      ],
    },
    {
      symbol: '9',
      strokes: [
        [...arc(0, -0.24, 0.26, 0.24, 0, Math.PI * 2, 16), [0.26, -0.24], [0.22, 0.28], [0.0, 0.48], [-0.24, 0.44]],
      ],
    },
    // x (cruzada y cursiva ")(")
    { symbol: 'x', strokes: [poly([-0.35, -0.4], [0.35, 0.4]), poly([0.35, -0.4], [-0.35, 0.4])] },
    { symbol: 'x', strokes: [arc(-0.24, 0, 0.24, 0.42, -Math.PI * 0.4, Math.PI * 0.4, 10), arc(0.24, 0, 0.24, 0.42, Math.PI * 0.6, Math.PI * 1.4, 10)] },
    // ( y )
    { symbol: '(', strokes: [arc(0.32, 0, 0.42, 0.52, Math.PI * 0.65, Math.PI * 1.35, 14)], aspectMax: 0.65 },
    { symbol: ')', strokes: [arc(-0.32, 0, 0.42, 0.52, -Math.PI * 0.35, Math.PI * 0.35, 14)], aspectMax: 0.65 },
    // /
    { symbol: '/', strokes: [poly([0.3, -0.5], [-0.3, 0.5])], aspectMax: 0.9 },
    // + y = y -
    { symbol: '+', strokes: [poly([-0.4, 0], [0.4, 0]), poly([0, -0.4], [0, 0.4])] },
    { symbol: '=', strokes: [poly([-0.4, -0.18], [0.4, -0.18]), poly([-0.4, 0.18], [0.4, 0.18])] },
    { symbol: '-', strokes: [poly([-0.45, 0], [0.45, 0])], aspectMin: 2.0 },
    // Letras frecuentes de funciones: s, c, n, t, a, e, l, f
    {
      symbol: 's',
      strokes: [
        [
          ...arc(0, -0.24, 0.26, 0.22, -Math.PI * 0.15, -Math.PI * 1.4, 10),
          ...arc(0, 0.22, 0.28, 0.24, -Math.PI * 0.45, Math.PI * 0.85, 10),
        ],
      ],
    },
    { symbol: 'c', strokes: [arc(0.08, 0, 0.36, 0.44, Math.PI * 0.25, Math.PI * 1.75, 16)] },
    { symbol: 'n', strokes: [[[-0.3, 0.45], [-0.3, -0.42], ...arc(0, -0.12, 0.3, 0.3, Math.PI, 0, 10), [0.3, 0.45]]] },
    { symbol: 't', strokes: [poly([0, -0.5], [0, 0.42], [0.22, 0.48]), poly([-0.28, -0.15], [0.28, -0.15])] },
    { symbol: 'a', strokes: [[...arc(-0.05, 0.1, 0.28, 0.32, 0, Math.PI * 2, 16), [0.24, -0.25], [0.28, 0.45]]] },
    { symbol: 'e', strokes: [[[-0.32, 0], [0.34, 0], ...arc(0, 0, 0.34, 0.42, 0, -Math.PI * 1.72, 18)]] },
    { symbol: 'f', strokes: [[...arc(0.14, -0.34, 0.2, 0.18, -Math.PI * 0.15, -Math.PI, 8), [-0.06, 0.5]], poly([-0.26, -0.05], [0.24, -0.05])] },
  ];

  return raw.map((item) => ({
    symbol: item.symbol,
    cloud: toPointCloud(item.strokes),
    aspectMin: item.aspectMin,
    aspectMax: item.aspectMax,
  }));
}

const BUILTIN_PROTOTYPES = buildPrototypes();

// ---------- Plantillas personalizadas del usuario ("Enseñar mi letra") ----------

export type UserTemplates = Record<string, Point[][]>;

export function loadUserTemplates(): UserTemplates {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '{}') as UserTemplates;
  } catch {
    return {};
  }
}

export function saveUserTemplates(templates: UserTemplates): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    // ignorar si localStorage no está disponible
  }
}

export function teachSymbol(symbol: string, strokes: Stroke[]): UserTemplates {
  const templates = loadUserTemplates();
  if (!templates[symbol]) templates[symbol] = [];
  templates[symbol].push(toPointCloud(strokes));
  saveUserTemplates(templates);
  return templates;
}

export function clearUserTemplates(): void {
  saveUserTemplates({});
}

export function loadGeminiKey(): string {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function saveGeminiKey(key: string): void {
  try {
    const clean = key.trim();
    if (clean) localStorage.setItem(GEMINI_KEY_STORAGE, clean);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch {
    // ignorar
  }
}

// ---------- Clasificación de un grupo de trazos ----------

function classifyGroup(strokes: Stroke[], box: BBox, userTemplates: UserTemplates): string {
  // Casos geométricos muy claros de 1 trazo
  if (strokes.length === 1) {
    const t = strokes[0];
    if (isHorizontalBar(t, box)) return '-';
    if (isVerticalBar(t, box)) return '1';
    // Barra inclinada "/" recta de esquina superior derecha a inferior izquierda
    if (straightness(t) > 0.9 && box.h > 18 && box.w > 8 && box.w / box.h < 1.15) {
      const dx = t[t.length - 1][0] - t[0][0];
      const dy = t[t.length - 1][1] - t[0][1];
      const slopeSign = dx * dy;
      if (slopeSign < 0 && Math.abs(dx) > box.h * 0.28) return '/';
    }
  }

  // Casos geométricos de 2 trazos que se cruzan: "+" o "x"
  if (strokes.length === 2) {
    const b0 = strokeBox(strokes[0]);
    const b1 = strokeBox(strokes[1]);
    const h0 = isHorizontalBar(strokes[0], b0);
    const h1 = isHorizontalBar(strokes[1], b1);
    const v0 = isVerticalBar(strokes[0], b0);
    const v1 = isVerticalBar(strokes[1], b1);

    if ((h0 && v1) || (h1 && v0)) {
      if (segmentsIntersect(strokes[0], strokes[1])) return '+';
    }
    // Dos diagonales rectas que se cruzan → "x"
    if (
      straightness(strokes[0]) > 0.82 &&
      straightness(strokes[1]) > 0.82 &&
      !h0 && !h1 && !v0 && !v1 &&
      segmentsIntersect(strokes[0], strokes[1])
    ) {
      const s0 = (strokes[0][strokes[0].length - 1][0] - strokes[0][0][0]) *
                 (strokes[0][strokes[0].length - 1][1] - strokes[0][0][1]);
      const s1 = (strokes[1][strokes[1].length - 1][0] - strokes[1][0][0]) *
                 (strokes[1][strokes[1].length - 1][1] - strokes[1][0][1]);
      if (s0 * s1 < 0) return 'x';
    }
  }

  const cloud = toPointCloud(strokes);
  const aspect = box.w / box.h;

  let bestSym = 'x';
  let bestScore = Infinity;

  // 1) Plantillas enseñadas por el usuario (con pequeña prioridad para respetar su letra)
  for (const sym of Object.keys(userTemplates)) {
    for (const tpl of userTemplates[sym]) {
      const d = cloudDist(cloud, tpl) * 0.82;
      if (d < bestScore) {
        bestScore = d;
        bestSym = sym;
      }
    }
  }

  // 2) Plantillas integradas
  for (const proto of BUILTIN_PROTOTYPES) {
    if (proto.aspectMin !== undefined && aspect < proto.aspectMin) continue;
    if (proto.aspectMax !== undefined && aspect > proto.aspectMax) continue;
    let d = cloudDist(cloud, proto.cloud);

    // Desambiguar "(" vs ")" por la curvatura media respecto a los extremos
    if (strokes.length === 1 && (proto.symbol === '(' || proto.symbol === ')')) {
      const t = strokes[0];
      const midX = t[Math.floor(t.length / 2)][0];
      const endMeanX = (t[0][0] + t[t.length - 1][0]) / 2;
      if (proto.symbol === '(' && midX > endMeanX) d += 0.35;
      if (proto.symbol === ')' && midX < endMeanX) d += 0.35;
    }

    if (d < bestScore) {
      bestScore = d;
      bestSym = proto.symbol;
    }
  }

  return bestSym;
}

// ---------- Reconocimiento estructural 2D (fracciones, raíces, =, superíndices) ----------

function isRadicalStroke(t: Stroke, b: BBox): boolean {
  if (t.length < 4 || b.w < 26 || b.h < 18) return false;
  // El radical √ suele comenzar en la mitad izquierda, bajar hasta el fondo (valle),
  // subir al techo superior y extenderse a la derecha.
  let minYIdx = 0, maxYIdx = 0;
  for (let i = 1; i < t.length; i++) {
    if (t[i][1] < t[minYIdx][1]) minYIdx = i;
    if (t[i][1] > t[maxYIdx][1]) maxYIdx = i;
  }
  const valley = t[maxYIdx];
  const end = t[t.length - 1];
  const valleyLeft = valley[0] < b.x0 + b.w * 0.45;
  const goesUpAfterValley = minYIdx > maxYIdx;
  const roofRight = end[0] > b.x0 + b.w * 0.72 && end[1] < b.y0 + b.h * 0.38;
  return valleyLeft && goesUpAfterValley && roofRight;
}

function recognizeSubset(strokes: Stroke[], userTemplates: UserTemplates): string {
  if (strokes.length === 0) return '';

  const items = strokes.map((t, idx) => ({ idx, t, b: strokeBox(t) }));
  const used = new Set<number>();
  const tokens: Token[] = [];

  // Altura de referencia para distinguir puntos decimales
  const heights = items.map((it) => it.b.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 30;

  // 1) Detectar raíces cuadradas √ que encierran trazos debajo de su techo
  for (const it of items) {
    if (used.has(it.idx)) continue;
    if (!isRadicalStroke(it.t, it.b)) continue;
    const inside = items.filter(
      (other) =>
        other.idx !== it.idx &&
        !used.has(other.idx) &&
        other.b.cx > it.b.x0 + it.b.w * 0.18 &&
        other.b.cx < it.b.x1 + 10 &&
        other.b.cy > it.b.y0 &&
        other.b.cy < it.b.y1 + it.b.h * 0.25,
    );
    if (inside.length > 0) {
      used.add(it.idx);
      inside.forEach((o) => used.add(o.idx));
      const innerText = recognizeSubset(inside.map((o) => o.t), userTemplates);
      const box = groupBox([it.t, ...inside.map((o) => o.t)]);
      tokens.push({ text: `sqrt(${innerText})`, ...box, isAtom: true });
    }
  }

  // 2) Detectar barras de fracción (trazo horizontal largo con trazos arriba Y abajo)
  const hBars = items
    .filter((it) => !used.has(it.idx) && isHorizontalBar(it.t, it.b) && it.b.w > 28)
    .sort((a, b) => b.b.w - a.b.w);

  for (const bar of hBars) {
    if (used.has(bar.idx)) continue;
    const pad = Math.max(10, bar.b.w * 0.14);
    const above = items.filter(
      (o) =>
        o.idx !== bar.idx &&
        !used.has(o.idx) &&
        o.b.cx >= bar.b.x0 - pad &&
        o.b.cx <= bar.b.x1 + pad &&
        o.b.y1 <= bar.b.cy + 8,
    );
    const below = items.filter(
      (o) =>
        o.idx !== bar.idx &&
        !used.has(o.idx) &&
        o.b.cx >= bar.b.x0 - pad &&
        o.b.cx <= bar.b.x1 + pad &&
        o.b.y0 >= bar.b.cy - 8,
    );

    if (above.length > 0 && below.length > 0) {
      // Descartar falso positivo si "above" o "below" es solo la otra barra de un "="
      const singleBarAbove = above.length === 1 && isHorizontalBar(above[0].t, above[0].b);
      const singleBarBelow = below.length === 1 && isHorizontalBar(below[0].t, below[0].b);
      if (singleBarAbove && singleBarBelow) continue;

      used.add(bar.idx);
      above.forEach((o) => used.add(o.idx));
      below.forEach((o) => used.add(o.idx));

      const num = recognizeSubset(above.map((o) => o.t), userTemplates);
      const den = recognizeSubset(below.map((o) => o.t), userTemplates);
      const wrap = (s: string) => (/^[a-zA-Z0-9.]+$/.test(s) ? s : `(${s})`);
      const box = groupBox([bar.t, ...above.map((o) => o.t), ...below.map((o) => o.t)]);
      tokens.push({ text: `${wrap(num)}/${wrap(den)}`, ...box, isAtom: true });
    }
  }

  // 3) Detectar signos "=" (dos barras horizontales apiladas verticalmente)
  const remBars = items.filter((it) => !used.has(it.idx) && isHorizontalBar(it.t, it.b));
  for (let i = 0; i < remBars.length; i++) {
    const a = remBars[i];
    if (used.has(a.idx)) continue;
    for (let j = i + 1; j < remBars.length; j++) {
      const b = remBars[j];
      if (used.has(b.idx)) continue;
      const overlapX = Math.min(a.b.x1, b.b.x1) - Math.max(a.b.x0, b.b.x0);
      const minW = Math.min(a.b.w, b.b.w);
      const maxW = Math.max(a.b.w, b.b.w);
      const dy = Math.abs(a.b.cy - b.b.cy);
      if (overlapX > minW * 0.45 && dy > 4 && dy < maxW * 1.25) {
        used.add(a.idx);
        used.add(b.idx);
        const box = groupBox([a.t, b.t]);
        tokens.push({ text: '=', ...box, isAtom: true });
        break;
      }
    }
  }

  // 4) Agrupar el resto de trazos en símbolos individuales por solapamiento
  const remaining = items.filter((it) => !used.has(it.idx));
  const groups: { strokes: Stroke[]; box: BBox }[] = [];

  const shouldMerge = (a: BBox, sa: Stroke[], b: BBox, sb: Stroke[]): boolean => {
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    // Si las cajas casi se tocan o se solapan (incluye trazos perfectamente verticales/horizontales con ancho/alto 0)
    if (ox >= -4 && oy >= -4) {
      // Si los trazos se cruzan físicamente (ej. +, x, 4, t, 7 tachado)
      for (const s1 of sa) {
        for (const s2 of sb) {
          if (segmentsIntersect(s1, s2)) return true;
        }
      }
      if (ox > 0 && oy > 0) {
        const minW = Math.min(a.w, b.w);
        const minH = Math.min(a.h, b.h);
        if (ox / minW > 0.35 && oy / minH > 0.25) return true;
      }
    }
    // Punto de la "i" justo encima de un palo vertical corto
    const dotA = a.w < 12 && a.h < 12;
    const dotB = b.w < 12 && b.h < 12;
    if (dotA !== dotB) {
      const dot = dotA ? a : b;
      const stem = dotA ? b : a;
      const stemStroke = dotA ? sb[0] : sa[0];
      if (isVerticalBar(stemStroke, stem) && dot.y1 < stem.y0 + 6 && stem.y0 - dot.y1 < stem.h * 0.8 && Math.abs(dot.cx - stem.cx) < stem.h * 0.45) {
        return true;
      }
    }
    return false;
  };

  for (const it of remaining) {
    const target = groups.find((g) => shouldMerge(g.box, g.strokes, it.b, [it.t]));
    if (target) {
      target.strokes.push(it.t);
      target.box = groupBox(target.strokes);
    } else {
      groups.push({ strokes: [it.t], box: it.b });
    }
  }

  for (const g of groups) {
    // Punto decimal aislado
    if (g.strokes.length === 1 && g.box.w < Math.max(12, medianH * 0.22) && g.box.h < Math.max(12, medianH * 0.22)) {
      tokens.push({ text: '.', ...g.box, isAtom: true });
      continue;
    }
    // "i" con punto
    if (g.strokes.length === 2) {
      const b0 = strokeBox(g.strokes[0]);
      const b1 = strokeBox(g.strokes[1]);
      const small0 = b0.w < 12 && b0.h < 12;
      const small1 = b1.w < 12 && b1.h < 12;
      if (small0 !== small1) {
        tokens.push({ text: 'i', ...g.box, isAtom: true });
        continue;
      }
    }
    const sym = classifyGroup(g.strokes, g.box, userTemplates);
    tokens.push({ text: sym, ...g.box, isAtom: true });
  }

  return assembleLine(tokens);
}

// Ensambla tokens de izquierda a derecha detectando superíndices (exponentes)
function assembleLine(tokens: Token[]): string {
  if (tokens.length === 0) return '';
  tokens.sort((a, b) => a.cx - b.cx);

  const nonOpHeights = tokens.filter((t) => !['-', '=', '+', '.'].includes(t.text)).map((t) => t.h);
  const refH = nonOpHeights.length ? Math.max(...nonOpHeights) : 30;

  let out = '';
  let base: Token | null = null;
  let inSup = false;
  let supBuf = '';

  const flushSup = () => {
    if (!inSup) return;
    out += supBuf.length === 1 ? `^${supBuf}` : `^(${supBuf})`;
    inSup = false;
    supBuf = '';
  };

  for (const tok of tokens) {
    const canBeBase = !['+', '-', '=', '/', '(', '.'].includes(tok.text);
    const canBeSup = !['=', '+'].includes(tok.text);

    // Un token es exponente si está claramente elevado respecto a la base anterior
    const isSup =
      base !== null &&
      canBeSup &&
      tok.cy < base.cy - 0.22 * Math.max(base.h, refH * 0.55) &&
      tok.y1 < base.y0 + 0.68 * Math.max(base.h, refH * 0.6) &&
      tok.h < Math.max(base.h, refH) * 0.92;

    if (isSup) {
      inSup = true;
      supBuf += tok.text;
    } else {
      flushSup();
      out += tok.text;
      base = canBeBase ? tok : null;
    }
  }
  flushSup();

  return cleanExpression(out);
}

// Corrige confusiones típicas de contexto (sin/cos/tan/ln, 0 vs o, 1 vs l/i, espacios)
function cleanExpression(raw: string): string {
  let s = raw.trim();
  // Recuperar funciones comunes si hubo confusión 5↔s, 1↔i/l, 0↔o
  s = s
    .replace(/[s5][i1l]n/gi, 'sin')
    .replace(/[s5]en/gi, 'sin')
    .replace(/c[o0][s5]/gi, 'cos')
    .replace(/tan/gi, 'tan')
    .replace(/[l1]n/gi, 'ln')
    .replace(/[l1][o0]g/gi, 'log')
    .replace(/ab[s5]/gi, 'abs')
    .replace(/exp/gi, 'exp');

  // Envolver argumento simple tras función sin paréntesis: sinx → sin(x), lnx → ln(x)
  s = s.replace(/\b(sin|cos|tan|ln|log|sqrt|abs|exp)(?!\s*\()([a-z0-9]+(?:\^[\w()+-]+)?)/gi, '$1($2)');
  // Espaciado legible alrededor de "="
  s = s.replace(/\s*=\s*/g, ' = ');
  return s;
}

/**
 * Reconoce los trazos dibujados a mano localmente (sin conexión).
 */
export function recognizeLocal(strokes: Stroke[]): string {
  if (!strokes.length) throw new Error('Primero escribe una función o ecuación en el recuadro.');
  const userTemplates = loadUserTemplates();
  const result = recognizeSubset(strokes, userTemplates).trim();
  if (!result) throw new Error('No se pudo reconocer el dibujo. Intenta escribir los símbolos más grandes y separados.');
  return result;
}

// ---------- Conversión de LaTeX (para OCR opcional con Gemini) ----------

export function latexToExpression(latex: string): string {
  let s = latex
    .replace(/```(?:latex)?/gi, '')
    .replace(/```/g, '')
    .replace(/\$/g, '')
    .replace(/\\left|\\right|\\,|\\;|\\!|\\:|\\displaystyle/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\pi\b/g, 'pi')
    .replace(/\\infty\b/g, 'Infinity')
    .replace(/\\to\b|\\rightarrow\b/g, '->')
    .replace(/\\(arcsin|arccos|arctan|sin|cos|tan|ln|log|exp|abs)\b/g, (_, fn: string) => {
      const map: Record<string, string> = { arcsin: 'asin', arccos: 'acos', arctan: 'atan' };
      return map[fn] || fn;
    })
    .trim();

  // Convertir \lim_{x -> a} expr
  const limMatch = s.match(/^\\lim\s*_\s*\{\s*x\s*->\s*([^{}]+?)\s*\}\s*(.+)$/);
  if (limMatch) {
    return `lim x->${latexToExpression(limMatch[1])} ${latexToExpression(limMatch[2])}`;
  }

  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
      .replace(/\^\s*\{([^{}]*)\}/g, '^($1)');
  }
  s = s.replace(/\{/g, '(').replace(/\}/g, ')').replace(/\\/g, '');
  s = s.replace(/\^\((-?[\w.]+)\)/g, '^$1');
  s = s.replace(/\b(asin|acos|atan|sin|cos|tan|ln|log|exp)\s+([a-z0-9.]+)/g, '$1($2)');
  return s.replace(/\s*=\s*/g, ' = ').trim();
}

/**
 * OCR opcional con Gemini Vision usando la clave propia del usuario (si la configuró).
 */
export async function recognizeWithGemini(dataUrl: string, apiKey: string): Promise<string> {
  const prompt =
    'Transcribe this handwritten math expression or equation to LaTeX. ' +
    'Reply ONLY with the LaTeX, no explanation, no $ delimiters, no code fences. ' +
    'Keep "= 0" or any "=" equation exactly as written, keep divisions by 0 (like 1/0 or x/0 or 0/0) intact without simplifying them away, and write exponents with ^{ }.';

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/png', data: dataUrl.split(',')[1] } },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  });

  let lastErr = 'sin respuesta';
  for (const model of ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
        },
      );
      const data = await res.json();
      if (data.error) {
        lastErr = `${model}: ${data.error.message || res.status}`;
        continue;
      }
      const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('').trim();
      if (text) return latexToExpression(text);
    } catch (err) {
      lastErr = `${model}: ${(err as Error).message}`;
    }
  }
  throw new Error(lastErr);
}

// ---------- Lienzo interactivo de escritura a mano ----------

export class HandwritingPad {
  private ctx: CanvasRenderingContext2D;
  private activeStroke: Stroke | null = null;
  strokes: Stroke[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.bindEvents();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 480;
    const h = this.canvas.clientHeight || 220;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  private getPoint(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.activeStroke = [this.getPoint(e)];
      this.strokes.push(this.activeStroke);
      this.redraw();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.activeStroke) return;
      const pt = this.getPoint(e);
      const last = this.activeStroke[this.activeStroke.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 2) {
        this.activeStroke.push(pt);
        this.redraw();
      }
    });
    const end = () => {
      this.activeStroke = null;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  undo(): void {
    this.strokes.pop();
    this.redraw();
  }

  clear(): void {
    this.strokes = [];
    this.activeStroke = null;
    this.redraw();
  }

  redraw(): void {
    const w = this.canvas.clientWidth || 480;
    const h = this.canvas.clientHeight || 220;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // Guías suaves horizontales para facilitar exponentes y fracciones
    ctx.save();
    ctx.strokeStyle = '#eee8f0';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    for (const frac of [0.33, 0.66]) {
      const y = Math.round(h * frac) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    // Trazos del usuario
    ctx.save();
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#111';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of this.strokes) {
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0][0], stroke[0][1], 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        stroke.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Exporta trazos negros sobre fondo blanco (para OCR opcional)
  toPngDataUrl(): string {
    const w = this.canvas.clientWidth || 480;
    const h = this.canvas.clientHeight || 220;
    const off = document.createElement('canvas');
    off.width = w * 2;
    off.height = h * 2;
    const octx = off.getContext('2d')!;
    octx.scale(2, 2);
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, w, h);
    octx.strokeStyle = '#000';
    octx.fillStyle = '#000';
    octx.lineWidth = 4;
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    for (const stroke of this.strokes) {
      if (stroke.length === 1) {
        octx.beginPath();
        octx.arc(stroke[0][0], stroke[0][1], 2.5, 0, Math.PI * 2);
        octx.fill();
      } else {
        octx.beginPath();
        stroke.forEach(([x, y], i) => (i === 0 ? octx.moveTo(x, y) : octx.lineTo(x, y)));
        octx.stroke();
      }
    }
    return off.toDataURL('image/png');
  }
}
