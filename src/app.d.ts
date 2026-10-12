declare global {
	const __KWANTFLOW_APP_VERSION__: string;

	interface Window {
		/** Tauri webview preload IPC bridge, added at runtime by the Tauri shell. */
		__TAURI_INTERNALS__?: {
			invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
		};
	}
}

export {};
