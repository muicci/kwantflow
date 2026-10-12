import type { HandleClientError } from '@sveltejs/kit';
import { createLogger } from '$lib/services/logger.js';

// Polyfill crypto.randomUUID for non-secure contexts (e.g., custom schemes like tauri://)
if (
	typeof window !== 'undefined' &&
	typeof window.crypto !== 'undefined' &&
	!window.crypto.randomUUID
) {
	Object.defineProperty(window.crypto, 'randomUUID', {
		value: function () {
			return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
				const r = (Math.random() * 16) | 0;
				const v = c === 'x' ? r : (r & 0x3) | 0x8;
				return v.toString(16);
			});
		},
		writable: true,
		configurable: true,
		enumerable: true
	});
}

const log = createLogger('client');

export const handleError: HandleClientError = ({ message, status }) => {
	log.error('Unhandled client error', { message, status });
	return { message };
};

if (typeof window !== 'undefined') {
	window.addEventListener('kwantflow:scroll-lock-healed', (event) => {
		if (event instanceof CustomEvent) {
			log.debug('UI scroll lock self-healed', event.detail);
		}
	});
}
