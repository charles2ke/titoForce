import { PALETTE, type PaletteColor } from '@titoforce/shared';
import { Check, ChevronDown } from 'lucide-react';
import { t, tryT } from '../i18n/index.ts';
import { hex } from '../lib/colors.ts';
import { Icon, ICON_NAMES } from '../lib/icons.tsx';
import { cx, Popover } from './ui.tsx';

// Icon names are stored ids such as "book-open"; known ones have a translated name ("bookOpen" in the catalog).
const iconLabel = (name: string) => tryT(`components.icons.${name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`) ?? name.replace(/-/g, ' ');

/** Button showing the current icon; opens a grid of the available icons. */
export function IconPicker({ value, onChange, id }: { value: string; onChange: (icon: string) => void; id?: string }) {
  return (
    <Popover
      className="w-72 p-2"
      trigger={({ open, toggle }) => (
        <button id={id} type="button" aria-haspopup="true" aria-expanded={open} onClick={toggle} className="input flex items-center gap-2 text-left">
          <Icon name={value} className="size-4 shrink-0 text-slate-600" />
          <span className="flex-1 truncate capitalize">{value ? iconLabel(value) : t('components.iconPicker.choose')}</span>
          <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div role="group" aria-label={t('components.iconPicker.label')} className="grid max-h-64 grid-cols-7 gap-1 overflow-y-auto">
          {ICON_NAMES.map((name) => {
            const on = name === value;
            return (
              <button
                key={name}
                type="button"
                aria-label={iconLabel(name)}
                aria-pressed={on}
                title={iconLabel(name)}
                onClick={() => {
                  onChange(name);
                  close();
                }}
                className={cx('flex size-8 items-center justify-center rounded-lg', on ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}
              >
                <Icon name={name} className="size-4" />
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

/** Swatches for the palette colors. */
export function ColorPicker({ value, onChange, label = t('common.color'), size = 'md' }: { value: string | null | undefined; onChange: (color: PaletteColor) => void; label?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="group" aria-label={label} className={cx('flex flex-wrap items-center', size === 'sm' ? 'gap-1' : 'gap-1.5')}>
      {PALETTE.map((c) => {
        const on = c === value;
        return (
          <button
            key={c}
            type="button"
            aria-label={t(`components.colors.${c}`)}
            aria-pressed={on}
            title={t(`components.colors.${c}`)}
            onClick={() => onChange(c)}
            style={{ backgroundColor: hex(c) }}
            className={cx(
              'flex shrink-0 items-center justify-center rounded-full ring-offset-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
              size === 'sm' ? 'size-5' : 'size-7',
              on ? 'ring-2 ring-slate-800' : 'hover:scale-110',
            )}
          >
            {on && <Check className={cx('text-white', size === 'sm' ? 'size-3' : 'size-3.5')} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/** A switch without visible text, for table rows and cards; `label` is its accessible name. */
export function InlineToggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60', checked ? 'bg-indigo-600' : 'bg-slate-300')}
    >
      <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  );
}
