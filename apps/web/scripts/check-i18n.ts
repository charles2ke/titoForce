// Checks the translated UI catalogs against English: the typecheck already guarantees the same keys, this verifies what
// types cannot — matching {placeholders}, the plural forms each language needs and no empty messages.
import en from '../src/i18n/messages/en/index.ts';
import de from '../src/i18n/messages/de/index.ts';
import es from '../src/i18n/messages/es/index.ts';
import fr from '../src/i18n/messages/fr/index.ts';
import ja from '../src/i18n/messages/ja/index.ts';
import pt from '../src/i18n/messages/pt/index.ts';

const LOCALES: Record<string, { intl: string; messages: unknown }> = {
  es: { intl: 'es-ES', messages: es },
  fr: { intl: 'fr-FR', messages: fr },
  de: { intl: 'de-DE', messages: de },
  pt: { intl: 'pt-BR', messages: pt },
  ja: { intl: 'ja-JP', messages: ja },
};
const CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

type Message = string | Record<string, string>;
const isPlural = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && 'other' in v && Object.entries(v).every(([k, x]) => CATEGORIES.has(k) && typeof x === 'string');

function leaves(tree: unknown, prefix = '', out = new Map<string, Message>()): Map<string, Message> {
  for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
    if (typeof v === 'string' || isPlural(v)) out.set(prefix + k, v);
    else if (v && typeof v === 'object') leaves(v, `${prefix}${k}.`, out);
  }
  return out;
}

const texts = (m: Message) => (typeof m === 'string' ? [m] : Object.values(m));
const placeholders = (m: Message) => [...new Set(texts(m).flatMap((t) => [...t.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!)))].sort().join(',');

const source = leaves(en);
let errors = 0;
for (const [code, { intl, messages }] of Object.entries(LOCALES)) {
  const target = leaves(messages);
  const needed = new Set(new Intl.PluralRules(intl).resolvedOptions().pluralCategories);
  const problems: string[] = [];
  let missing = 0;
  let same = 0;
  for (const [key, msg] of source) {
    const tr = target.get(key);
    if (tr === undefined) {
      missing++;
      continue;
    }
    if (typeof msg !== typeof tr) problems.push(`${key}: ${typeof msg === 'string' ? 'expected a string' : 'expected plural forms'}`);
    else if (placeholders(msg) !== placeholders(tr)) problems.push(`${key}: placeholders {${placeholders(tr)}} instead of {${placeholders(msg)}}`);
    if (texts(tr).some((t) => !t.trim())) problems.push(`${key}: empty message`);
    if (typeof msg !== 'string' && typeof tr !== 'string') {
      if (msg.zero !== undefined && tr.zero === undefined) problems.push(`${key}: missing the "zero" form`);
      if (msg.one !== undefined && needed.has('one') && tr.one === undefined) problems.push(`${key}: missing the "one" form`);
    }
    if (JSON.stringify(msg) === JSON.stringify(tr)) same++;
  }
  for (const key of target.keys()) if (!source.has(key)) problems.push(`${key}: not in the English catalog`);
  errors += problems.length;
  const status = missing ? `${missing} of ${source.size} messages missing (English is shown)` : `${source.size} messages`;
  console.log(`${code}: ${status}, ${same} identical to English, ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  ${p}`);
}
process.exitCode = errors ? 1 : 0;
