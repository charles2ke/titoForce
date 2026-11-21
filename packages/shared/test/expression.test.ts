import { describe, expect, it } from 'vitest';
import { evaluateExpression, ExpressionError, expressionIdentifiers, renderTemplate } from '../src/expression.ts';

const now = new Date('2026-03-15T10:30:00.000Z');
const ev = (src: string, ctx: Record<string, unknown> = {}) => evaluateExpression(src, ctx, { now });

describe('expression engine', () => {
  it('evaluates arithmetic with precedence and treats blanks as zero', () => {
    expect(ev('ROUND(quantity * unit_price * (1 - discount / 100), 2)', { quantity: 3, unit_price: 19.99, discount: 10 })).toBe(53.97);
    expect(ev('amount * probability / 100', { amount: 1000 })).toBe(0);
    expect(ev('10 / 0')).toBeNull();
  });

  it('supports CASE, IF, ternaries and logical operators', () => {
    expect(ev("CASE(stage, 'Closed Won', 100, 'Closed Lost', 0, 50)", { stage: 'Closed Won' })).toBe(100);
    expect(ev("CASE(stage, 'Closed Won', 100, 50)", { stage: 'Proposal' })).toBe(50);
    expect(ev("IF(score >= 70 && status != 'Converted', 'Hot', 'Cold')", { score: 80, status: 'New' })).toBe('Hot');
    expect(ev("priority == 'Urgent' ? 4 : 24", { priority: 'Low' })).toBe(24);
    expect(ev('!ISBLANK(email) || OR(false, true)', { email: '' })).toBe(true);
  });

  it('handles dates relative to an injected clock', () => {
    expect(ev('TODAY()')).toBe('2026-03-15');
    expect(ev('ADD_DAYS(TODAY(), 20)')).toBe('2026-04-04');
    expect(ev('ADD_HOURS(NOW(), 4)')).toBe('2026-03-15T14:30:00.000Z');
    expect(ev('DAYS_BETWEEN(start_date, end_date) + 1', { start_date: '2026-03-02', end_date: '2026-03-06' })).toBe(5);
    expect(ev('YEAR(d) * 100 + MONTH(d)', { d: '2025-12-31' })).toBe(202512);
  });

  it('concatenates strings and resolves dotted paths', () => {
    expect(ev("record.first_name + ' ' + UPPER(record.last_name)", { record: { first_name: 'Ada', last_name: 'Lovelace' } })).toBe('Ada LOVELACE');
    expect(ev('related.pto_balance - record.days', { related: { pto_balance: 15 }, record: { days: 3 } })).toBe(12);
  });

  it('blocks prototype access and unknown functions', () => {
    expect(() => ev('constructor.constructor')).toThrow(ExpressionError);
    expect(() => ev('a.__proto__')).toThrow(ExpressionError);
    expect(() => ev('EVAL(1)')).toThrow(/Unknown function/);
    expect(ev('toString', {})).toBeNull();
    expect(() => ev('1 +')).toThrow(ExpressionError);
  });

  it('lists identifiers referenced by an expression', () => {
    expect(expressionIdentifiers('IF(a > b.c, d, 1)').sort()).toEqual(['a', 'b.c', 'd']);
  });

  it('renders templates, preserving types for single placeholders', () => {
    const ctx = { record: { name: 'Acme', amount: 5000 } };
    expect(renderTemplate('Follow up with {{record.name}} ({{record.amount}})', ctx)).toBe('Follow up with Acme (5000)');
    expect(renderTemplate('{{record.amount * 2}}', ctx)).toBe(10000);
    expect(renderTemplate(42, ctx)).toBe(42);
    expect(renderTemplate('{{ADD_DAYS(TODAY(), 1)}}', ctx, { now })).toBe('2026-03-16');
  });
});
