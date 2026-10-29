// T-38: клавиши вкладок (WAI-ARIA tabs; прототип initTabs, design/prototype.html:4521-4530).
import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './tabs';

describe('nextTabIndex', () => {
  it('→ и ← ходят по кругу', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('Home и End ведут к первой и последней вкладке', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
  });

  it('чужие клавиши, пустой список и неизвестная вкладка дают null', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowDown', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
    expect(nextTabIndex('ArrowRight', -1, 3)).toBeNull();
  });

  it('единственная вкладка остаётся на месте', () => {
    expect(nextTabIndex('ArrowRight', 0, 1)).toBe(0);
    expect(nextTabIndex('End', 0, 1)).toBe(0);
  });
});
