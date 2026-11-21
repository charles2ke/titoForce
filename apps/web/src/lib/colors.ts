// Static class maps for palette colors (Tailwind only generates classes it can see as literal strings).

const pick = (map: Record<string, string>, c: string | null | undefined): string => map[c ?? 'gray'] ?? map.gray!;

const BADGE: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  pink: 'bg-pink-50 text-pink-700 ring-pink-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};

const TILE: Record<string, string> = {
  gray: 'bg-slate-500 text-white',
  blue: 'bg-blue-500 text-white',
  green: 'bg-emerald-500 text-white',
  yellow: 'bg-amber-500 text-white',
  orange: 'bg-orange-500 text-white',
  red: 'bg-rose-500 text-white',
  purple: 'bg-violet-500 text-white',
  pink: 'bg-pink-500 text-white',
  teal: 'bg-teal-500 text-white',
  indigo: 'bg-indigo-500 text-white',
};

const SOFT_TILE: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-emerald-100 text-emerald-600',
  yellow: 'bg-amber-100 text-amber-700',
  orange: 'bg-orange-100 text-orange-600',
  red: 'bg-rose-100 text-rose-600',
  purple: 'bg-violet-100 text-violet-600',
  pink: 'bg-pink-100 text-pink-600',
  teal: 'bg-teal-100 text-teal-600',
  indigo: 'bg-indigo-100 text-indigo-600',
};

const BORDER: Record<string, string> = {
  gray: 'border-slate-400',
  blue: 'border-blue-500',
  green: 'border-emerald-500',
  yellow: 'border-amber-500',
  orange: 'border-orange-500',
  red: 'border-rose-500',
  purple: 'border-violet-500',
  pink: 'border-pink-500',
  teal: 'border-teal-500',
  indigo: 'border-indigo-500',
};

export const HEX: Record<string, string> = {
  gray: '#64748b',
  blue: '#3b82f6',
  green: '#10b981',
  yellow: '#f59e0b',
  orange: '#f97316',
  red: '#f43f5e',
  purple: '#8b5cf6',
  pink: '#ec4899',
  teal: '#14b8a6',
  indigo: '#6366f1',
};

export const SERIES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#14b8a6', '#ec4899', '#f97316', '#64748b'];

export const badgeClass = (c?: string | null) => pick(BADGE, c);
export const tileClass = (c?: string | null) => pick(TILE, c);
export const softTileClass = (c?: string | null) => pick(SOFT_TILE, c);
export const borderClass = (c?: string | null) => pick(BORDER, c);
export const hex = (c?: string | null) => HEX[c ?? 'gray'] ?? HEX.gray!;
