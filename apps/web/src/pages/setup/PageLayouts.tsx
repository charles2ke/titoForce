import type { FieldDef, LayoutSection, ObjectDef, PageLayoutDef, RelatedListOption, RoleDef } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Asterisk, EllipsisVertical, GripVertical, Lock, Plus, Search, Trash, X } from 'lucide-react';
import { type DragEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { Button, cx, ErrorBanner, FormField, IconButton, Loading, MenuItem, Modal, Popover, Toggle } from '../../components/ui.tsx';
import { t } from '../../i18n/index.ts';
import { useUnsavedChanges } from '../../lib/unsaved.ts';

const MAX_HIGHLIGHTS = 6;
const MAX_SECTIONS = 30;

type Draft = Pick<PageLayoutDef, 'name' | 'isDefault' | 'highlights' | 'sections' | 'relatedLists' | 'roleIds'>;
type LayoutsResponse = { layouts: PageLayoutDef[]; relatedLists: RelatedListOption[] };
/** The layout being edited: `id` null for a new layout that is not saved yet. */
type Editing = { id: string | null; base: PageLayoutDef | null; draft: Draft };

type DragItem = { kind: 'field'; field: string; from: 'palette' | 'section' | 'highlights' } | { kind: 'related'; id: string };
type DropTarget = { zone: 'section'; id: string; index: number } | { zone: 'highlights'; index: number } | { zone: 'palette' } | { zone: 'related'; index: number } | { zone: 'relatedAvailable' };

const toDraft = (l: Draft): Draft => ({
  name: l.name,
  isDefault: l.isDefault,
  highlights: [...l.highlights],
  sections: l.sections.map((s) => ({ id: s.id, title: s.title, columns: s.columns, fields: [...s.fields] })),
  relatedLists: [...l.relatedLists],
  roleIds: [...l.roleIds].sort(),
});
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(toDraft(a)) === JSON.stringify(toDraft(b));
const sameTarget = (a: DropTarget | null, b: DropTarget) => JSON.stringify(a) === JSON.stringify(b);

function insertAt<T>(list: T[], item: T, index: number): T[] {
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

/** Moves `item` within or into `list`, before the element now at `index`. */
function placeIn<T>(list: T[], item: T, index: number): T[] {
  const at = list.indexOf(item);
  return insertAt(
    list.filter((x) => x !== item),
    item,
    at !== -1 && at < index ? index - 1 : index,
  );
}

function placeField(d: Draft, field: string, sectionId: string, index: number): Draft {
  return {
    ...d,
    sections: d.sections.map((s) => {
      if (s.id === sectionId) return { ...s, fields: placeIn(s.fields, field, index) };
      return s.fields.includes(field) ? { ...s, fields: s.fields.filter((f) => f !== field) } : s;
    }),
  };
}

const unplaceField = (d: Draft, field: string): Draft => ({ ...d, sections: d.sections.map((s) => (s.fields.includes(field) ? { ...s, fields: s.fields.filter((f) => f !== field) } : s)) });

function placeHighlight(d: Draft, field: string, index: number): Draft {
  if (!d.highlights.includes(field) && d.highlights.length >= MAX_HIGHLIGHTS) return d;
  return { ...d, highlights: placeIn(d.highlights, field, index) };
}

function newSectionId(sections: LayoutSection[]): string {
  let n = sections.length + 1;
  while (sections.some((s) => s.id === `section_${n}`)) n++;
  return `section_${n}`;
}

/** Insertion index for the pointer in a drop zone: before or after the closest `[data-drop-index]` child. */
function indexFromPointer(e: DragEvent<HTMLElement>, horizontal: boolean): number {
  let best: { index: number; rect: DOMRect; distance: number } | null = null;
  for (const el of Array.from(e.currentTarget.querySelectorAll<HTMLElement>(':scope > [data-drop-index]'))) {
    const rect = el.getBoundingClientRect();
    const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
    const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (!best || distance < best.distance) best = { index: Number(el.dataset.dropIndex), rect, distance };
  }
  if (!best) return 0;
  const { rect } = best;
  const after = horizontal ? e.clientY > rect.bottom || (e.clientY >= rect.top && e.clientX > rect.left + rect.width / 2) : e.clientY > rect.top + rect.height / 2;
  return best.index + (after ? 1 : 0);
}

/** Insertion marker between items while dragging. */
function DropBar({ side }: { side: 'top' | 'bottom' | 'left' | 'right' }) {
  const pos = { top: '-top-1 inset-x-0 h-0.5', bottom: '-bottom-1 inset-x-0 h-0.5', left: 'inset-y-0 -left-1 w-0.5', right: 'inset-y-0 -right-1 w-0.5' }[side];
  return <span aria-hidden className={cx('pointer-events-none absolute z-10 rounded-full bg-indigo-500', pos)} />;
}

function ChipMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  return (
    <Popover
      align="right"
      className="w-64 py-1"
      trigger={({ toggle, open }) => <IconButton icon={EllipsisVertical} label={label} aria-expanded={open} className="size-6 shrink-0 text-slate-400" onClick={toggle} />}
    >
      {children}
    </Popover>
  );
}

function FieldChip({
  field,
  dragging,
  drag,
  menu,
  marker,
  compact,
}: {
  field: FieldDef;
  dragging: boolean;
  drag: { draggable: true; onDragStart: (e: DragEvent<HTMLElement>) => void; onDragEnd: () => void };
  menu: ReactNode;
  marker?: ReactNode;
  /** Without the field type, as wide as the label. */
  compact?: boolean;
}) {
  return (
    <div
      {...drag}
      data-field={field.apiName}
      className={cx(
        'relative flex min-w-0 cursor-grab items-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 pr-1 pl-1.5 text-sm shadow-xs active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      {marker}
      <GripVertical className="size-4 shrink-0 text-slate-300" aria-hidden />
      <span className={cx('min-w-0 truncate text-slate-800', !compact && 'flex-auto')} title={field.label}>
        {field.label}
      </span>
      {field.required && (
        <span title={t('setupLayouts.fields.requiredLocked')} className="shrink-0 text-rose-500">
          <Asterisk className="size-3.5" aria-label={t('setupLayouts.fields.required')} />
        </span>
      )}
      {field.sensitive && (
        <span title={t('setupLayouts.fields.sensitive')} className="shrink-0 text-amber-600">
          <Lock className="size-3.5" aria-label={t('setupLayouts.fields.sensitive')} />
        </span>
      )}
      {!compact && <span className="hidden min-w-0 shrink-[4] truncate text-xs text-slate-400 xl:inline">{t(`setupObjects.fieldTypes.${field.type}`)}</span>}
      {menu}
    </div>
  );
}

function LayoutEditor({
  def,
  draft,
  onChange,
  relatedOptions,
  roles,
  others,
  defaultLocked,
}: {
  def: ObjectDef;
  draft: Draft;
  onChange: (d: Draft) => void;
  relatedOptions: RelatedListOption[];
  roles: RoleDef[];
  others: PageLayoutDef[];
  defaultLocked: boolean;
}) {
  const ids = { name: useId(), search: useId(), highlight: useId() };
  const [q, setQ] = useState('');
  const dragRef = useRef<DragItem | null>(null);
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

  const fieldOf = (name: string) => def.fields.find((f) => f.apiName === name);
  const placed = new Set(draft.sections.flatMap((s) => s.fields));
  const term = q.trim().toLowerCase();
  const unplaced = def.fields.filter((f) => !placed.has(f.apiName));
  const palette = unplaced.filter((f) => !term || f.label.toLowerCase().includes(term) || f.apiName.includes(term));
  const highlightsFull = draft.highlights.length >= MAX_HIGHLIGHTS;
  const first = draft.sections[0];
  const sectionTitle = (s: LayoutSection) => s.title || t('setupLayouts.sections.untitled', { object: def.label });
  const relatedLabel = (id: string) => relatedOptions.find((o) => o.id === id)?.label ?? id;
  const availableRelated = relatedOptions.filter((o) => !draft.relatedLists.includes(o.id));
  const roleOwner = (roleId: string) => others.find((l) => l.roleIds.includes(roleId));

  const accepts = (item: DragItem, target: DropTarget): boolean => {
    if (item.kind === 'related') return target.zone === 'related' || target.zone === 'relatedAvailable';
    if (target.zone === 'related' || target.zone === 'relatedAvailable') return false;
    if (target.zone === 'highlights') return draft.highlights.includes(item.field) || !highlightsFull;
    if (item.from === 'highlights') return target.zone === 'palette';
    if (target.zone === 'palette') return item.from === 'section' && !fieldOf(item.field)?.required;
    return true;
  };

  const apply = (item: DragItem, target: DropTarget) => {
    if (item.kind === 'related') {
      if (target.zone === 'related') onChange({ ...draft, relatedLists: placeIn(draft.relatedLists, item.id, target.index) });
      if (target.zone === 'relatedAvailable') onChange({ ...draft, relatedLists: draft.relatedLists.filter((x) => x !== item.id) });
      return;
    }
    if (target.zone === 'section') onChange(placeField(draft, item.field, target.id, target.index));
    else if (target.zone === 'highlights') onChange(placeHighlight(draft, item.field, target.index));
    else if (target.zone === 'palette') onChange(item.from === 'highlights' ? { ...draft, highlights: draft.highlights.filter((f) => f !== item.field) } : unplaceField(draft, item.field));
  };

  const endDrag = () => {
    dragRef.current = null;
    setDrag(null);
    setDrop(null);
  };

  const dragProps = (item: DragItem) => ({
    draggable: true as const,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.stopPropagation();
      dragRef.current = item;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.kind === 'field' ? item.field : item.id);
      // Render the drag image before dimming the source.
      requestAnimationFrame(() => dragRef.current === item && setDrag(item));
    },
    onDragEnd: endDrag,
  });

  /** Drop zone handlers; `targetAt` maps the pointer position to the insertion point. */
  const zone = (targetAt: (e: DragEvent<HTMLElement>) => DropTarget) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      const item = dragRef.current;
      if (!item) return;
      const target = targetAt(e);
      if (!accepts(item, target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDrop((cur) => (sameTarget(cur, target) ? cur : target));
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const item = dragRef.current;
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      const target = targetAt(e);
      endDrag();
      if (accepts(item, target)) apply(item, target);
    },
  });

  const marker = (active: boolean, count: number, index: number, horizontal: boolean, target: number | undefined) => {
    if (!active || target === undefined) return null;
    if (target === index) return <DropBar side={horizontal ? 'left' : 'top'} />;
    if (target === count && index === count - 1) return <DropBar side={horizontal ? 'right' : 'bottom'} />;
    return null;
  };

  const updateSection = (id: string, patch: Partial<LayoutSection>) => onChange({ ...draft, sections: draft.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const moveSection = (from: number, to: number) => {
    if (to < 0 || to >= draft.sections.length) return;
    const sections = [...draft.sections];
    const [s] = sections.splice(from, 1);
    sections.splice(to, 0, s!);
    onChange({ ...draft, sections });
  };
  const addSection = () =>
    onChange({ ...draft, sections: [...draft.sections, { id: newSectionId(draft.sections), title: t('setupLayouts.sections.newTitle'), columns: 2, fields: [] }] });

  const toggleHighlight = (field: string) =>
    onChange(draft.highlights.includes(field) ? { ...draft, highlights: draft.highlights.filter((f) => f !== field) } : placeHighlight(draft, field, draft.highlights.length));

  return (
    <div className="space-y-4" onDragOver={() => drop && setDrop(null)}>
      <section className="card grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-4">
          <FormField label={t('setupLayouts.name')} required htmlFor={ids.name} error={draft.name.trim() ? undefined : t('setupLayouts.problems.name')}>
            <input id={ids.name} className="input" maxLength={80} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
          </FormField>
          <div>
            <Toggle checked={draft.isDefault} disabled={defaultLocked} label={t('setupLayouts.isDefault')} onChange={(v) => onChange({ ...draft, isDefault: v })} />
            <p className="mt-1 text-xs text-slate-500">{defaultLocked ? t('setupLayouts.defaultLocked') : t('setupLayouts.isDefaultHelp')}</p>
          </div>
        </div>
        <fieldset>
          <legend className="label">{t('setupLayouts.roles')}</legend>
          <p className="mb-2 text-xs text-slate-500">{t('setupLayouts.rolesHelp')}</p>
          {roles.length === 0 ? (
            <p className="text-sm text-slate-400">{t('setupLayouts.rolesNone')}</p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {roles.map((r) => {
                const owner = roleOwner(r.id);
                return (
                  <li key={r.id}>
                    <label className={cx('flex items-start gap-2 text-sm', owner ? 'text-slate-400' : 'text-slate-700')}>
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-indigo-600"
                        disabled={!!owner}
                        checked={draft.roleIds.includes(r.id)}
                        onChange={(e) => onChange({ ...draft, roleIds: e.target.checked ? [...draft.roleIds, r.id].sort() : draft.roleIds.filter((x) => x !== r.id) })}
                      />
                      <span className="min-w-0">
                        {r.name}
                        {owner && <span className="block text-xs">{t('setupLayouts.roleTaken', { layout: owner.name })}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
      </section>

      <p className="text-xs text-slate-500">{t('setupLayouts.dragHint')}</p>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside
          aria-label={t('setupLayouts.fields.title')}
          {...zone(() => ({ zone: 'palette' }))}
          className={cx(
            'card shrink-0 p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-10rem)] lg:w-64 lg:overflow-y-auto',
            drop?.zone === 'palette' && 'ring-2 ring-indigo-300',
          )}
        >
          <h3 className="text-sm font-semibold text-slate-800">{t('setupLayouts.fields.title')}</h3>
          <p className="mb-2 text-xs text-slate-500">{t('setupLayouts.fields.help')}</p>
          {unplaced.length > 0 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
              <input id={ids.search} type="search" aria-label={t('setupLayouts.fields.search')} placeholder={t('setupLayouts.fields.searchPlaceholder')} className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {unplaced.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">{t('setupLayouts.fields.allPlaced')}</p>
          ) : palette.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">{t('setupLayouts.fields.noMatches')}</p>
          ) : (
            <ul className="space-y-1.5">
              {palette.map((f) => (
                <li key={f.apiName}>
                  <FieldChip
                    field={f}
                    dragging={drag?.kind === 'field' && drag.field === f.apiName && drag.from === 'palette'}
                    drag={dragProps({ kind: 'field', field: f.apiName, from: 'palette' })}
                    menu={
                      first && (
                        <IconButton
                          icon={Plus}
                          label={t('setupLayouts.fields.add', { field: f.label, section: sectionTitle(first) })}
                          className="size-6 shrink-0 text-slate-400"
                          onClick={() => onChange(placeField(draft, f.apiName, first.id, first.fields.length))}
                        />
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          <section aria-labelledby={ids.highlight} className="card p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={ids.highlight} className="text-sm font-semibold text-slate-800">
                {t('setupLayouts.highlights.title')}
              </h3>
              <span className="text-xs text-slate-500">{t('setupLayouts.highlights.help', { count: MAX_HIGHLIGHTS })}</span>
            </div>
            <div
              {...zone((e) => ({ zone: 'highlights', index: indexFromPointer(e, true) }))}
              className={cx(
                'flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-dashed p-2',
                drop?.zone === 'highlights' ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-300 bg-slate-50/60',
              )}
            >
              {draft.highlights.length === 0 && <span className="px-1 text-xs text-slate-400">{t('setupLayouts.highlights.empty')}</span>}
              {draft.highlights.map((name, i) => {
                const f = fieldOf(name);
                if (!f) return null;
                return (
                  <div key={name} className="max-w-64 min-w-0" data-drop-index={i}>
                    <FieldChip
                      field={f}
                      compact
                      dragging={drag?.kind === 'field' && drag.field === name && drag.from === 'highlights'}
                      drag={dragProps({ kind: 'field', field: name, from: 'highlights' })}
                      marker={marker(drop?.zone === 'highlights', draft.highlights.length, i, true, drop?.zone === 'highlights' ? drop.index : undefined)}
                      menu={
                        <ChipMenu label={t('setupLayouts.fields.menu', { field: f.label })}>
                          {(close) => (
                            <>
                              {i > 0 && (
                                <MenuItem
                                  icon={ArrowLeft}
                                  onClick={() => {
                                    close();
                                    onChange(placeHighlight(draft, name, i - 1));
                                  }}
                                >
                                  {t('setupLayouts.highlights.moveLeft', { field: f.label })}
                                </MenuItem>
                              )}
                              {i < draft.highlights.length - 1 && (
                                <MenuItem
                                  icon={ArrowRight}
                                  onClick={() => {
                                    close();
                                    onChange(placeHighlight(draft, name, i + 2));
                                  }}
                                >
                                  {t('setupLayouts.highlights.moveRight', { field: f.label })}
                                </MenuItem>
                              )}
                              <MenuItem
                                icon={X}
                                danger
                                onClick={() => {
                                  close();
                                  toggleHighlight(name);
                                }}
                              >
                                {t('setupLayouts.highlights.remove', { field: f.label })}
                              </MenuItem>
                            </>
                          )}
                        </ChipMenu>
                      }
                    />
                  </div>
                );
              })}
              {!highlightsFull && (
                <select
                  aria-label={t('setupLayouts.highlights.addLabel')}
                  className="input h-8 w-40 py-0 text-xs"
                  value=""
                  onChange={(e) => e.target.value && onChange(placeHighlight(draft, e.target.value, draft.highlights.length))}
                >
                  <option value="">{t('setupLayouts.highlights.add')}</option>
                  {def.fields
                    .filter((f) => !draft.highlights.includes(f.apiName))
                    .map((f) => (
                      <option key={f.apiName} value={f.apiName}>
                        {f.label}
                      </option>
                    ))}
                </select>
              )}
            </div>
            {highlightsFull && <p className="mt-1 text-xs text-slate-500">{t('setupLayouts.highlights.full', { count: MAX_HIGHLIGHTS })}</p>}
          </section>

          {draft.sections.map((s, si) => {
            const horizontal = s.columns === 2;
            const target = drop?.zone === 'section' && drop.id === s.id ? drop.index : undefined;
            const hasRequired = s.fields.some((f) => fieldOf(f)?.required);
            return (
              <section key={s.id} aria-label={sectionTitle(s)} className="card p-4" data-section={s.id}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <input
                    className="input h-8 max-w-xs min-w-0 flex-1 basis-48 font-semibold"
                    aria-label={t('setupLayouts.sections.titleLabel')}
                    maxLength={80}
                    value={s.title}
                    placeholder={t('setupLayouts.sections.untitled', { object: def.label })}
                    onChange={(e) => updateSection(s.id, { title: e.target.value })}
                  />
                  <select
                    className="input h-8 w-32 py-0 text-xs"
                    aria-label={t('setupLayouts.sections.columns')}
                    value={s.columns}
                    onChange={(e) => updateSection(s.id, { columns: e.target.value === '1' ? 1 : 2 })}
                  >
                    <option value={1}>{t('setupLayouts.sections.oneColumn')}</option>
                    <option value={2}>{t('setupLayouts.sections.twoColumns')}</option>
                  </select>
                  <span className="ml-auto flex items-center gap-0.5">
                    <IconButton icon={ArrowUp} label={t('setupLayouts.sections.moveUp', { section: sectionTitle(s) })} className="size-7 disabled:opacity-30" disabled={si === 0} onClick={() => moveSection(si, si - 1)} />
                    <IconButton
                      icon={ArrowDown}
                      label={t('setupLayouts.sections.moveDown', { section: sectionTitle(s) })}
                      className="size-7 disabled:opacity-30"
                      disabled={si === draft.sections.length - 1}
                      onClick={() => moveSection(si, si + 1)}
                    />
                    <span title={hasRequired ? t('setupLayouts.fields.requiredLocked') : undefined}>
                      <IconButton
                        icon={Trash}
                        label={t('setupLayouts.sections.remove', { section: sectionTitle(s) })}
                        className="size-7 hover:text-rose-600 disabled:opacity-30"
                        disabled={draft.sections.length === 1 || hasRequired}
                        onClick={() => onChange({ ...draft, sections: draft.sections.filter((x) => x.id !== s.id) })}
                      />
                    </span>
                  </span>
                </div>
                <div
                  {...zone((e) => ({ zone: 'section', id: s.id, index: indexFromPointer(e, horizontal) }))}
                  className={cx(
                    'grid min-h-14 gap-2 rounded-lg p-1',
                    horizontal && 'sm:grid-cols-2',
                    s.fields.length === 0 && 'place-items-center border border-dashed',
                    s.fields.length === 0 && (target !== undefined ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-300'),
                  )}
                >
                  {s.fields.length === 0 && <span className="text-xs text-slate-400">{t('setupLayouts.sections.empty')}</span>}
                  {s.fields.map((name, i) => {
                    const f = fieldOf(name);
                    if (!f) return null;
                    const others = draft.sections.filter((x) => x.id !== s.id);
                    return (
                      <div key={name} className={cx('min-w-0', horizontal && f.type === 'longtext' && 'sm:col-span-2')} data-drop-index={i}>
                        <FieldChip
                          field={f}
                          dragging={drag?.kind === 'field' && drag.field === name && drag.from === 'section'}
                          drag={dragProps({ kind: 'field', field: name, from: 'section' })}
                          marker={marker(target !== undefined, s.fields.length, i, horizontal, target)}
                          menu={
                            <ChipMenu label={t('setupLayouts.fields.menu', { field: f.label })}>
                              {(close) => {
                                const run = (fn: () => void) => () => {
                                  close();
                                  fn();
                                };
                                return (
                                  <>
                                    {i > 0 && (
                                      <MenuItem icon={ArrowUp} onClick={run(() => onChange(placeField(draft, name, s.id, i - 1)))}>
                                        {t('setupLayouts.fields.moveUp')}
                                      </MenuItem>
                                    )}
                                    {i < s.fields.length - 1 && (
                                      <MenuItem icon={ArrowDown} onClick={run(() => onChange(placeField(draft, name, s.id, i + 2)))}>
                                        {t('setupLayouts.fields.moveDown')}
                                      </MenuItem>
                                    )}
                                    {others.map((o) => (
                                      <MenuItem key={o.id} icon={ArrowRight} onClick={run(() => onChange(placeField(draft, name, o.id, o.fields.length)))}>
                                        {t('setupLayouts.fields.moveTo', { section: sectionTitle(o) })}
                                      </MenuItem>
                                    ))}
                                    {draft.highlights.includes(name) ? (
                                      <MenuItem onClick={run(() => toggleHighlight(name))}>{t('setupLayouts.fields.removeFromHighlights')}</MenuItem>
                                    ) : (
                                      !highlightsFull && <MenuItem onClick={run(() => toggleHighlight(name))}>{t('setupLayouts.fields.addToHighlights')}</MenuItem>
                                    )}
                                    {!f.required && (
                                      <MenuItem icon={X} danger onClick={run(() => onChange(unplaceField(draft, name)))}>
                                        {t('setupLayouts.fields.removeFromLayout')}
                                      </MenuItem>
                                    )}
                                  </>
                                );
                              }}
                            </ChipMenu>
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <div className="flex flex-wrap items-center gap-3">
            <Button icon={Plus} disabled={draft.sections.length >= MAX_SECTIONS} onClick={addSection}>
              {t('setupLayouts.sections.add')}
            </Button>
            {draft.sections.length >= MAX_SECTIONS && <span className="text-xs text-slate-500">{t('setupLayouts.sections.max', { count: MAX_SECTIONS })}</span>}
          </div>

          <section className="card p-4" aria-label={t('setupLayouts.related.title')}>
            <h3 className="text-sm font-semibold text-slate-800">{t('setupLayouts.related.title')}</h3>
            <p className="mb-2 text-xs text-slate-500">{t('setupLayouts.related.help')}</p>
            {relatedOptions.length === 0 ? (
              <p className="text-sm text-slate-400">{t('setupLayouts.related.none', { object: def.label })}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <ol
                  {...zone((e) => ({ zone: 'related', index: indexFromPointer(e, false) }))}
                  className={cx('min-h-12 space-y-1.5 rounded-lg border border-dashed p-2', drop?.zone === 'related' ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-300')}
                >
                  {draft.relatedLists.length === 0 && <li className="px-1 py-2 text-xs text-slate-400">{t('setupLayouts.related.empty')}</li>}
                  {draft.relatedLists.map((id, i) => {
                    const label = relatedLabel(id);
                    const target = drop?.zone === 'related' ? drop.index : undefined;
                    return (
                      <li
                        key={id}
                        {...dragProps({ kind: 'related', id })}
                        data-drop-index={i}
                        className={cx(
                          'relative flex cursor-grab items-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1 pr-1 pl-1.5 text-sm shadow-xs',
                          drag?.kind === 'related' && drag.id === id && 'opacity-40',
                        )}
                      >
                        {marker(target !== undefined, draft.relatedLists.length, i, false, target)}
                        <GripVertical className="size-4 shrink-0 text-slate-300" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <IconButton
                          icon={ArrowUp}
                          label={t('setupLayouts.related.moveUp', { list: label })}
                          className="size-6 disabled:opacity-30"
                          disabled={i === 0}
                          onClick={() => onChange({ ...draft, relatedLists: placeIn(draft.relatedLists, id, i - 1) })}
                        />
                        <IconButton
                          icon={ArrowDown}
                          label={t('setupLayouts.related.moveDown', { list: label })}
                          className="size-6 disabled:opacity-30"
                          disabled={i === draft.relatedLists.length - 1}
                          onClick={() => onChange({ ...draft, relatedLists: placeIn(draft.relatedLists, id, i + 2) })}
                        />
                        <IconButton icon={X} label={t('setupLayouts.related.remove', { list: label })} className="size-6" onClick={() => onChange({ ...draft, relatedLists: draft.relatedLists.filter((x) => x !== id) })} />
                      </li>
                    );
                  })}
                </ol>
                <div {...zone(() => ({ zone: 'relatedAvailable' }))} className={cx('rounded-lg p-2', drop?.zone === 'relatedAvailable' && 'ring-2 ring-indigo-300')}>
                  <h4 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase">{t('setupLayouts.related.available')}</h4>
                  {availableRelated.length === 0 && <p className="text-xs text-slate-400">{t('setupLayouts.related.allAdded')}</p>}
                  <ul className="space-y-1.5">
                    {availableRelated.map((o) => (
                      <li key={o.id} {...dragProps({ kind: 'related', id: o.id })} className="flex cursor-grab items-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-1 pr-1 pl-1.5 text-sm text-slate-600">
                        <GripVertical className="size-4 shrink-0 text-slate-300" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        <IconButton icon={Plus} label={t('setupLayouts.related.add', { list: o.label })} className="size-6" onClick={() => onChange({ ...draft, relatedLists: [...draft.relatedLists, o.id] })} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function NewLayoutModal({ layouts, from, onClose, onCreate }: { layouts: PageLayoutDef[]; from: PageLayoutDef; onClose: () => void; onCreate: (source: PageLayoutDef, name: string) => void }) {
  const ids = { name: useId(), source: useId() };
  const [sourceId, setSourceId] = useState(from.id);
  const [name, setName] = useState(t('setupLayouts.copyName', { name: from.name }));
  const source = layouts.find((l) => l.id === sourceId) ?? from;
  return (
    <Modal
      open
      onClose={onClose}
      title={t('setupLayouts.newLayoutTitle')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={ids.name + 'form'} disabled={!name.trim()}>
            {t('setupLayouts.create')}
          </Button>
        </>
      }
    >
      <form
        id={ids.name + 'form'}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(source, name.trim());
        }}
      >
        <FormField label={t('setupLayouts.name')} required htmlFor={ids.name}>
          <input id={ids.name} className="input" maxLength={80} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={t('setupLayouts.startFrom')} htmlFor={ids.source}>
          <select
            id={ids.source}
            className="input"
            value={sourceId}
            onChange={(e) => {
              const next = layouts.find((l) => l.id === e.target.value);
              if (next && name === t('setupLayouts.copyName', { name: source.name })) setName(t('setupLayouts.copyName', { name: next.name }));
              setSourceId(e.target.value);
            }}
          >
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </FormField>
      </form>
    </Modal>
  );
}

/** Setup → Object Manager → Page Layouts. Receives the object as defined in Setup (English labels). */
export function PageLayoutsTab({ def }: { def: ObjectDef }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const selectId = useId();
  const key = ['layouts', def.apiName];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<LayoutsResponse>(`/api/objects/${def.apiName}/layouts`) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDef[]>('/api/roles'), staleTime: 5 * 60_000 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [creating, setCreating] = useState(false);

  const layouts = q.data?.layouts ?? [];
  const dirty = !!editing && (!editing.base || !sameDraft(editing.draft, editing.base));
  const ask = useUnsavedChanges(dirty);

  const open = (l: PageLayoutDef) => setEditing({ id: l.id, base: l, draft: toDraft(l) });

  // Follow the server's latest version (e.g. another administrator saved) unless there are unsaved changes.
  useEffect(() => {
    if (!q.data) return;
    const list = q.data.layouts;
    const fallback = list.find((l) => l.isDefault) ?? list[0];
    setEditing((cur) => {
      if (!cur) return fallback ? { id: fallback.id, base: fallback, draft: toDraft(fallback) } : null;
      if (cur.id === null) return cur;
      const fresh = list.find((l) => l.id === cur.id);
      const unchanged = !cur.base || sameDraft(cur.draft, cur.base);
      if (!unchanged) return cur;
      if (!fresh) return fallback ? { id: fallback.id, base: fallback, draft: toDraft(fallback) } : null;
      return fresh.updatedAt === cur.base?.updatedAt && sameDraft(toDraft(fresh), cur.draft) ? cur : { id: fresh.id, base: fresh, draft: toDraft(fresh) };
    });
  }, [q.data]);

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: Draft }) => {
      // Leave out fields and related lists deleted while editing.
      const fields = new Set(def.fields.map((f) => f.apiName));
      const related = new Set((q.data?.relatedLists ?? []).map((o) => o.id));
      const body = {
        ...draft,
        name: draft.name.trim(),
        highlights: draft.highlights.filter((f) => fields.has(f)),
        sections: draft.sections.map((s) => ({ ...s, title: s.title.trim(), fields: s.fields.filter((f) => fields.has(f)) })),
        relatedLists: draft.relatedLists.filter((r) => related.has(r)),
      };
      return id ? api.put<PageLayoutDef>(`/api/objects/${def.apiName}/layouts/${id}`, body) : api.post<PageLayoutDef>(`/api/objects/${def.apiName}/layouts`, body);
    },
    onSuccess: async (saved) => {
      open(saved);
      toast.success(t('setupLayouts.saved'));
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['layout', def.apiName] })]);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/objects/${def.apiName}/layouts/${id}`),
    onSuccess: async (_, id) => {
      const fallback = layouts.find((l) => l.isDefault && l.id !== id) ?? layouts.find((l) => l.id !== id);
      if (fallback) open(fallback);
      else setEditing(null);
      toast.success(t('setupLayouts.deleted'));
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['layout', def.apiName] })]);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isLoading || roles.isLoading) return <Loading />;
  if (q.error) return <ErrorBanner error={q.error} />;
  if (!editing) return null;

  const current = editing.base;
  const problem = !editing.draft.name.trim() ? t('setupLayouts.problems.name') : editing.draft.sections.length === 0 ? t('setupLayouts.problems.sections') : null;

  const switchTo = async (id: string) => {
    const next = layouts.find((l) => l.id === id);
    if (!next || !(await ask())) return;
    save.reset();
    open(next);
  };

  const onDelete = async () => {
    if (!current) return;
    const ok = await confirm({ title: t('setupLayouts.deleteTitle', { name: current.name }), message: t('setupLayouts.deleteMessage'), confirmLabel: t('setupLayouts.delete'), danger: true });
    if (ok) remove.mutate(current.id);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('setupLayouts.intro', { object: def.label })}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={selectId} className="label">
            {t('setupLayouts.layout')}
          </label>
          <select id={selectId} className="input w-72" value={editing.id ?? ''} onChange={(e) => void switchTo(e.target.value)}>
            {editing.id === null && <option value="">{`${editing.draft.name || t('setupLayouts.newLayout')} · ${t('setupLayouts.notSaved')}`}</option>}
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.isDefault ? `${l.name} · ${t('setupLayouts.default')}` : l.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          icon={Plus}
          onClick={async () => {
            if (await ask()) setCreating(true);
          }}
        >
          {t('setupLayouts.newLayout')}
        </Button>
        {current && !current.isDefault && (
          <Button variant="danger" icon={Trash} loading={remove.isPending} onClick={() => void onDelete()}>
            {t('setupLayouts.delete')}
          </Button>
        )}
      </div>

      <LayoutEditor
        key={editing.id ?? 'new'}
        def={def}
        draft={editing.draft}
        onChange={(draft) => setEditing((cur) => (cur ? { ...cur, draft } : cur))}
        relatedOptions={q.data?.relatedLists ?? []}
        roles={roles.data ?? []}
        others={layouts.filter((l) => l.id !== editing.id)}
        defaultLocked={!!current?.isDefault}
      />

      {dirty && (
        <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className={cx('mr-auto text-sm', problem || save.error ? 'text-rose-600' : 'text-slate-600')}>{problem ?? (save.error ? errorMessage(save.error) : t('setupLayouts.unsaved'))}</span>
          <Button
            disabled={save.isPending}
            onClick={() => {
              save.reset();
              if (current) open(current);
              else {
                const fallback = layouts.find((l) => l.isDefault) ?? layouts[0];
                setEditing(fallback ? { id: fallback.id, base: fallback, draft: toDraft(fallback) } : null);
              }
            }}
          >
            {t('setupLayouts.discard')}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!!problem} onClick={() => save.mutate({ id: editing.id, draft: editing.draft })}>
            {t('setupLayouts.save')}
          </Button>
        </div>
      )}

      {creating && (
        <NewLayoutModal
          layouts={layouts}
          from={current ?? layouts.find((l) => l.isDefault) ?? layouts[0]!}
          onClose={() => setCreating(false)}
          onCreate={(source, name) => {
            setCreating(false);
            save.reset();
            setEditing({ id: null, base: null, draft: { ...toDraft(source), name, isDefault: false, roleIds: [] } });
          }}
        />
      )}
    </div>
  );
}
