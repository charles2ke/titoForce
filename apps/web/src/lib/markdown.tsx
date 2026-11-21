import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';

// A deliberately small markdown subset for agent output: links, bold, italics, code, lists, headings and tables.
// Everything renders as React text nodes, so model output can never inject HTML.

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])/g;
const LIST = /^\s*([-*•]|\d+[.)])\s+/;

function inline(text: string, key: string, onNavigate?: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) {
      const href = m[2]!;
      if (href.startsWith('/') && !href.startsWith('//')) {
        out.push(
          <Link key={k} to={href} onClick={onNavigate}>
            {m[1]}
          </Link>,
        );
      } else if (/^https?:\/\//i.test(href)) {
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {m[1]}
          </a>,
        );
      } else {
        out.push(m[1]);
      }
    } else if (m[3] !== undefined) {
      out.push(<strong key={k}>{inline(m[3], k, onNavigate)}</strong>);
    } else if (m[4] !== undefined) {
      out.push(<code key={k}>{m[4]}</code>);
    } else if (m[5] !== undefined) {
      out.push(<em key={k}>{m[5]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function Markdown({ text, onNavigate, className = '' }: { text: string; onNavigate?: () => void; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={`h${i}`} className="font-semibold text-slate-900">
          {inline(heading[1]!, `h${i}`, onNavigate)}
        </p>,
      );
      i++;
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && LIST.test(lines[i]!)) {
        items.push(<li key={i}>{inline(lines[i]!.replace(LIST, ''), `li${i}`, onNavigate)}</li>);
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={`l${i}`} className="list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={`l${i}`} className="list-disc space-y-1 pl-5">
            {items}
          </ul>
        ),
      );
      continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={`t${i}`} className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                {head.map((h, j) => (
                  <th key={j} className="px-2 py-1.5 font-medium">
                    {inline(h, `th${i}-${j}`, onNavigate)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className="px-2 py-1.5">
                      {inline(c, `td${i}-${ri}-${j}`, onNavigate)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !LIST.test(lines[i]!) && !/^#{1,4}\s/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(
      <p key={`p${i}`}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(l, `p${i}-${j}`, onNavigate)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className={`prose-chat space-y-2 text-sm leading-relaxed break-words ${className}`}>{blocks}</div>;
}
