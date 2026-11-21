import type { ObjectDef, ReportDef, ReportResult } from '@titoforce/shared';
import { useQuery } from '@tanstack/react-query';
import { ChartColumn, Download, Filter, Pencil, RefreshCw, Rows3, Sigma } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api } from '../api.ts';
import { describeFilter } from '../components/FilterEditor.tsx';
import { ReportChart } from '../components/ReportChart.tsx';
import { Button, Card, EmptyState, ErrorBanner, Loading, ObjectTile } from '../components/ui.tsx';
import { fieldDef, formatDateTime, formatNumber, plural, relativeTime } from '../lib/format.ts';
import { useObjectDef, usePermissions } from '../lib/hooks.ts';

type ReportResponse = { report: ReportDef; result: ReportResult };

const SYSTEM_LABELS: Record<string, string> = { owner_id: 'Owner', created_at: 'Created Date', updated_at: 'Last Modified' };
const OVERALL_LABELS = { count: 'Total', sum: 'Total', avg: 'Overall average', min: 'Overall minimum', max: 'Overall maximum' } as const;

/** Column heading for the grouping, e.g. "Close Date (month)". */
function groupLabel(def: ObjectDef | undefined, groupBy: NonNullable<ReportDef['groupBy']>): string {
  const f = def?.fields.find((x) => x.apiName === groupBy.field);
  const label = SYSTEM_LABELS[groupBy.field] ?? (def && fieldDef(def, groupBy.field)?.label) ?? groupBy.field;
  const isDate =
    groupBy.field === 'created_at' || groupBy.field === 'updated_at' || (!!f && (f.type === 'date' || f.type === 'datetime' || (f.type === 'formula' && f.formulaType === 'date')));
  return isDate ? `${label} (${groupBy.interval ?? 'month'})` : label;
}

