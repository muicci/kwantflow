import { getCurrentWindow } from '@tauri-apps/api/window';

import { isMacOsDesktopRuntime, isTauri } from '$lib/utils/env.js';

const NON_DRAG_TARGET_SELECTOR = [
	'button',
	'a',
	'input',
	'textarea',
	'select',
	'summary',
	'label',
	'[role="button"]',
	'[role="tab"]',
	'[role="link"]',
	'[role="menuitem"]',
	'[role="option"]',
	'[role="switch"]',
	'[role="checkbox"]',
	'[contenteditable="true"]',
	'[data-no-window-drag]'
].join(', ');

const getTargetElement = (target: EventTarget | null) => {
	if (!(target instanceof Node)) return null;
	if (target instanceof Element) return target;
	return target.parentElement;
};

export const shouldIgnoreNativeWindowDragTarget = (target: EventTarget | null) => {
	const targetElement = getTargetElement(target);
	if (!targetElement) return false;
	return targetElement.closest(NON_DRAG_TARGET_SELECTOR) !== null;
};

export const startNativeWindowDrag = async (event: MouseEvent) => {
	if (!isTauri() || !isMacOsDesktopRuntime()) return;
	if (event.button !== 0 || event.defaultPrevented) return;
	if (shouldIgnoreNativeWindowDragTarget(event.target)) return;

	await getCurrentWindow().startDragging();
};
