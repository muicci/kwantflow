export interface ImageTile {
	inlineData: string; // Base64 JPEG data
	displayName: string; // e.g. "Grid A-1"
	colIndex: number;
	rowIndex: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export async function tileImageWithGridCoordinates(
	imageSource: Blob,
	options: {
		tileWidth?: number;
		tileHeight?: number;
		overlapPercent?: number;
		drawOverlay?: boolean;
	} = {}
): Promise<ImageTile[]> {
	const tileW = options.tileWidth ?? 1056;
	const tileH = options.tileHeight ?? 576;
	const overlap = options.overlapPercent ?? 15;

	// Load image
	const image = new Image();
	const objectUrl = URL.createObjectURL(imageSource);
	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Failed to load image for tiling'));
			image.src = objectUrl;
		});
	} finally {
		URL.revokeObjectURL(objectUrl);
	}

	const imgW = image.width;
	const imgH = image.height;
	const tiles: ImageTile[] = [];

	// Calculate stride sizes based on overlap
	const strideX = Math.round(tileW * (1 - overlap / 100));
	const strideY = Math.round(tileH * (1 - overlap / 100));

	const cols = Math.ceil((imgW - tileW) / strideX) + 1;
	const rows = Math.ceil((imgH - tileH) / strideY) + 1;

	// Helper to generate column labels dynamically (A, B, C... Z, AA...)
	function getColLabel(index: number): string {
		let label = '';
		let temp = index;
		while (temp >= 0) {
			label = String.fromCharCode((temp % 26) + 65) + label;
			temp = Math.floor(temp / 26) - 1;
		}
		return label;
	}

	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			let x = c * strideX;
			let y = r * strideY;

			// Clamp bounds to prevent empty boundaries
			if (x + tileW > imgW) x = Math.max(0, imgW - tileW);
			if (y + tileH > imgH) y = Math.max(0, imgH - tileH);

			const canvas = document.createElement('canvas');
			canvas.width = tileW;
			canvas.height = tileH;
			const ctx = canvas.getContext('2d');
			if (!ctx) continue;

			// Draw white background and tile portion
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, tileW, tileH);

			// Fix out-of-bounds rendering by clipping the source width and height
			const sourceW = Math.min(tileW, imgW - x);
			const sourceH = Math.min(tileH, imgH - y);
			ctx.drawImage(image, x, y, sourceW, sourceH, 0, 0, sourceW, sourceH);

			const colLabel = getColLabel(c);
			const rowLabel = `${r + 1}`;

			// Draw Grid coordinates overlay directly on image canvas only if requested
			if (options.drawOverlay !== false) {
				ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)'; // Red grid lines
				ctx.lineWidth = 2;
				ctx.font = 'bold 16px sans-serif';
				ctx.fillStyle = 'red';

				// Draw vertical helper line
				ctx.beginPath();
				ctx.moveTo(tileW / 2, 0);
				ctx.lineTo(tileW / 2, tileH);
				ctx.stroke();

				// Draw coordinate label corner badges
				const coordinateString = `Tile: ${colLabel}-${rowLabel}`;

				ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
				ctx.fillRect(10, 10, 120, 24);
				ctx.fillStyle = 'red';
				ctx.fillText(coordinateString, 15, 28);
			}

			// Encode to Base64 JPEG
			const base64 = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');
			tiles.push({
				inlineData: base64,
				displayName: `Grid ${colLabel}-${rowLabel}`,
				colIndex: c,
				rowIndex: r,
				x,
				y,
				width: tileW,
				height: tileH
			});
		}
	}
	return tiles;
}