function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  // Neutralize spreadsheet formula injection, then quote (doubling embedded quotes).
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv(report: ReportDef, result: ReportResult, heading: string) {
  const header = report.groupBy ? [heading, result.metricLabel] : ['Metric', 'Value'];
  const lines = [header, ...result.rows.map((r) => [r.label, r.value])].map((cells) => cells.map(csvCell).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.name.trim().replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, '-').toLowerCase() || 'report'}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DataTable({ report, result, heading }: { report: ReportDef; result: ReportResult; heading: string }) {
  const showShare = report.metric.fn === 'count' || report.metric.fn === 'sum';
  const fmt = (v: number) => formatNumber(v, result.format);
  const share = (v: number) => (result.total ? formatNumber((v / result.total) * 100, 'percent', 1) : '—');
  const limited = !!report.limit && result.rows.length >= report.limit;
  return (
    <Card title="Data" actions={<span className="text-xs text-slate-500">{plural(result.rows.length, 'group')}</span>} className="overflow-hidden" bodyClassName="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5">
              {heading}
            </th>
            <th scope="col" className="px-4 py-2.5 text-right">
              {result.metricLabel}
            </th>
            {showShare && (
              <th scope="col" className="w-32 px-4 py-2.5 text-right">
                % of total
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {result.rows.length === 0 && (
            <tr>
              <td colSpan={showShare ? 3 : 2} className="px-4 py-8 text-center text-slate-400">
                No matching records
              </td>
            </tr>
          )}
          {result.rows.map((r, i) => (
            <tr key={r.key ?? `none-${i}`} className="hover:bg-slate-50/70">
              <td className="px-4 py-2 text-slate-700">{r.label}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-900 tabular-nums">{fmt(r.value)}</td>
              {showShare && <td className="px-4 py-2 text-right text-slate-500 tabular-nums">{share(r.value)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 bg-slate-50/60">
            <th scope="row" className="px-4 py-2.5 text-left font-semibold text-slate-700">
              {OVERALL_LABELS[report.metric.fn]}
            </th>
            <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{fmt(result.total)}</td>
            {showShare && <td className="px-4 py-2.5 text-right font-semibold text-slate-500 tabular-nums">{result.total ? '100%' : '—'}</td>}
          </tr>
        </tfoot>
      </table>
      {limited && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing the first {report.limit} groups. The total covers all matching records.</p>}
    </Card>
  );
}

export default function ReportView() {
  const { id = '' } = useParams();
  const perms = usePermissions();
  const navigate = useNavigate();
  const analyst = perms.canManageAutomations;
  const q = useQuery({ queryKey: ['report', id], queryFn: () => api.get<ReportResponse>(`/api/reports/${encodeURIComponent(id)}`), enabled: !!id });
  const { def } = useObjectDef(q.data?.report.object);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="p-6">
        {notFound ? (
          <EmptyState
            icon={ChartColumn}
            title="Report not found"
            action={
              <Link to="/reports" className="text-sm font-medium text-indigo-600 hover:underline">
                Back to reports
              </Link>
            }
          >
            It may have been deleted, or you may not have access to its records.
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            <ErrorBanner error={q.error ?? 'This report is not available.'} />
            <div className="flex gap-2">
              <Button onClick={() => navigate('/reports')}>Back to reports</Button>
              {analyst && q.error instanceof ApiError && q.error.status === 400 && (
                <Button variant="primary" icon={Pencil} onClick={() => navigate(`/reports/${id}/edit`)}>
                  Fix report
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const { report, result } = q.data;
  const heading = report.groupBy ? groupLabel(def, report.groupBy) : 'Metric';
  const asOf = new Date(q.dataUpdatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="min-h-full">
      <div className="border-b border-slate-200 bg-white px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start gap-4">
          {def && <ObjectTile icon={def.icon} color={def.color} size="lg" />}
          <div className="min-w-48 flex-1">
            <p className="text-xs font-medium text-slate-500">
              <Link to="/reports" className="hover:text-indigo-600 hover:underline">
                Reports
              </Link>
              <span className="mx-1.5 text-slate-300">/</span>
              <Link to={`/o/${report.object}`} className="hover:text-indigo-600 hover:underline">
                {def?.label ?? report.object}
              </Link>
            </p>
            <h1 className="truncate text-xl font-semibold text-slate-900">{report.name}</h1>
            {report.description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{report.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={RefreshCw} loading={q.isFetching} onClick={() => void q.refetch()}>
              Refresh
            </Button>
            <Button icon={Download} onClick={() => downloadCsv(report, result, heading)}>
              Export CSV
            </Button>
            {analyst && (
              <Button variant="primary" icon={Pencil} onClick={() => navigate(`/reports/${report.id}/edit`)}>
                Edit
              </Button>
            )}
          </div>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
          <div className="flex max-w-full min-w-0 items-start gap-1.5">
            <dt>
              <Filter className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="sr-only">Filters</span>
            </dt>
            <dd className="min-w-0 break-words">{def ? describeFilter(def, report.filters) : report.filters?.rules.length ? plural(report.filters.rules.length, 'condition') : 'No conditions'}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>
              <Sigma className="size-3.5" aria-hidden />
              <span className="sr-only">Metric</span>
            </dt>
            <dd>{result.metricLabel}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>
              <Rows3 className="size-3.5" aria-hidden />
              <span className="sr-only">Grouping</span>
            </dt>
            <dd>{report.groupBy ? `Grouped by ${heading}` : 'Not grouped'}</dd>
          </div>
          <div className="flex items-center gap-1.5" title={formatDateTime(report.updatedAt)}>
            <dt>Modified</dt>
            <dd>{relativeTime(report.updatedAt)}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-6 p-6">
        {!report.groupBy ? (
          <Card>
            <div className="py-6">
              <ReportChart chart="kpi" result={result} height={360} />
            </div>
          </Card>
        ) : (
          <>
            {report.chart !== 'table' && (
              <Card title={result.metricLabel}>
                <div className={report.chart === 'pie' || report.chart === 'donut' ? 'mx-auto max-w-xl' : undefined}>
                  <ReportChart chart={report.chart} result={result} height={360} />
                </div>
              </Card>
            )}
            <DataTable report={report} result={result} heading={heading} />
          </>
        )}
        <p className="text-xs text-slate-400">Results as of {asOf}, counting only the records you can access.</p>
      </div>
    </div>
  );
}
