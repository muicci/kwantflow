import {
	debug as pluginDebug,
	error as pluginError,
	info as pluginInfo,
	trace as pluginTrace,
	warn as pluginWarn
} from '@tauri-apps/plugin-log';
import { isTauri } from '../utils/env.js';

type LoggerLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
type ConsoleMethod = (...data: unknown[]) => void;

type Logger = {
	trace: (message: string, details?: unknown) => void;
	debug: (message: string, details?: unknown) => void;
	info: (message: string, details?: unknown) => void;
	warn: (message: string, details?: unknown) => void;
	error: (message: string, details?: unknown) => void;
};

const pluginLoggers: Record<LoggerLevel, (message: string) => Promise<void> | void> = {
	trace: pluginTrace,
	debug: pluginDebug,
	info: pluginInfo,
	warn: pluginWarn,
	error: pluginError
};

const consoleMethods: Record<LoggerLevel, ConsoleMethod> = {
	trace: console.log.bind(console),
	debug: console.debug.bind(console),
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console)
};

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|cookie|api[_-]?key|session/i;
const SENSITIVE_STRING_PATTERNS: ReadonlyArray<[RegExp, string]> = [
	[/(Bearer\s+)[A-Za-z0-9._-]+/gi, `$1${REDACTED_VALUE}`],
	[/(apikey=)[^&\s]+/gi, `$1${REDACTED_VALUE}`],
	[/(token=)[^&\s]+/gi, `$1${REDACTED_VALUE}`],
	[
		/("(?:access_token|refresh_token|id_token|client_secret|password|secret)"\s*:\s*")[^"]*(")/gi,
		`$1${REDACTED_VALUE}$2`
	],
	[/((?:access_token|refresh_token|id_token)=)[^&\s]+/gi, `$1${REDACTED_VALUE}`]
];

let benignBrowserWarningDetach: (() => void) | null = null;
let benignConsoleWarnRestore: (() => void) | null = null;
let benignConsoleErrorRestore: (() => void) | null = null;

const BENIGN_BROWSER_ERROR_MESSAGES = new Set([
	'ResizeObserver loop completed with undelivered notifications.'
]);
const BENIGN_CONSOLE_WARNINGS = [
	'Warning: Indexing all PDF objects',
	'IPC custom protocol failed, Tauri will now use the postMessage interface instead'
];
const BENIGN_CONSOLE_ERRORS = [
	'Fetch API cannot load ipc://localhost/',
	'due to access control checks.'
];

function normalizeMessage(scope: string, message: string): string {
	const duplicateScopePrefix = `[${scope}] `;
	const stripped = message.startsWith(duplicateScopePrefix)
		? message.slice(duplicateScopePrefix.length)
		: message;
	return redactString(stripped);
}

function redactString(value: string): string {
	return SENSITIVE_STRING_PATTERNS.reduce(
		(currentValue, [pattern, replacement]) => currentValue.replace(pattern, replacement),
		value
	);
}

function normalizeDetails(details: unknown, seen = new WeakSet<object>()): unknown {
	if (details instanceof Error) {
		return {
			name: details.name,
			message: redactString(details.message),
			stack: details.stack ? redactString(details.stack) : undefined
		};
	}

	if (typeof details === 'bigint') {
		return details.toString();
	}

	if (typeof details === 'string') {
		return redactString(details);
	}

	if (Array.isArray(details)) {
		return details.map((entry) => normalizeDetails(entry, seen));
	}

	if (details && typeof details === 'object') {
		if (seen.has(details)) {
			return '[Circular]';
		}

		seen.add(details);
		return Object.fromEntries(
			Object.entries(details).map(([key, value]) => [
				key,
				SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_VALUE : normalizeDetails(value, seen)
			])
		);
	}

	return details;
}

function serializeDetails(details: unknown): string {
	if (typeof details === 'string') return redactString(details);

	try {
		return JSON.stringify(normalizeDetails(details));
	} catch {
		return String(details);
	}
}

function formatMessage(scope: string, message: string, details?: unknown): string {
	const normalizedMessage = normalizeMessage(scope, message);

	if (details === undefined) {
		return `[${scope}] ${normalizedMessage}`;
	}

	return `[${scope}] ${normalizedMessage} ${serializeDetails(details)}`;
}

function logToConsole(level: LoggerLevel, scope: string, message: string, details?: unknown): void {
	const consoleMethod = consoleMethods[level];
	const formattedMessage = `[${scope}] ${normalizeMessage(scope, message)}`;

	if (details === undefined) {
		consoleMethod(formattedMessage);
		return;
	}

	consoleMethod(formattedMessage, normalizeDetails(details));
}

function writeLog(level: LoggerLevel, scope: string, message: string, details?: unknown): void {
	if (!isTauri()) {
		logToConsole(level, scope, message, details);
		return;
	}

	let writeResult: Promise<void> | void;
	try {
		writeResult = pluginLoggers[level](formatMessage(scope, message, details));
	} catch (error) {
		consoleMethods.error('[logger] Failed to write to the Tauri log plugin.', {
			scope,
			message,
			error: normalizeDetails(error)
		});
		logToConsole(level, scope, message, details);
		return;
	}

	void Promise.resolve(writeResult).catch((error) => {
		consoleMethods.error('[logger] Failed to write to the Tauri log plugin.', {
			scope,
			message,
			error: normalizeDetails(error)
		});
		logToConsole(level, scope, message, details);
	});
}

export function createLogger(scope: string): Logger {
	return {
		trace: (message: string, details?: unknown) => writeLog('trace', scope, message, details),
		debug: (message: string, details?: unknown) => writeLog('debug', scope, message, details),
		info: (message: string, details?: unknown) => writeLog('info', scope, message, details),
		warn: (message: string, details?: unknown) => writeLog('warn', scope, message, details),
		error: (message: string, details?: unknown) => writeLog('error', scope, message, details)
	};
}

export function installBenignBrowserWarningFilter(): () => void {
	if (typeof window === 'undefined') {
		return () => {};
	}

	if (benignBrowserWarningDetach) {
		return benignBrowserWarningDetach;
	}

	const handleWindowError = (event: ErrorEvent) => {
		if (!BENIGN_BROWSER_ERROR_MESSAGES.has(event.message)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};

	window.addEventListener('error', handleWindowError, { capture: true });
	if (!benignConsoleWarnRestore) {
		const originalWarn = console.warn.bind(console);
		console.warn = ((...args: unknown[]) => {
			const firstArg = args[0];
			if (
				typeof firstArg === 'string' &&
				BENIGN_CONSOLE_WARNINGS.some((warning) => firstArg.includes(warning))
			) {
				return;
			}

			originalWarn(...args);
		}) as ConsoleMethod;
		benignConsoleWarnRestore = () => {
			console.warn = originalWarn;
			benignConsoleWarnRestore = null;
		};
	}
	if (!benignConsoleErrorRestore) {
		const originalError = console.error.bind(console);
		console.error = ((...args: unknown[]) => {
			const firstArg = args[0];
			if (
				typeof firstArg === 'string' &&
				BENIGN_CONSOLE_ERRORS.every((fragment) => firstArg.includes(fragment))
			) {
				return;
			}

			originalError(...args);
		}) as ConsoleMethod;
		benignConsoleErrorRestore = () => {
			console.error = originalError;
			benignConsoleErrorRestore = null;
		};
	}
	benignBrowserWarningDetach = () => {
		window.removeEventListener('error', handleWindowError, { capture: true });
		benignConsoleWarnRestore?.();
		benignConsoleErrorRestore?.();
		benignBrowserWarningDetach = null;
	};

	return benignBrowserWarningDetach;
}

export function resetLoggerForTests(): void {
	benignBrowserWarningDetach?.();
	benignBrowserWarningDetach = null;
	benignConsoleWarnRestore?.();
	benignConsoleWarnRestore = null;
	benignConsoleErrorRestore?.();
	benignConsoleErrorRestore = null;
}
