import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('project workspace thumbnail loading', () => {
	it('renders overview thumbnails without workspace-only visibility deferral', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/routes/project/[id]/+page.svelte'),
			'utf8'
		);

		expect(source).toContain('<AssetThumbnail filePath={file.file_path} />');
		expect(source).toContain('<AssetThumbnail filePath={path} />');
		expect(source).not.toContain('loadWhenVisible={true}');
	});
});
