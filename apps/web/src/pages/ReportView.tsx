import type { MetricFn, ObjectDef, ReportDef, ReportResult } from '@titoforce/shared';
import { useQuery } from '@tanstack/react-query';
import { ChartColumn, Download, Filter, Pencil, RefreshCw, Rows3, Sigma } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api } from '../api.ts';
import { describeFilter } from '../components/FilterEditor.tsx';
import { ReportChart } from '../components/ReportChart.tsx';
import { Button, Card, EmptyState, ErrorBanner, Loading, ObjectTile } from '../components/ui.tsx';
import { intlLocale, type MessageKey, t } from '../i18n/index.ts';
import { fieldDef, formatDateTime, formatNumber, relativeTime } from '../lib/format.ts';
import { useObjectDef, usePermissions } from '../lib/hooks.ts';
import { localizeResult } from '../lib/reports.ts';

type ReportResponse = { report: ReportDef; result: ReportResult };

const SYSTEM_LABELS: Record<string, MessageKey> = { owner_id: 'common.owner', created_at: 'reports.createdDate', updated_at: 'common.lastModified' };
const OVERALL_LABELS: Record<MetricFn, MessageKey> = {
  count: 'common.total',
  sum: 'common.total',
  avg: 'reports.view.overallAverage',
  min: 'reports.view.overallMinimum',
  max: 'reports.view.overallMaximum',
};

const systemLabel = (field: string) => (Object.hasOwn(SYSTEM_LABELS, field) ? t(SYSTEM_LABELS[field]) : undefined);

/** Column heading for the grouping, e.g. "Close Date (month)". */
function groupLabel(def: ObjectDef | undefined, groupBy: NonNullable<ReportDef['groupBy']>): string {
  const f = def?.fields.find((x) => x.apiName === groupBy.field);
  const label = systemLabel(groupBy.field) ?? (def && fieldDef(def, groupBy.field)?.label) ?? groupBy.field;
  const isDate =
    groupBy.field === 'created_at' || groupBy.field === 'updated_at' || (!!f && (f.type === 'date' || f.type === 'datetime' || (f.type === 'formula' && f.formulaType === 'date')));
  return isDate ? t(`reports.view.groupInterval.${groupBy.interval ?? 'month'}`, { field: label }) : label;
}

function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  // Neutralize spreadsheet formula injection, then quote (doubling embedded quotes).
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv(report: ReportDef, result: ReportResult, heading: string) {
  const header = report.groupBy ? [heading, result.metricLabel] : [t('reports.view.metric'), t('common.value')];
  const lines = [header, ...result.rows.map((r) => [r.label, r.value])].map((cells) => cells.map(csvCell).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.name.trim().replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, '-').toLowerCase() || t('reports.view.csvFileName')}.csv`;
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
    <Card
      title={t('reports.view.data')}
      actions={<span className="text-xs text-slate-500">{t('reports.view.groupCount', { count: result.rows.length })}</span>}
      className="overflow-hidden"
      bodyClassName="overflow-x-auto"
    >
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
                {t('reports.view.percentOfTotal')}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {result.rows.length === 0 && (
            <tr>
              <td colSpan={showShare ? 3 : 2} className="px-4 py-8 text-center text-slate-400">
                {t('reports.view.noMatchingRecords')}
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
              {t(OVERALL_LABELS[report.metric.fn])}
            </th>
            <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{fmt(result.total)}</td>
            {showShare && <td className="px-4 py-2.5 text-right font-semibold text-slate-500 tabular-nums">{result.total ? formatNumber(100, 'percent', 1) : '—'}</td>}
          </tr>
        </tfoot>
      </table>
      {limited && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{t('reports.view.limited', { count: report.limit ?? 0 })}</p>}
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
            title={t('reports.notFound')}
            action={
              <Link to="/reports" className="text-sm font-medium text-indigo-600 hover:underline">
                {t('reports.backToList')}
              </Link>
            }
          >
            {t('reports.view.notFoundMessage')}
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            <ErrorBanner error={q.error ?? t('reports.view.unavailable')} />
            <div className="flex gap-2">
              <Button onClick={() => navigate('/reports')}>{t('reports.backToList')}</Button>
              {analyst && q.error instanceof ApiError && q.error.status === 400 && (
                <Button variant="primary" icon={Pencil} onClick={() => navigate(`/reports/${id}/edit`)}>
                  {t('reports.view.fix')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const { report } = q.data;
  const result = localizeResult(q.data.result, def, report);
  const heading = report.groupBy ? groupLabel(def, report.groupBy) : t('reports.view.metric');
  const asOf = new Date(q.dataUpdatedAt).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="min-h-full">
      <div className="border-b border-slate-200 bg-white px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start gap-4">
          {def && <ObjectTile icon={def.icon} color={def.color} size="lg" />}
          <div className="min-w-48 flex-1">
            <p className="text-xs font-medium text-slate-500">
              <Link to="/reports" className="hover:text-indigo-600 hover:underline">
                {t('reports.title')}
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
              {t('common.refresh')}
            </Button>
            <Button icon={Download} onClick={() => downloadCsv(report, result, heading)}>
              {t('reports.view.exportCsv')}
            </Button>
            {analyst && (
              <Button variant="primary" icon={Pencil} onClick={() => navigate(`/reports/${report.id}/edit`)}>
                {t('common.edit')}
              </Button>
            )}
          </div>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
          <div className="flex max-w-full min-w-0 items-start gap-1.5">
            <dt>
              <Filter className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="sr-only">{t('reports.filters')}</span>
            </dt>
            <dd className="min-w-0 break-words">
              {def ? describeFilter(def, report.filters) : report.filters?.rules.length ? t('reports.view.conditionCount', { count: report.filters.rules.length }) : t('reports.view.noConditions')}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>
              <Sigma className="size-3.5" aria-hidden />
              <span className="sr-only">{t('reports.view.metric')}</span>
            </dt>
            <dd>{result.metricLabel}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>
              <Rows3 className="size-3.5" aria-hidden />
              <span className="sr-only">{t('reports.view.grouping')}</span>
            </dt>
            <dd>{report.groupBy ? t('reports.view.groupedBy', { field: heading }) : t('reports.view.notGrouped')}</dd>
          </div>
          <div className="flex items-center gap-1.5" title={formatDateTime(report.updatedAt)}>
            <dt>{t('reports.view.modified')}</dt>
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
        <p className="text-xs text-slate-400">{t('reports.view.resultsAsOf', { time: asOf })}</p>
      </div>
    </div>
  );
}
