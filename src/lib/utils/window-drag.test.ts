import { describe, expect, it } from 'vitest';

import { shouldIgnoreNativeWindowDragTarget } from './window-drag.js';

describe('native window drag helper', () => {
	it('treats interactive controls as non-draggable', () => {
		const button = document.createElement('button');
		const icon = document.createElement('span');
		button.append(icon);
		const tab = document.createElement('div');
		tab.setAttribute('role', 'tab');
		const tabLabel = document.createElement('span');
		tab.append(tabLabel);

		expect(shouldIgnoreNativeWindowDragTarget(button)).toBe(true);
		expect(shouldIgnoreNativeWindowDragTarget(icon)).toBe(true);
		expect(shouldIgnoreNativeWindowDragTarget(tab)).toBe(true);
		expect(shouldIgnoreNativeWindowDragTarget(tabLabel)).toBe(true);
	});

	it('respects explicit no-drag markers on ancestor containers', () => {
		const container = document.createElement('div');
		container.setAttribute('data-no-window-drag', 'true');
		const child = document.createElement('span');
		container.append(child);

		expect(shouldIgnoreNativeWindowDragTarget(child)).toBe(true);
	});

	it('allows plain non-interactive title content to drag', () => {
		const label = document.createElement('span');

		expect(shouldIgnoreNativeWindowDragTarget(label)).toBe(false);
		expect(shouldIgnoreNativeWindowDragTarget(null)).toBe(false);
	});
});
