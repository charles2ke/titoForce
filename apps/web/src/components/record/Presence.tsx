import type { ObjectDef, PresenceViewer } from '@titoforce/shared';
import { Pencil } from 'lucide-react';
import { t } from '../../i18n/index.ts';
import { tileClass } from '../../lib/colors.ts';
import { initials } from '../../lib/format.ts';
import { cx } from '../ui.tsx';

const MAX_FACES = 4;

/** What someone else is doing on the record, e.g. "Ana is editing Phone". */
export function presenceLabel(def: ObjectDef, viewer: PresenceViewer): string {
  if (!viewer.editing) return t('collab.viewing', { name: viewer.name });
  // Fields this user cannot see are not named.
  const field = viewer.editing === 'owner_id' ? t('common.owner') : def.fields.find((f) => f.apiName === viewer.editing)?.label;
  return field ? t('collab.editingField', { name: viewer.name, field }) : t('collab.editing', { name: viewer.name });
}

export function PresenceFace({ viewer, label, size = 'sm' }: { viewer: PresenceViewer; label: string; size?: 'sm' | 'xs' }) {
  return (
    <span title={label} className="relative inline-flex shrink-0">
      <span
        aria-hidden
        className={cx(
          'inline-flex items-center justify-center rounded-full font-semibold ring-2',
          size === 'sm' ? 'size-7 text-[10px]' : 'size-5 text-[9px]',
          tileClass(viewer.avatarColor),
          viewer.editing ? 'ring-amber-400' : 'ring-white',
        )}
      >
        {initials(viewer.name)}
      </span>
      {viewer.editing && (
        <span aria-hidden className="absolute -right-1 -bottom-1 inline-flex size-3.5 items-center justify-center rounded-full bg-amber-400 text-white ring-2 ring-white">
          <Pencil className="size-2" />
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The other people on the record page; the first one editing is also named. */
export function PresenceBar({ def, viewers }: { def: ObjectDef; viewers: PresenceViewer[] }) {
  if (!viewers.length) return null;
  const sorted = [...viewers].sort((a, b) => Number(!!b.editing) - Number(!!a.editing));
  const shown = sorted.slice(0, MAX_FACES);
  const hidden = sorted.slice(MAX_FACES);
  const editor = sorted.find((v) => v.editing);
  return (
    <div role="group" aria-label={t('collab.others', { count: viewers.length })} className="flex items-center gap-2">
      {editor && (
        <span aria-hidden className="hidden max-w-56 truncate text-xs font-medium text-amber-700 sm:inline">
          {presenceLabel(def, editor)}
        </span>
      )}
      <ul className="flex items-center -space-x-1.5">
        {shown.map((v) => (
          <li key={v.userId} className="inline-flex">
            <PresenceFace viewer={v} label={presenceLabel(def, v)} />
          </li>
        ))}
        {hidden.length > 0 && (
          <li className="inline-flex">
            <span
              title={hidden.map((v) => presenceLabel(def, v)).join('\n')}
              aria-label={t('collab.more', { count: hidden.length })}
              className="inline-flex size-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-2 ring-white"
            >
              +{hidden.length}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
