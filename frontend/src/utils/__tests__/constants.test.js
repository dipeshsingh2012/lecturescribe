import { describe, it, expect } from 'vitest';
import { API_BASE } from '../constants';

describe('constants API_BASE configuration', () => {
  it('does not contain hardcoded production domain fallbacks and strips trailing slashes', () => {
    expect(API_BASE).not.toContain('a.run.app');
    expect(API_BASE.endsWith('/')).toBe(false);
  });
});

