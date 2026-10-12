export type RecoverableProjectRoute = {
	projectId: string;
	detachedPreview: boolean;
};

const TAURI_RUNTIME_READY_TIMEOUT_MS = 1_200;
const TAURI_RUNTIME_READY_POLL_MS = 50;
const PROJECT_ROUTE_RECOVERY_ATTEMPTS = 6;
const PROJECT_ROUTE_RECOVERY_INTERVAL_MS = 120;

const PROJECT_ROUTE_PATTERN =
	/^\/project\/(?<projectId>[^/]+)(?:\/asset\/[^/]+(?<preview>\/preview)?)?(?:\/(?:wbs|quote|quote\/pdf))?\/?$/;
const DETACHED_PREVIEW_ROUTE_PATTERN = /^\/preview\/asset\/(?<projectId>[^/]+)\/[^/]+\/?$/;

export function resolveRecoverableProjectRoute(
	pathname: string,
	status: number
): RecoverableProjectRoute | null {
	if (status !== 404) return null;

	const match = PROJECT_ROUTE_PATTERN.exec(pathname);
	const projectId = match?.groups?.projectId;
	if (projectId) {
		return {
			projectId,
			detachedPreview: match?.groups?.preview === '/preview'
		};
	}

	const detachedPreviewMatch = DETACHED_PREVIEW_ROUTE_PATTERN.exec(pathname);
	const detachedPreviewProjectId = detachedPreviewMatch?.groups?.projectId;
	if (!detachedPreviewProjectId) return null;

	return {
		projectId: detachedPreviewProjectId,
		detachedPreview: true
	};
}

const isTauriRuntimeAttached = () =>
	typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function waitForTauriRuntimeReady(
	timeoutMs = TAURI_RUNTIME_READY_TIMEOUT_MS
): Promise<boolean> {
	if (typeof window === 'undefined') return false;
	if (isTauriRuntimeAttached()) return true;

	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		await new Promise((resolve) => setTimeout(resolve, TAURI_RUNTIME_READY_POLL_MS));
		if (isTauriRuntimeAttached()) return true;
	}

	return isTauriRuntimeAttached();
}

export async function loadProjectRouteWithRecovery<T>(loader: () => Promise<T>): Promise<T> {
	try {
		return await loader();
	} catch (initialError) {
		if (typeof window === 'undefined') throw initialError;

		if (!isTauriRuntimeAttached()) {
			await waitForTauriRuntimeReady();
		}

		let lastError = initialError;
		for (let attempt = 0; attempt < PROJECT_ROUTE_RECOVERY_ATTEMPTS; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, PROJECT_ROUTE_RECOVERY_INTERVAL_MS));
			try {
				return await loader();
			} catch (retryError) {
				lastError = retryError;
			}
		}

		throw lastError;
	}
}
