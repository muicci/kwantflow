declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
	interface HeifImage {
		get_width(): number;
		get_height(): number;
		display(pixels: ImageData, callback: (pixels: ImageData | null) => void): void;
		free(): void;
	}
	interface HeifRuntime {
		heif_get_version(): string;
		HeifDecoder: new () => { decoder: number | null; decode(bytes: Uint8Array): HeifImage[] };
		heif_context_free(context: number): void;
	}
	const createLibheif: () => HeifRuntime | Promise<HeifRuntime>;
	export default createLibheif;
}
