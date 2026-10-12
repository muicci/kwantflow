import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	isTauri,
	getRuntimePlatformLabel,
	isMacOsDesktopRuntime,
	isDevelopmentRuntime,
	hasInternetConnection,
	requireInternetConnection
} from './env.js';

describe('env utils', () => {
	const originalWindow = global.window;
	const originalNavigator = global.navigator;

	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		global.window = originalWindow;
		global.navigator = originalNavigator;
	});

	describe('isTauri', () => {
		it('should return false when window is undefined', () => {
			vi.stubGlobal('window', undefined);
			expect(isTauri()).toBe(false);
		});

		it('should return false when window is defined but __TAURI_INTERNALS__ is not present', () => {
			vi.stubGlobal('window', {});
			expect(isTauri()).toBe(false);
		});

		it('should return true when window is defined and __TAURI_INTERNALS__ is present', () => {
			vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
			expect(isTauri()).toBe(true);
		});
	});

	describe('getRuntimePlatformLabel', () => {
		it('should return an empty string when navigator is undefined', () => {
			vi.stubGlobal('navigator', undefined);
			expect(getRuntimePlatformLabel()).toBe('');
		});

		it('should return platform from navigator.userAgentData.platform', () => {
			vi.stubGlobal('navigator', {
				userAgentData: { platform: 'macOS' },
				platform: 'MacIntel',
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
			});
			expect(getRuntimePlatformLabel()).toBe('macOS');
		});

		it('should fallback to navigator.platform when userAgentData is missing', () => {
			vi.stubGlobal('navigator', {
				platform: 'MacIntel',
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
			});
			expect(getRuntimePlatformLabel()).toBe('MacIntel');
		});

		it('should fallback to navigator.userAgent when both userAgentData and platform are missing', () => {
			vi.stubGlobal('navigator', {
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
			});
			expect(getRuntimePlatformLabel()).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
		});

		it('should return an empty string if no valid properties are found on navigator', () => {
			vi.stubGlobal('navigator', {});
			expect(getRuntimePlatformLabel()).toBe('');
		});
	});

	describe('isMacOsDesktopRuntime', () => {
		it('should return true for "macOS"', () => {
			vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' } });
			expect(isMacOsDesktopRuntime()).toBe(true);
		});

		it('should return true for "MacIntel"', () => {
			vi.stubGlobal('navigator', { platform: 'MacIntel' });
			expect(isMacOsDesktopRuntime()).toBe(true);
		});

		it('should return true for "Macintosh"', () => {
			vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
			expect(isMacOsDesktopRuntime()).toBe(true);
		});

		it('should return false for "Windows"', () => {
			vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' } });
			expect(isMacOsDesktopRuntime()).toBe(false);
		});

		it('should return false for "Linux"', () => {
			vi.stubGlobal('navigator', { platform: 'Linux x86_64' });
			expect(isMacOsDesktopRuntime()).toBe(false);
		});
	});

	describe('isDevelopmentRuntime', () => {
		it('should return true or false depending on import.meta.env.DEV', () => {
			// Vitest sets import.meta.env.DEV to true in tests
			expect(isDevelopmentRuntime()).toBe(true);
		});
	});

	describe('hasInternetConnection', () => {
		it('should return true when navigator is undefined', () => {
			vi.stubGlobal('navigator', undefined);
			expect(hasInternetConnection()).toBe(true);
		});

		it('should return true when navigator.onLine is true', () => {
			vi.stubGlobal('navigator', { onLine: true });
			expect(hasInternetConnection()).toBe(true);
		});

		it('should return false when navigator.onLine is false', () => {
			vi.stubGlobal('navigator', { onLine: false });
			expect(hasInternetConnection()).toBe(false);
		});
	});

	describe('requireInternetConnection', () => {
		it('should not throw when there is an internet connection', () => {
			vi.stubGlobal('navigator', { onLine: true });
			expect(() => requireInternetConnection('Connection required')).not.toThrow();
		});

		it('should throw the provided message when there is no internet connection', () => {
			vi.stubGlobal('navigator', { onLine: false });
			expect(() => requireInternetConnection('Connection required')).toThrow('Connection required');
		});
	});
});
