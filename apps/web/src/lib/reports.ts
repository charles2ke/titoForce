import type { ObjectDef, ReportDef, ReportResult, ReportRow } from '@titoforce/shared';
import { intlLocale, t } from '../i18n/index.ts';
import { fieldDef, optionLabel } from './format.ts';

type Spec = Pick<ReportDef, 'metric' | 'groupBy' | 'sort' | 'limit'>;

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Intl.DateTimeFormat(intlLocale(), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * A report result in the reader's language. The server labels the metric, blank groups, checkboxes and months in
 * English and picklist groups with their stored values; record and user names are kept as they are.
 */
export function localizeResult(result: ReportResult, def: ObjectDef | undefined, spec: Spec): ReportResult {
  if (!def) return spec.groupBy && spec.sort === 'label' && spec.limit && spec.limit > 0 ? { ...result, rows: result.rows.slice(0, spec.limit) } : result;
  const metricField = spec.metric.fn === 'count' ? undefined : fieldDef(def, spec.metric.field ?? '');
  const metricLabel =
    spec.metric.fn === 'count' ? t('reports.summary.recordCount') : metricField ? t(`reports.summary.${spec.metric.fn}`, { field: metricField.label }) : result.metricLabel;
  if (!spec.groupBy) return { ...result, metricLabel, rows: result.rows.map((r) => ({ ...r, label: metricLabel })) };
  const field = fieldDef(def, spec.groupBy.field);
  const type = field?.type === 'formula' ? field.formulaType : field?.type;
  const isDate = type === 'date' || type === 'datetime';
  const interval = spec.groupBy.interval ?? 'month';
  const rows = result.rows.map((r): ReportRow => {
    if (r.key === null) return { ...r, label: t('reports.view.blank') };
    if (type === 'picklist') return { ...r, label: optionLabel(field, r.key) };
    if (type === 'checkbox') return { ...r, label: r.key === '1' || r.key === 'true' ? t('common.yes') : t('common.no') };
    if (isDate && interval === 'month') return { ...r, label: monthLabel(r.key) };
    return r;
  });
  if (spec.sort === 'label') rows.sort((a, b) => a.label.localeCompare(b.label, intlLocale()));
  return { ...result, metricLabel, rows: spec.sort === 'label' && spec.limit && spec.limit > 0 ? rows.slice(0, spec.limit) : rows };
}
