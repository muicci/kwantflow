import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AssetFile } from '$lib/types/index.js';
import {
	resolveEstimateAiFileEligibility,
	summariseEstimateAiFileEligibilities
} from './estimate-ai-file-eligibility.js';

function createAssetFile(
	overrides: Partial<AssetFile> &
		Pick<AssetFile, 'id' | 'project_id' | 'file_path' | 'original_name'>
): AssetFile {
	return {
		asset_id: null,
		mime_type: null,
		created_at: '2026-04-04T00:00:00Z',
		...overrides
	};
}

describe('estimate AI file eligibility', () => {
	it.each([
		['spec.pdf', 'native_file'],
		['photo.webp', 'native_image'],
		['schedule.csv', 'text'],
		['spec.docx', 'text'],
		['schedule.xlsx', 'text'],
		['markup.svg', 'converted_image'],
		['part.step', 'cad_renders'],
		['part.iges', 'cad_renders'],
		['layout.dxf', 'cad_renders'],
		['layout.dwg', 'cad_renders']
	] as const)('uses the static file contract for %s', async (fileName, evidenceMode) => {
		await expect(
			resolveEstimateAiFileEligibility(
				createAssetFile({
					id: fileName,
					project_id: 'project-1',
					file_path: `workspace/project-1/${fileName}`,
					original_name: fileName
				})
			)
		).resolves.toMatchObject({
			status: 'eligible',
			evidenceMode,
			reasonCode: 'supported',
			tooltipLabel: 'Used by AI draft'
		});
	});

	it('does not convert, rasterise, or read source files during route eligibility checks', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/services/estimate-ai-file-eligibility.ts'),
			'utf8'
		);
		for (const forbiddenCall of [
			'buildEstimateAiCadEvidence',
			'buildEstimateAiImageArtifact',
			'readEstimateAiTextContent',
			'readPdfAssetFile'
		]) {
			expect(source).not.toContain(forbiddenCall);
		}
	});

	it('keeps DWF explicitly unsupported until a verified parser exists', async () => {
		await expect(
			resolveEstimateAiFileEligibility(
				createAssetFile({
					id: 'drawing.dwf',
					project_id: 'project-1',
					file_path: 'workspace/project-1/drawing.dwf',
					original_name: 'drawing.dwf'
				})
			)
		).resolves.toMatchObject({
			status: 'ineligible',
			evidenceMode: 'none',
			reasonCode: 'unsupported_file_type'
		});
	});

	it('summarises exact file-contract statuses', () => {
		const summary = summariseEstimateAiFileEligibilities([
			{
				fileId: 'pdf-1',
				fileName: 'spec.pdf',
				status: 'eligible',
				evidenceMode: 'native_file',
				reasonCode: 'supported',
				tooltipLabel: 'Used by AI draft',
				tooltipDetail: 'AI can use this file in the draft.'
			},
			{
				fileId: 'dwf-1',
				fileName: 'drawing.dwf',
				status: 'ineligible',
				evidenceMode: 'none',
				reasonCode: 'unsupported_file_type',
				tooltipLabel: 'Not used by AI draft',
				tooltipDetail: 'This file type is not supported for AI drafting yet.'
			}
		]);

		expect(summary.hasEligibleFiles).toBe(true);
		expect(summary.eligibleFiles).toHaveLength(1);
		expect(summary.ineligibleFiles).toHaveLength(1);
	});
});
