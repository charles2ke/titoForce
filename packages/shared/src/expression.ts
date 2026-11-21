// A small, safe expression language used for formula fields, automation templates
// and approval actions. Inspired by spreadsheet / Salesforce formula syntax.
//
//   amount * probability / 100
//   IF(priority == 'Urgent', 4, 24)
//   CASE(stage, 'Closed Won', 100, 'Closed Lost', 0, 50)
//   ADD_DAYS(TODAY(), 3)
//   record.name + ' follow-up'
//
// There is no access to JavaScript globals, prototypes or functions other than the
// built-ins listed in FUNCTIONS. Expressions are parsed once and cached.

export class ExpressionError extends Error {
  position: number | undefined;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'ExpressionError';
    this.position = position;
  }
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'lit'; v: boolean | null }
  | { k: 'id'; path: string[] }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'un'; op: '!' | '-'; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node };

interface Token {
  t: 'num' | 'str' | 'id' | 'op' | 'eof';
  v: string;
  pos: number;
}

const MAX_LENGTH = 4000;
const MAX_DEPTH = 64;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const OPERATORS = ['&&', '||', '==', '!=', '<>', '<=', '>=', '=', '<', '>', '+', '-', '*', '/', '%', '!', '(', ')', ',', '?', ':', '&'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      tokens.push({ t: 'num', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const next = src[j + 1]!;
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (j >= src.length) throw new ExpressionError('Unterminated string literal', i);
      tokens.push({ t: 'str', v: out, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i))!;
      tokens.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExpressionError(`Unexpected character '${ch}'`, i);
    tokens.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  tokens.push({ t: 'eof', v: '', pos: src.length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private i = 0;
  private depth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const node = this.expr();
    const tok = this.peek();
    if (tok.t !== 'eof') throw new ExpressionError(`Unexpected '${tok.v}'`, tok.pos);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.i]!;
  }

  private next(): Token {
    return this.tokens[this.i++]!;
  }

  private isOp(...ops: string[]): boolean {
    const tok = this.peek();
    return tok.t === 'op' && ops.includes(tok.v);
  }

  private expect(op: string): void {
    const tok = this.next();
    if (tok.t !== 'op' || tok.v !== op) throw new ExpressionError(`Expected '${op}'`, tok.pos);
  }

  private expr(): Node {
    if (++this.depth > MAX_DEPTH) throw new ExpressionError('Expression is nested too deeply');
    try {
      const c = this.or();
      if (this.isOp('?')) {
        this.next();
        const a = this.expr();
        this.expect(':');
        const b = this.expr();
        return { k: 'tern', c, a, b };
      }
      return c;
    } finally {
      this.depth--;
    }
  }

  private binary(nextFn: () => Node, ops: string[]): Node {
    let left = nextFn();
    while (this.isOp(...ops)) {
      const op = this.next().v;
      left = { k: 'bin', op, l: left, r: nextFn() };
    }
    return left;
  }

  private or(): Node {
    return this.binary(() => this.and(), ['||']);
  }

  private and(): Node {
    return this.binary(() => this.equality(), ['&&']);
  }

  private equality(): Node {
    return this.binary(() => this.comparison(), ['==', '!=', '<>', '=']);
  }

  private comparison(): Node {
    return this.binary(() => this.additive(), ['<', '<=', '>', '>=']);
  }

  private additive(): Node {
    return this.binary(() => this.multiplicative(), ['+', '-', '&']);
  }

  private multiplicative(): Node {
    return this.binary(() => this.unary(), ['*', '/', '%']);
  }

  private unary(): Node {
    if (this.isOp('!', '-')) {
      const op = this.next().v as '!' | '-';
      return { k: 'un', op, e: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const tok = this.next();
    if (tok.t === 'num') return { k: 'num', v: Number(tok.v) };
    if (tok.t === 'str') return { k: 'str', v: tok.v };
    if (tok.t === 'op' && tok.v === '(') {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (tok.t === 'id') {
      const lower = tok.v.toLowerCase();
      if (lower === 'true') return { k: 'lit', v: true };
      if (lower === 'false') return { k: 'lit', v: false };
      if (lower === 'null') return { k: 'lit', v: null };
      if (this.isOp('(')) {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(')')) {
          args.push(this.expr());
          while (this.isOp(',')) {
            this.next();
            args.push(this.expr());
          }
        }
        this.expect(')');
        const name = tok.v.toUpperCase();
        if (!FUNCTIONS[name]) throw new ExpressionError(`Unknown function ${tok.v}()`, tok.pos);
        const [min, max] = FUNCTIONS[name]!.arity;
        if (args.length < min || args.length > max) {
          throw new ExpressionError(`${name}() expects ${min === max ? min : `${min}-${max === Infinity ? 'n' : max}`} argument(s)`, tok.pos);
        }
        return { k: 'call', name, args };
      }
      const path = tok.v.split('.');
      if (path.some((p) => BLOCKED_KEYS.has(p))) throw new ExpressionError(`Invalid identifier ${tok.v}`, tok.pos);
      return { k: 'id', path };
    }
    throw new ExpressionError(tok.t === 'eof' ? 'Unexpected end of expression' : `Unexpected '${tok.v}'`, tok.pos);
  }
}

// ---------- value helpers ----------

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return 0;
}

function isNumeric(v: unknown): boolean {
  return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
}

export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return !(v === false || v === null || v === undefined || v === 0 || v === '' || Number.isNaN(v));
}

export function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (Array.isArray(v)) return v.map(stringify).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  if (isBlank(a) || isBlank(b)) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b) && (typeof a === typeof b || isBoolString(a) || isBoolString(b));
  if (isNumeric(a) && isNumeric(b)) return toNum(a) === toNum(b);
  return String(a) === String(b);
}

