import { describe, expect, it } from 'vitest';
import { DICT, translate } from './i18n';

describe('i18n', () => {
  it('substitutes placeholders and falls back to English, then to the key', () => {
    expect(translate('en', 'clear.done', { n: 3 })).toBe('3 task(s) cleared');
    expect(translate('vi', 'clear.done', { n: 3 })).toBe('Đã xóa 3 task');
    expect(translate('vi', 'no.such.key')).toBe('no.such.key');
  });

  it('has a Vietnamese string for every English key (no silent fallbacks)', () => {
    const missing = Object.keys(DICT.en).filter((k) => !(k in DICT.vi));
    expect(missing).toEqual([]);
  });

  it('keeps the same placeholders in both languages', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.keys(DICT.en).filter(
      (k) => DICT.vi[k] !== undefined && holes(DICT.en[k]!).join() !== holes(DICT.vi[k]!).join(),
    );
    expect(mismatched).toEqual([]);
  });
});
