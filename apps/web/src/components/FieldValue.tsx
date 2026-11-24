import type { FieldDef, RefMap } from '@titoforce/shared';
import { numberFormat } from '@titoforce/shared';
import { Check } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '../i18n/index.ts';
import { formatNumber, formatValue, optionLabel } from '../lib/format.ts';
import { useUsers } from '../lib/hooks.ts';
import { Avatar, Badge } from './ui.tsx';

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

export function UserChip({ id, name, size = 'xs' }: { id: string; name?: string; size?: 'xs' | 'sm' }) {
  const users = useUsers();
  const user = users.data?.find((u) => u.id === id);
  const label = user?.name ?? name ?? t('common.unknownUser');
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <Avatar name={label} color={user?.avatarColor} size={size} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Rich, read-only rendering of a field value. */
export function FieldValue({ field, value, refs }: { field: FieldDef | undefined; value: unknown; refs?: RefMap }) {
  if (field?.type === 'checkbox' || (field?.type === 'formula' && field.formulaType === 'checkbox')) {
    return value ? <Check className="size-4 text-emerald-600" aria-label={t('common.yes')} /> : <span className="text-slate-300">—</span>;
  }
  if (isEmpty(value)) return <span className="text-slate-300">—</span>;
  if (!field) return <>{formatValue(undefined, value)}</>;
  const kind = numberFormat(field);
  if (kind && typeof value === 'number') {
    return <span className={value < 0 ? 'text-rose-600 tabular-nums' : 'tabular-nums'}>{formatNumber(value, kind, field.precision)}</span>;
  }
  switch (field.type) {
    case 'picklist': {
      const opt = field.options?.find((o) => o.value === value);
      return <Badge color={opt?.color}>{opt?.label ?? String(value)}</Badge>;
    }
    case 'multipicklist':
      return (
        <span className="inline-flex flex-wrap gap-1">
          {(Array.isArray(value) ? value : [value]).map((v) => (
            <Badge key={String(v)} color={field.options?.find((o) => o.value === v)?.color}>
              {optionLabel(field, v)}
            </Badge>
          ))}
        </span>
      );
    case 'email':
      return (
        <a className="text-indigo-600 hover:underline" href={`mailto:${String(value)}`}>
          {String(value)}
        </a>
      );
    case 'phone':
      return (
        <a className="text-indigo-600 hover:underline" href={`tel:${String(value).replace(/[^\d+]/g, '')}`}>
          {String(value)}
        </a>
      );
    case 'url': {
      const href = String(value);
      return /^https?:\/\//i.test(href) ? (
        <a className="text-indigo-600 hover:underline" href={href} target="_blank" rel="noopener noreferrer">
          {href.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
        </a>
      ) : (
        <>{href}</>
      );
    }
    case 'lookup': {
      const id = String(value);
      const ref = refs?.[id];
      return ref ? (
        <Link className="text-indigo-600 hover:underline" to={`/r/${id}`}>
          {ref.name}
        </Link>
      ) : (
        <span className="text-slate-400">{t('components.fieldValue.restricted')}</span>
      );
    }
    case 'user':
      return <UserChip id={String(value)} name={refs?.[String(value)]?.name} />;
    case 'longtext':
      return <span className="whitespace-pre-wrap">{String(value)}</span>;
    default:
      return <>{formatValue(field, value, refs)}</>;
  }
}
