import { Bot, ChartColumn, Kanban, Languages, LifeBuoy, type LucideIcon, Users } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { isLocale, LOCALES, type MessageKey, setLocale, t, useLocale } from '../i18n/index.ts';

const HIGHLIGHTS: { icon: LucideIcon; text: MessageKey }[] = [
  { icon: ChartColumn, text: 'login.highlights.sales' },
  { icon: LifeBuoy, text: 'login.highlights.service' },
  { icon: Kanban, text: 'login.highlights.work' },
  { icon: Users, text: 'login.highlights.people' },
  { icon: Bot, text: 'login.highlights.ai' },
];

/** Language menu for pages without a signed-in user (signed-in users choose in My settings). */
export function LanguagePicker() {
  const locale = useLocale();
  const id = useId();
  return (
    <span className="inline-flex items-center gap-1.5">
      <Languages className="size-3.5 text-slate-400" aria-hidden />
      <label htmlFor={id} className="sr-only">
        {t('common.language')}
      </label>
      <select
        id={id}
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) void setLocale(e.target.value);
        }}
        className="cursor-pointer rounded border-0 bg-transparent py-0.5 pr-6 pl-1 text-xs text-slate-600 hover:text-slate-900 focus:ring-2 focus:ring-indigo-500"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Two-column frame of the sign-in and sign-up pages. */
export function AuthLayout({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full bg-slate-50">
      <div className="relative hidden w-[44%] overflow-hidden bg-gradient-to-br from-indigo-700 via-violet-700 to-fuchsia-700 p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-9 rounded-lg bg-white/10 p-1" />
          <span className="text-xl font-semibold tracking-tight">titoForce</span>
        </div>
        <div className="my-auto max-w-md">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">{t('login.tagline')}</h1>
          <p className="mt-4 text-indigo-100">{t('login.intro')}</p>
          <ul className="mt-8 space-y-3">
            {HIGHLIGHTS.map(({ icon: I, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-indigo-50">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
                  <I className="size-4" aria-hidden />
                </span>
                {t(text)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-indigo-200">{t('login.license')}</p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-2.5 lg:hidden">
              <img src="/favicon.svg" alt="" className="size-9" />
              <span className="text-xl font-semibold tracking-tight text-slate-900">titoForce</span>
            </div>
            {children}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 pb-6 text-xs text-slate-500">
          {footer}
          <LanguagePicker />
        </div>
      </div>
    </div>
  );
}
