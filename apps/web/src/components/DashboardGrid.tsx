import type { DashboardDef, DashboardWidget, ReportDef, ReportResult } from '@titoforce/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { ReportChart } from './ReportChart.tsx';
import { Card, cx, EmptyState } from './ui.tsx';

/** A dashboard widget with its report already run for the current user (widgets fail individually). */
export interface RenderedWidget extends DashboardWidget {
  report: ReportDef | null;
  result: ReportResult | null;
  error: string | null;
}

export function useDashboard(id: string | null | undefined) {
  return useQuery({
    queryKey: ['dashboard', id],
    queryFn: () => api.get<{ dashboard: DashboardDef; widgets: RenderedWidget[] }>(`/api/dashboards/${encodeURIComponent(id ?? '')}`),
    enabled: !!id,
  });
}

// Literal class names so Tailwind generates them. The grid has one column when narrow, two from @lg and three from @2xl;
// with two columns only full-width (size 3) widgets span both, which keeps the order without leaving many gaps.
const SPAN: Record<1 | 2 | 3, string> = { 1: '', 2: '@2xl:col-span-2', 3: '@lg:col-span-2 @2xl:col-span-3' };

function WidgetCard({ widget }: { widget: RenderedWidget }) {
  const { report, result } = widget;
  const title = widget.title || report?.name || 'Report';
  const error = widget.error ?? (report ? null : 'Report was deleted');
  return (
    <Card
      className={cx('flex min-w-0 flex-col', SPAN[widget.size ?? 1] ?? SPAN[1])}
      title={
        report ? (
          <Link to={`/reports/${widget.reportId}`} title={report.description || undefined} className="hover:text-indigo-700 hover:underline">
            {title}
          </Link>
        ) : (
          title
        )
      }
      bodyClassName={cx('flex flex-1 flex-col p-4', report?.chart === 'kpi' ? 'justify-center' : 'justify-start')}
    >
      {error || !report || !result ? (
        <p className="flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{error ?? 'This report could not be loaded.'}</span>
        </p>
      ) : (
        <ReportChart chart={report.chart} result={result} height={240} />
      )}
    </Card>
  );
}

/** Read-only dashboard layout sized by the grid's own width, so it also fits beside the AI panel (widget size = column span). */
export function DashboardGrid({ widgets }: { widgets: RenderedWidget[] }) {
  if (!widgets.length) {
    return (
      <div className="card">
        <EmptyState icon={LayoutDashboard} title="This dashboard has no widgets yet">
          Add reports to the dashboard to see their charts here.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @2xl:grid-cols-3">
        {widgets.map((w, i) => (
          <WidgetCard key={`${i}:${w.reportId}`} widget={w} />
        ))}
      </div>
    </div>
  );
}
