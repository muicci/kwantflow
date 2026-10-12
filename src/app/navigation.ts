import { vi } from 'vitest';

export const goto = vi.fn(() => Promise.resolve(true));
export const invalidate = vi.fn(() => Promise.resolve(true));
export const invalidateAll = vi.fn(() => Promise.resolve(true));
export const beforeNavigate = vi.fn();
export const afterNavigate = vi.fn();
export const preloadCode = vi.fn(() => Promise.resolve());
export const preloadData = vi.fn(() => Promise.resolve());
