import { describe, expect, it } from 'vitest';
import { ParseBudgetError, ParseWorkBudget } from '../src/local/parse-budget';
import {parseLocal} from '../src/local/parser';

describe('deterministic parse budgets', () => {
  it('resolves deep-looking HTML and quoted code before rejecting depth',()=>{
    for(const source of [
      '<!--\n'+'> '.repeat(30)+'inert\n-->\n\nText',
      '> ```\n> '+'> '.repeat(30)+'inert\n> ```\n\nText',
      '```\n'+'> '.repeat(30)+'inert\n```\n\nText',
    ])expect(parseLocal(source,{limits:{maxMarkdownDepth:1}}).diagnostics).toEqual([]);
    expect(parseLocal('- '.repeat(4)+'Text',{limits:{maxMarkdownDepth:3}}).diagnostics)
      .toContainEqual(expect.objectContaining({code:'local.budget',messageKey:'local.budget.markdown-depth'}));
  });
  it('accepts work equal to the limit and rejects the next unit', () => {
    const budget = new ParseWorkBudget({ maxParseWork: 10, maxMarkdownDepth: 10 });
    budget.charge(10, 4, 9);
    expect(budget.parseWork).toBe(10);
    let failure: unknown;
    try {
      budget.charge(1, 4, 9);
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(ParseBudgetError);
    expect((failure as ParseBudgetError).kind).toBe('parse-work');
    expect((failure as ParseBudgetError).limit).toBe(10);
    expect((failure as ParseBudgetError).start).toBe(4);
  });

  it('accepts depth equal to the limit and rejects deeper nesting', () => {
    const budget = new ParseWorkBudget({ maxParseWork: 100, maxMarkdownDepth: 2 });
    budget.observeDepth(1, 0, 4);
    budget.observeDepth(2, 0, 4);
    expect(budget.maxDepth).toBe(2);
    expect(() => budget.observeDepth(3, 0, 4)).toThrowError(ParseBudgetError);
    expect(() => new ParseWorkBudget({ maxParseWork: 100, maxMarkdownDepth: 2 }).observeDepth(3, 0, 4))
      .toThrowError(/2-level/);
  });

  it('ignores non-positive work so an empty source never charges', () => {
    const budget = new ParseWorkBudget({ maxParseWork: 1, maxMarkdownDepth: 1 });
    budget.charge(0, 0, 0);
    budget.charge(-5, 0, 0);
    expect(budget.parseWork).toBe(0);
    expect(() => budget.charge(2, 0, 1)).toThrowError(ParseBudgetError);
  });
});
