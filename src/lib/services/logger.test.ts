import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = {
	isTauri: vi.fn()
};

const pluginTraceMock = vi.fn();
const pluginDebugMock = vi.fn();
const pluginInfoMock = vi.fn();
const pluginWarnMock = vi.fn();
const pluginErrorMock = vi.fn();
const attachConsoleMock = vi.fn();

const consoleLogMock = vi.spyOn(console, 'log').mockImplementation(() => {});
const consoleDebugMock = vi.spyOn(console, 'debug').mockImplementation(() => {});
const consoleInfoMock = vi.spyOn(console, 'info').mockImplementation(() => {});
const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../utils/env', () => ({
	isTauri: envMock.isTauri
}));

vi.mock('@tauri-apps/plugin-log', () => ({
	attachConsole: attachConsoleMock,
	trace: pluginTraceMock,
	debug: pluginDebugMock,
	info: pluginInfoMock,
	warn: pluginWarnMock,
	error: pluginErrorMock
}));

describe('logger service', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		envMock.isTauri.mockReturnValue(false);
		pluginTraceMock.mockResolvedValue(undefined);
		pluginDebugMock.mockResolvedValue(undefined);
		pluginInfoMock.mockResolvedValue(undefined);
		pluginWarnMock.mockResolvedValue(undefined);
		pluginErrorMock.mockResolvedValue(undefined);
	});

	afterEach(async () => {
		const loggerModule = await import('./logger');
		loggerModule.resetLoggerForTests();
	});

	afterEach(() => {
		consoleLogMock.mockClear();
		consoleDebugMock.mockClear();
		consoleInfoMock.mockClear();
		consoleWarnMock.mockClear();
		consoleErrorMock.mockClear();
	});

	afterAll(() => {
		consoleLogMock.mockRestore();
		consoleDebugMock.mockRestore();
		consoleInfoMock.mockRestore();
		consoleWarnMock.mockRestore();
		consoleErrorMock.mockRestore();
	});

	it('prefixes scoped frontend logs and falls back to console outside Tauri', async () => {
		const { createLogger } = await import('./logger');
		const logger = createLogger('storeService');

		logger.warn('Store unavailable');

		expect(consoleWarnMock).toHaveBeenCalledWith('[storeService] Store unavailable');
		expect(pluginWarnMock).not.toHaveBeenCalled();
	});

	it('normalises and redacts console fallback details outside Tauri', async () => {
		const { createLogger } = await import('./logger');
		const logger = createLogger('support');

		logger.error('Submission failed', {
			authorization: 'Bearer super-secret-token',
			nested: {
				sessionToken: 'another-secret'
			}
		});

		expect(consoleErrorMock).toHaveBeenCalledWith('[support] Submission failed', {
			authorization: '[REDACTED]',
			nested: {
				sessionToken: '[REDACTED]'
			}
		});
	});

	it('serialises details into plugin log messages inside Tauri', async () => {
		envMock.isTauri.mockReturnValue(true);

		const { createLogger } = await import('./logger');
		const logger = createLogger('dbService');

		logger.error('Database init failed', {
			stage: 'open',
			attempt: 2
		});

		expect(pluginErrorMock).toHaveBeenCalledTimes(1);
		expect(pluginErrorMock.mock.calls[0]?.[0]).toContain('[dbService] Database init failed');
		expect(pluginErrorMock.mock.calls[0]?.[0]).toContain('"stage":"open"');
		expect(pluginErrorMock.mock.calls[0]?.[0]).toContain('"attempt":2');
		expect(consoleErrorMock).not.toHaveBeenCalled();
	});

	it('redacts sensitive details before writing to the plugin sink', async () => {
		envMock.isTauri.mockReturnValue(true);

		const { createLogger } = await import('./logger');
		const logger = createLogger('support');

		logger.warn('Submitting support report', {
			authorization: 'Bearer super-secret-token',
			apiKey: 'abc123',
			nested: {
				sessionToken: 'another-secret'
			}
		});

		expect(pluginWarnMock).toHaveBeenCalledTimes(1);
		expect(pluginWarnMock.mock.calls[0]?.[0]).toContain('"authorization":"[REDACTED]"');
		expect(pluginWarnMock.mock.calls[0]?.[0]).toContain('"apiKey":"[REDACTED]"');
		expect(pluginWarnMock.mock.calls[0]?.[0]).toContain('"sessionToken":"[REDACTED]"');
	});

	it('tolerates non-promise plugin logger implementations', async () => {
		envMock.isTauri.mockReturnValue(true);
		pluginInfoMock.mockImplementationOnce(() => undefined);

		const { createLogger } = await import('./logger');
		const logger = createLogger('appState');

		expect(() => logger.info('Boot sequence started')).not.toThrow();
		expect(pluginInfoMock).toHaveBeenCalledWith('[appState] Boot sequence started');
	});

	it('suppresses the known benign ResizeObserver browser error once per window', async () => {
		const addEventListenerMock = vi.spyOn(window, 'addEventListener');
		const removeEventListenerMock = vi.spyOn(window, 'removeEventListener');
		const preventDefault = vi.fn();
		const stopImmediatePropagation = vi.fn();

		const { installBenignBrowserWarningFilter, resetLoggerForTests } = await import('./logger');
		const detach = installBenignBrowserWarningFilter();
		const secondDetach = installBenignBrowserWarningFilter();

		expect(addEventListenerMock).toHaveBeenCalledTimes(1);
		expect(addEventListenerMock).toHaveBeenCalledWith('error', expect.any(Function), {
			capture: true
		});
		expect(secondDetach).toBe(detach);

		const handler = addEventListenerMock.mock.calls[0]?.[1] as EventListener;
		handler({
			message: 'ResizeObserver loop completed with undelivered notifications.',
			preventDefault,
			stopImmediatePropagation
		} as unknown as ErrorEvent);

		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
		console.warn('Warning: Indexing all PDF objects');
		console.warn(
			'IPC custom protocol failed, Tauri will now use the postMessage interface instead'
		);
		console.warn('Another warning');
		expect(consoleWarnMock).toHaveBeenCalledTimes(1);
		expect(consoleWarnMock).toHaveBeenCalledWith('Another warning');
		console.error(
			'Fetch API cannot load ipc://localhost/plugin%3Alog%7Clog due to access control checks.'
		);
		console.error('Another error');
		expect(consoleErrorMock).toHaveBeenCalledTimes(1);
		expect(consoleErrorMock).toHaveBeenCalledWith('Another error');

		detach();
		expect(removeEventListenerMock).toHaveBeenCalledTimes(1);
		expect(removeEventListenerMock).toHaveBeenCalledWith('error', expect.any(Function), {
			capture: true
		});

		addEventListenerMock.mockRestore();
		removeEventListenerMock.mockRestore();
		resetLoggerForTests();
	});

	it('strips an exact duplicate scope prefix from the message body', async () => {
		const { createLogger } = await import('./logger');
		const logger = createLogger('dbService');

		logger.info('[dbService] Database initialized with Kysely.');

		expect(consoleInfoMock).toHaveBeenCalledWith('[dbService] Database initialized with Kysely.');
	});

	it('redacts tokens embedded in the message string itself', async () => {
		const { createLogger } = await import('./logger.js');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		createLogger('scope').warn('refresh failed for Bearer abc.def-123 and {"access_token":"xyz"}');
		const output = String(warn.mock.calls.at(-1)?.[0] ?? '');
		expect(output).not.toContain('abc.def-123');
		expect(output).not.toContain('"xyz"');
		warn.mockRestore();
	});
});
