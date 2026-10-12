import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMessageMock = vi.fn();
const mockCreateOC = vi.fn();

vi.mock('occt-import-js', () => ({
	default: (...args: unknown[]) => mockCreateOC(...args)
}));

vi.mock('occt-import-js/dist/occt-import-js.wasm?url', () => ({
	default: 'mock-occt-import.wasm'
}));

describe('OCCT import worker', () => {
	beforeEach(() => {
		vi.resetModules();
		postMessageMock.mockReset();
		mockCreateOC.mockReset();
		Object.defineProperty(globalThis, 'self', {
			configurable: true,
			value: { onmessage: null, postMessage: postMessageMock }
		});
	});

	async function dispatch(data: { id: number; format: 'step' | 'iges' }) {
		await import('../lib/workers/occt-worker');
		const onmessage = (
			globalThis as typeof globalThis & {
				self: { onmessage: (event: MessageEvent) => void };
			}
		).self.onmessage;
		onmessage({
			data: { ...data, data: new ArrayBuffer(8) }
		} as MessageEvent);
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	it('reports parser initialisation failures with structured diagnostics', async () => {
		mockCreateOC.mockRejectedValue(new Error('Init failed'));

		await dispatch({ id: 1, format: 'step' });

		expect(postMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				id: 1,
				error: 'Init failed',
				parserVersion: 'occt-import-js@0.0.23',
				format: 'step'
			})
		);
	});

	it('reports unsuccessful imports as transfer failures', async () => {
		mockCreateOC.mockResolvedValue({
			ReadStepFile: vi.fn().mockReturnValue({ success: false })
		});

		await dispatch({ id: 2, format: 'step' });

		expect(postMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				id: 2,
				code: 'transfer_failed'
			})
		);
	});

	it('flattens imported meshes into transferable typed arrays', async () => {
		mockCreateOC.mockResolvedValue({
			ReadStepFile: vi.fn().mockReturnValue({
				success: true,
				root: { children: [{}] },
				meshes: [
					{
						attributes: {
							position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
							normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] }
						},
						index: { array: [0, 1, 2] }
					}
				]
			})
		});

		await dispatch({ id: 3, format: 'step' });

		expect(postMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				id: 3,
				vertexCount: 3,
				faceCount: 1,
				rootCount: 1,
				transferCount: 1
			}),
			expect.objectContaining({ transfer: expect.any(Array) })
		);
	});
});
