export const isTauri = () => {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export const getRuntimePlatformLabel = () => {
	if (typeof navigator === 'undefined') return '';

	const platformNavigator = navigator as Navigator & {
		userAgentData?: { platform?: string };
	};

	return (
		platformNavigator.userAgentData?.platform ??
		platformNavigator.platform ??
		platformNavigator.userAgent ??
		''
	);
};

export const isMacOsDesktopRuntime = () => {
	return /\bmac/i.test(getRuntimePlatformLabel());
};

export const isDevelopmentRuntime = () => {
	return import.meta.env.DEV;
};

export const hasInternetConnection = () => {
	if (typeof navigator === 'undefined') return true;
	return navigator.onLine !== false;
};

export const requireInternetConnection = (message: string) => {
	if (!hasInternetConnection()) {
		throw new Error(message);
	}
};

export const generateUUID = (): string => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Fallback RFC 4122 v4 UUID generator using Math.random for non-secure contexts (e.g. production tauri://)
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
};