function isBoolString(v: unknown): boolean {
  return v === 'true' || v === 'false';
}

function compare(a: unknown, b: unknown): number | null {
  if (isBlank(a) || isBlank(b)) return null;
  if (isNumeric(a) && isNumeric(b)) return toNum(a) - toNum(b);
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v !== 'string' || v === '') return null;
  const d = DATE_ONLY.test(v) ? new Date(`${v}T00:00:00.000Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface EvalOptions {
  now?: Date;
}

interface FnDef {
  arity: [number, number];
  fn: (args: unknown[], opts: EvalOptions) => unknown;
}

const nowOf = (opts: EvalOptions): Date => opts.now ?? new Date();

const FUNCTIONS: Record<string, FnDef> = {
  IF: { arity: [2, 3], fn: ([c, a, b]) => (truthy(c) ? a : (b ?? null)) },
  AND: { arity: [1, Infinity], fn: (args) => args.every(truthy) },
  OR: { arity: [1, Infinity], fn: (args) => args.some(truthy) },
  NOT: { arity: [1, 1], fn: ([a]) => !truthy(a) },
  ISBLANK: { arity: [1, 1], fn: ([a]) => isBlank(a) },
  BLANKVALUE: { arity: [2, 2], fn: ([a, b]) => (isBlank(a) ? b : a) },
  COALESCE: { arity: [1, Infinity], fn: (args) => args.find((a) => !isBlank(a)) ?? null },
  CASE: {
    arity: [3, Infinity],
    fn: ([value, ...rest]) => {
      for (let i = 0; i + 1 < rest.length; i += 2) if (looseEquals(value, rest[i])) return rest[i + 1];
      return rest.length % 2 === 1 ? rest[rest.length - 1] : null;
    },
  },
  ROUND: {
    arity: [1, 2],
    fn: ([x, n]) => {
      const p = 10 ** Math.max(0, Math.min(10, Math.trunc(toNum(n ?? 0))));
      return Math.round(toNum(x) * p) / p;
    },
  },
  FLOOR: { arity: [1, 1], fn: ([x]) => Math.floor(toNum(x)) },
  CEIL: { arity: [1, 1], fn: ([x]) => Math.ceil(toNum(x)) },
  ABS: { arity: [1, 1], fn: ([x]) => Math.abs(toNum(x)) },
  MIN: { arity: [1, Infinity], fn: (args) => Math.min(...args.map(toNum)) },
  MAX: { arity: [1, Infinity], fn: (args) => Math.max(...args.map(toNum)) },
  MOD: { arity: [2, 2], fn: ([a, b]) => (toNum(b) === 0 ? null : toNum(a) % toNum(b)) },
  VALUE: { arity: [1, 1], fn: ([a]) => (isNumeric(a) ? toNum(a) : null) },
  TEXT: { arity: [1, 1], fn: ([a]) => stringify(a) },
  CONCAT: { arity: [1, Infinity], fn: (args) => args.map(stringify).join('') },
  UPPER: { arity: [1, 1], fn: ([a]) => stringify(a).toUpperCase() },
  LOWER: { arity: [1, 1], fn: ([a]) => stringify(a).toLowerCase() },
  TRIM: { arity: [1, 1], fn: ([a]) => stringify(a).trim() },
  LEN: { arity: [1, 1], fn: ([a]) => stringify(a).length },
  LEFT: { arity: [2, 2], fn: ([a, n]) => stringify(a).slice(0, Math.max(0, toNum(n))) },
  RIGHT: { arity: [2, 2], fn: ([a, n]) => (toNum(n) <= 0 ? '' : stringify(a).slice(-toNum(n))) },
  CONTAINS: {
    arity: [2, 2],
    fn: ([a, b]) => (Array.isArray(a) ? a.some((x) => looseEquals(x, b)) : stringify(a).toLowerCase().includes(stringify(b).toLowerCase())),
  },
  SUBSTITUTE: { arity: [3, 3], fn: ([a, b, c]) => stringify(a).split(stringify(b)).join(stringify(c)) },
  TODAY: { arity: [0, 0], fn: (_args, opts) => toDateOnlyString(nowOf(opts)) },
  NOW: { arity: [0, 0], fn: (_args, opts) => nowOf(opts).toISOString() },
  DATE: {
    arity: [3, 3],
    fn: ([y, m, d]) => toDateOnlyString(new Date(Date.UTC(toNum(y), toNum(m) - 1, toNum(d)))),
  },
  ADD_DAYS: {
    arity: [2, 2],
    fn: ([d, n]) => {
      const date = parseDate(d);
      if (!date) return null;
      const out = new Date(date.getTime() + toNum(n) * 86_400_000);
      return typeof d === 'string' && DATE_ONLY.test(d) ? toDateOnlyString(out) : out.toISOString();
    },
  },
  ADD_HOURS: {
    arity: [2, 2],
    fn: ([d, n]) => {
      const date = parseDate(d);
      return date ? new Date(date.getTime() + toNum(n) * 3_600_000).toISOString() : null;
    },
  },
  DAYS_BETWEEN: {
    arity: [2, 2],
    fn: ([a, b]) => {
      const da = parseDate(a);
      const db = parseDate(b);
      if (!da || !db) return null;
      return Math.round((utcMidnight(db) - utcMidnight(da)) / 86_400_000);
    },
  },
  YEAR: { arity: [1, 1], fn: ([d]) => parseDate(d)?.getUTCFullYear() ?? null },
  MONTH: { arity: [1, 1], fn: ([d]) => (parseDate(d) ? parseDate(d)!.getUTCMonth() + 1 : null) },
  DAY: { arity: [1, 1], fn: ([d]) => parseDate(d)?.getUTCDate() ?? null },
};

export const EXPRESSION_FUNCTIONS = Object.keys(FUNCTIONS).sort();

function resolvePath(ctx: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = ctx;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function evalNode(node: Node, ctx: Record<string, unknown>, opts: EvalOptions): unknown {
  switch (node.k) {
    case 'num':
    case 'str':
    case 'lit':
      return node.v;
    case 'id':
      return resolvePath(ctx, node.path) ?? null;
    case 'call':
      return FUNCTIONS[node.name]!.fn(
        node.args.map((a) => evalNode(a, ctx, opts)),
        opts,
      );
    case 'un': {
      const v = evalNode(node.e, ctx, opts);
      return node.op === '!' ? !truthy(v) : -toNum(v);
    }
    case 'tern':
      return truthy(evalNode(node.c, ctx, opts)) ? evalNode(node.a, ctx, opts) : evalNode(node.b, ctx, opts);
    case 'bin': {
      if (node.op === '&&') return truthy(evalNode(node.l, ctx, opts)) && truthy(evalNode(node.r, ctx, opts));
      if (node.op === '||') return truthy(evalNode(node.l, ctx, opts)) || truthy(evalNode(node.r, ctx, opts));
      const l = evalNode(node.l, ctx, opts);
      const r = evalNode(node.r, ctx, opts);
      switch (node.op) {
        case '&':
          return stringify(l) + stringify(r);
        case '+':
          if ((typeof l === 'string' && !isNumeric(l)) || (typeof r === 'string' && !isNumeric(r))) return stringify(l) + stringify(r);
          return toNum(l) + toNum(r);
        case '-':
          return toNum(l) - toNum(r);
        case '*':
          return toNum(l) * toNum(r);
        case '/':
          return toNum(r) === 0 ? null : toNum(l) / toNum(r);
        case '%':
          return toNum(r) === 0 ? null : toNum(l) % toNum(r);
        case '==':
        case '=':
          return looseEquals(l, r);
        case '!=':
        case '<>':
          return !looseEquals(l, r);
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const c = compare(l, r);
          if (c === null) return false;
          return node.op === '<' ? c < 0 : node.op === '<=' ? c <= 0 : node.op === '>' ? c > 0 : c >= 0;
        }
      }
      throw new ExpressionError(`Unknown operator ${node.op}`);
    }
  }
}

const cache = new Map<string, Node>();

export function parseExpression(src: string): Node {
  if (src.length > MAX_LENGTH) throw new ExpressionError(`Expression exceeds ${MAX_LENGTH} characters`);
  const hit = cache.get(src);
  if (hit) return hit;
  const node = new Parser(tokenize(src)).parse();
  if (cache.size > 1000) cache.clear();
  cache.set(src, node);
  return node;
}

export function evaluateExpression(src: string, ctx: Record<string, unknown>, opts: EvalOptions = {}): unknown {
  const value = evalNode(parseExpression(src), ctx, opts);
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

/** Returns the identifier paths referenced by an expression (e.g. ["amount", "record.name"]). */
export function expressionIdentifiers(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    switch (n.k) {
      case 'id':
        out.add(n.path.join('.'));
        break;
      case 'call':
        n.args.forEach(walk);
        break;
      case 'un':
        walk(n.e);
        break;
      case 'bin':
        walk(n.l);
        walk(n.r);
        break;
      case 'tern':
        walk(n.c);
        walk(n.a);
        walk(n.b);
        break;
      default:
        break;
    }
  };
  walk(parseExpression(src));
  return [...out];
}

const TEMPLATE_RE = /\{\{([\s\S]+?)\}\}/g;

/**
 * Renders "{{ expression }}" placeholders. When the whole value is a single
 * placeholder the raw (typed) result is returned instead of a string.
 */
export function renderTemplate(value: unknown, ctx: Record<string, unknown>, opts: EvalOptions = {}): unknown {
  if (typeof value !== 'string') return value;
  const single = /^\s*\{\{([\s\S]+?)\}\}\s*$/.exec(value);
  if (single && !single[1]!.includes('{{')) return evaluateExpression(single[1]!.trim(), ctx, opts);
  return value.replace(TEMPLATE_RE, (_m, expr: string) => stringify(evaluateExpression(expr.trim(), ctx, opts)));
}
