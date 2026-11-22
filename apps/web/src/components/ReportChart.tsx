import type { ChartType, ReportResult } from '@titoforce/shared';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { t } from '../i18n/index.ts';
import { hex, SERIES } from '../lib/colors.ts';
import { formatCompact, formatNumber } from '../lib/format.ts';

const colorAt = (result: ReportResult, i: number) => {
  const c = result.rows[i]?.color;
  return c ? hex(c) : SERIES[i % SERIES.length]!;
};

const AXIS = { fontSize: 11, fill: '#64748b' };

export function ReportChart({ chart, result, height = 260 }: { chart: ChartType; result: ReportResult; height?: number }) {
  const fmt = (v: number) => formatNumber(v, result.format, result.format === 'currency' ? 0 : undefined);
  const compact = (v: number) => formatCompact(v, result.format);
  const tooltip = <Tooltip formatter={(v) => [fmt(Number(v)), result.metricLabel]} contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />;

  if (chart === 'kpi') {
    return (
      <div className="@container flex flex-col items-center justify-center py-6" style={{ minHeight: Math.min(height, 160) }}>
        {/* Scales down with the card's width; very long values wrap instead of spilling out. */}
        <div className="max-w-full text-center font-semibold tracking-tight [overflow-wrap:anywhere] text-slate-900 tabular-nums" style={{ fontSize: 'clamp(1.5rem, 14cqi, 2.25rem)', lineHeight: 1.15 }}>
          {fmt(result.total)}
        </div>
        <div className="mt-1 text-sm text-slate-500">{result.metricLabel}</div>
      </div>
    );
  }
  if (!result.rows.length) return <div className="flex items-center justify-center text-sm text-slate-400" style={{ height: Math.min(height, 160) }}>{t('components.chart.noData')}</div>;

  if (chart === 'table') {
    return (
      <div className="overflow-y-auto" style={{ maxHeight: height }}>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {result.rows.map((r, i) => (
              <tr key={r.key ?? `none-${i}`}>
                <td className="py-1.5 pr-2 text-slate-700">{r.label}</td>
                <td className="py-1.5 text-right font-medium text-slate-900 tabular-nums">{fmt(r.value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200">
              <td className="pt-2 text-xs font-semibold text-slate-500 uppercase">{t('common.total')}</td>
              <td className="pt-2 text-right font-semibold tabular-nums">{fmt(result.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (chart === 'funnel') {
    const max = Math.max(...result.rows.map((r) => r.value), 1);
    return (
      <div className="space-y-1.5 py-1" style={{ minHeight: Math.min(height, 120) }}>
        {result.rows.map((r, i) => (
          <div key={r.key ?? `none-${i}`} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-right text-xs text-slate-600" title={r.label}>
              {r.label}
            </div>
            <div className="flex flex-1 justify-center">
              <div className="flex h-7 items-center justify-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap text-white" style={{ width: `${Math.max((r.value / max) * 100, 8)}%`, minWidth: '3.25rem', background: colorAt(result, i) }}>
                {compact(r.value)}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (chart === 'pie' || chart === 'donut') {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <div style={{ maxWidth: Math.min(height, 240) }} className="mx-auto aspect-square w-full min-w-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={result.rows} dataKey="value" nameKey="label" innerRadius={chart === 'donut' ? '58%' : 0} outerRadius="92%" paddingAngle={chart === 'donut' ? 2 : 0} stroke="#fff" isAnimationActive={false}>
                {result.rows.map((r, i) => (
                  <Cell key={r.key ?? `none-${i}`} fill={colorAt(result, i)} />
                ))}
              </Pie>
              {tooltip}
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="min-w-40 flex-1 space-y-1 text-xs">
          {result.rows.map((r, i) => (
            <li key={r.key ?? `none-${i}`} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colorAt(result, i) }} />
              <span className="flex-1 truncate text-slate-600">{r.label}</span>
              <span className="font-medium text-slate-900 tabular-nums">{compact(r.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (chart === 'line') {
    return (
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={result.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
            <YAxis tick={AXIS} tickFormatter={compact} tickLine={false} axisLine={false} width={56} />
            {tooltip}
            <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3, fill: '#6366f1' }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const horizontal = chart === 'bar';
  return (
    <div style={{ height: horizontal ? Math.max(height, result.rows.length * 30 + 20) : height }}>
      <ResponsiveContainer>
        <BarChart data={result.rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f1f5f9" horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={AXIS} tickFormatter={compact} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={false} width={110} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} interval="preserveStartEnd" />
              <YAxis tick={AXIS} tickFormatter={compact} tickLine={false} axisLine={false} width={56} />
            </>
          )}
          {tooltip}
          <Bar dataKey="value" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
            {result.rows.map((r, i) => (
              <Cell key={r.key ?? `none-${i}`} fill={colorAt(result, i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
