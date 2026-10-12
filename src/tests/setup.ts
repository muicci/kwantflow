import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: async (command: string, args?: { input?: Record<string, unknown> }) => {
		const { invokeTypedRustCommandForTests } = await import('./typed-rust-command-shim');
		return await invokeTypedRustCommandForTests(command, args?.input ?? {});
	}
}));

vi.mock('@tauri-apps/plugin-log', () => ({
	info: (..._args: unknown[]) => {},
	warn: (..._args: unknown[]) => {},
	error: (..._args: unknown[]) => {},
	debug: (..._args: unknown[]) => {},
	trace: (..._args: unknown[]) => {},
	log: (..._args: unknown[]) => {},
	attachConsole: () => {},
	attachLogger: () => {}
}));

// Safety net: even if the vi.mock doesn't intercept nested imports,
// accessing window.__TAURI_INTERNALS__ won't crash.
Object.defineProperty(globalThis, '__TAURI_INTERNALS__', {
	value: { invoke: async () => {} },
	configurable: true,
	writable: true
});

Object.defineProperty(globalThis, '__KWANTFLOW_APP_VERSION__', {
	value: '0.1.0',
	configurable: true,
	writable: false
});

// Vitest runs in Node.js where Worker is not globally available.
// Provide a minimal stub so @tauri-apps/plugin-fs and other Tauri plugins
// that reference Worker don't crash with 'Worker is not defined'.
if (typeof globalThis.Worker === 'undefined') {
	// @ts-ignore
	globalThis.Worker = class Worker {
		constructor() {}
		postMessage() {}
		terminate() {}
		addEventListener() {}
		removeEventListener() {}
	} as unknown as typeof globalThis.Worker;
}

if (typeof HTMLCanvasElement !== 'undefined') {
	HTMLCanvasElement.prototype.getContext = vi.fn(
		() => null
	) as unknown as HTMLCanvasElement['getContext'];
	HTMLCanvasElement.prototype.toDataURL = vi.fn(
		() => 'data:image/png;base64,'
	) as unknown as HTMLCanvasElement['toDataURL'];
}

if (typeof window !== 'undefined') {
	window.open = vi.fn(() => null) as unknown as typeof window.open;
}
