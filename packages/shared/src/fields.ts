import type { FieldDef } from './types.ts';

/** Display format of numeric fields. Roll-ups and formulas use `formulaType` as their display hint. */
export function numberFormat(f: FieldDef): 'currency' | 'percent' | 'number' | null {
  if (f.type === 'currency') return 'currency';
  if (f.type === 'percent') return 'percent';
  if (f.type === 'number') return 'number';
  if (f.type === 'formula' || f.type === 'rollup') {
    if (f.formulaType === 'currency' || f.formulaType === 'percent') return f.formulaType;
    if (f.type === 'rollup' || f.formulaType === 'number') return 'number';
  }
  return null;
}
