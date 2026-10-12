import { describe, expect, it } from 'vitest';

import {
	filterPickerOptions,
	matchesPickerSearchTerms,
	rankPickerOptions,
	resolveEstimateTemplateTriggerLabel,
	resolvePresetApplySelection,
	shouldAutoApplyPendingAiEstimate,
	resolveTemplateApplySelection
} from './asset-estimate-editor.helpers';

describe('asset estimate editor helpers', () => {
	it('shows the applied template name when one exists', () => {
		expect(resolveEstimateTemplateTriggerLabel('Starter Estimate')).toBe('Starter Estimate');
		expect(resolveEstimateTemplateTriggerLabel('   Starter Estimate   ')).toBe('Starter Estimate');
	});

	it('falls back to the apply action label when no template is applied', () => {
		expect(resolveEstimateTemplateTriggerLabel(null)).toBe('Apply Template');
		expect(resolveEstimateTemplateTriggerLabel('   ')).toBe('Apply Template');
	});

	it('confirms template apply when the estimate already has replaceable content', () => {
		expect(
			resolveTemplateApplySelection(
				'template-1',
				[{ id: 'template-1', name: 'Starter Estimate' }],
				true
			)
		).toEqual({
			kind: 'confirm',
			intent: {
				templateId: 'template-1',
				templateName: 'Starter Estimate'
			}
		});
	});

	it('applies a template immediately when the estimate is empty', () => {
		expect(
			resolveTemplateApplySelection(
				'template-1',
				[{ id: 'template-1', name: 'Starter Estimate' }],
				false
			)
		).toEqual({
			kind: 'apply',
			intent: {
				templateId: 'template-1',
				templateName: 'Starter Estimate'
			}
		});
	});

	it('ignores missing template selections', () => {
		expect(resolveTemplateApplySelection('', [], true)).toEqual({ kind: 'ignore' });
		expect(
			resolveTemplateApplySelection(
				'missing-template',
				[{ id: 'template-1', name: 'Starter Estimate' }],
				true
			)
		).toEqual({ kind: 'ignore' });
	});

	it('confirms preset apply when the takeoff item already has cost rows', () => {
		expect(
			resolvePresetApplySelection(
				'item-1',
				'preset-1',
				[{ id: 'preset-1', name: 'Workshop Package' }],
				true
			)
		).toEqual({
			kind: 'confirm',
			intent: {
				itemId: 'item-1',
				presetId: 'preset-1',
				presetName: 'Workshop Package'
			}
		});
	});

	it('applies a preset immediately when the takeoff item has no cost rows', () => {
		expect(
			resolvePresetApplySelection(
				'item-1',
				'preset-1',
				[{ id: 'preset-1', name: 'Workshop Package' }],
				false
			)
		).toEqual({
			kind: 'apply',
			intent: {
				itemId: 'item-1',
				presetId: 'preset-1',
				presetName: 'Workshop Package'
			}
		});
	});

	it('ignores preset applies when the selected preset no longer exists', () => {
		expect(resolvePresetApplySelection('item-1', '', [], true)).toEqual({ kind: 'ignore' });
		expect(
			resolvePresetApplySelection(
				'item-1',
				'missing-preset',
				[{ id: 'preset-1', name: 'Workshop Package' }],
				true
			)
		).toEqual({ kind: 'ignore' });
	});

	it('restores a pending AI estimate into a pristine blank editor after hydration', () => {
		expect(
			shouldAutoApplyPendingAiEstimate({
				isDirty: false,
				hasRestorableBaseline: true,
				currentMatchesRestorableBaseline: false,
				hasSavedEstimate: false,
				currentMatchesSavedEstimate: false,
				isCurrentBlank: true
			})
		).toBe(true);
	});

	it('does not overwrite dirty editor changes with a pending AI estimate', () => {
		expect(
			shouldAutoApplyPendingAiEstimate({
				isDirty: true,
				hasRestorableBaseline: true,
				currentMatchesRestorableBaseline: false,
				hasSavedEstimate: false,
				currentMatchesSavedEstimate: false,
				isCurrentBlank: true
			})
		).toBe(false);
	});

	it('restores a pending AI estimate when the editor matches the saved estimate snapshot', () => {
		expect(
			shouldAutoApplyPendingAiEstimate({
				isDirty: false,
				hasRestorableBaseline: true,
				currentMatchesRestorableBaseline: false,
				hasSavedEstimate: true,
				currentMatchesSavedEstimate: true,
				isCurrentBlank: false
			})
		).toBe(true);
	});

	it('matches picker searches with order-independent keyword terms', () => {
		expect(matchesPickerSearchTerms('qa canopy package preset proof clean', 'proof canopy')).toBe(
			true
		);
		expect(matchesPickerSearchTerms('qa canopy package preset proof clean', 'proof missing')).toBe(
			false
		);
	});

	it('matches picker searches when AI labels include quantity suffixes', () => {
		expect(
			matchesPickerSearchTerms(
				'Structural steel canopy package MAT-CANOPY-001 bundled canopy fabrication supply package',
				'Structural steel canopy package: 1 lot'
			)
		).toBe(true);
		expect(
			matchesPickerSearchTerms(
				'Structural steel canopy package MAT-CANOPY-001 bundled canopy fabrication supply package',
				'Structural steel canopy package . 1 lot'
			)
		).toBe(true);
	});

	it('ranks stronger picker records above placeholder entries when no query is provided', () => {
		const ranked = rankPickerOptions([
			{
				label: 'Name',
				code: 'BADSYS',
				description: 'uniformat',
				aliases: [],
				searchText: 'name badsys uniformat'
			},
			{
				label: 'Masterformat Fabrication',
				code: 'MFAB',
				description: 'masterformat',
				aliases: ['steel fabrication'],
				searchText: 'masterformat fabrication mfab masterformat steel fabrication'
			}
		]);

		expect(ranked[0]?.label).toBe('Masterformat Fabrication');
		expect(ranked[1]?.label).toBe('Name');
	});

	it('prioritises exact alias matches in picker ranking', () => {
		const ranked = rankPickerOptions(
			[
				{
					label: 'QA Canopy Package Preset Proof Clean',
					code: 'QA-TEMPLATE-002',
					description: 'Canopy scaffold',
					aliases: ['canopy proof clean'],
					searchText:
						'qa canopy package preset proof clean qa-template-002 canopy scaffold canopy proof clean'
				},
				{
					label: 'Canopy Template Legacy',
					code: 'LEGACY-1',
					description: 'Older fixture',
					aliases: [],
					searchText: 'canopy template legacy legacy-1 older fixture'
				}
			],
			'canopy proof clean'
		);

		expect(ranked[0]?.label).toBe('QA Canopy Package Preset Proof Clean');
	});

	it('ranks catalogue records correctly when the search query carries quantity punctuation', () => {
		const ranked = rankPickerOptions(
			[
				{
					label: 'Structural steel canopy package',
					code: 'MAT-CANOPY-001',
					description: 'Bundled canopy fabrication supply package',
					aliases: ['canopy package', 'shop welding'],
					searchText:
						'Structural steel canopy package MAT-CANOPY-001 Bundled canopy fabrication supply package canopy package shop welding'
				},
				{
					label: 'Structural steel beam',
					code: 'MAT-BEAM-002',
					description: 'Beam stock',
					aliases: [],
					searchText: 'Structural steel beam MAT-BEAM-002 Beam stock'
				}
			],
			'Structural steel canopy package: 1 lot'
		);

		expect(ranked[0]?.label).toBe('Structural steel canopy package');
	});

	it('filters placeholder picker records out of default results', () => {
		const filtered = filterPickerOptions([
			{
				label: 'Name',
				code: 'BADSYS',
				description: 'uniformat',
				aliases: [],
				searchText: 'name badsys uniformat'
			},
			{
				label: 'Masterformat Fabrication',
				code: 'MFAB',
				description: 'masterformat',
				aliases: ['steel fabrication'],
				searchText: 'masterformat fabrication mfab masterformat steel fabrication'
			}
		]);

		expect(filtered.map((option) => option.label)).toEqual(['Masterformat Fabrication']);
	});

	it('still allows direct searches for placeholder picker records', () => {
		const filtered = filterPickerOptions(
			[
				{
					label: 'Name',
					code: 'BADSYS',
					description: 'uniformat',
					aliases: [],
					searchText: 'name badsys uniformat'
				},
				{
					label: 'Masterformat Fabrication',
					code: 'MFAB',
					description: 'masterformat',
					aliases: ['steel fabrication'],
					searchText: 'masterformat fabrication mfab masterformat steel fabrication'
				}
			],
			'badsys'
		);

		expect(filtered.map((option) => option.label)).toContain('Name');
	});

	it('filters low-entropy gibberish records out of default results', () => {
		const filtered = filterPickerOptions([
			{
				label: 'efewfwe',
				code: 'WEFWEF',
				description: 'uniformat',
				aliases: [],
				searchText: 'efewfwe wefwef uniformat'
			},
			{
				label: 'Uniformat NZ',
				code: '',
				description: 'uniformat',
				aliases: [],
				searchText: 'uniformat nz uniformat'
			}
		]);

		expect(filtered.map((option) => option.label)).toEqual(['Uniformat NZ']);
	});

	it('keeps structured numeric classification labels visible by default', () => {
		const filtered = filterPickerOptions([
			{
				label: '05 12 00',
				code: 'CC-100',
				description: 'structural steel framing',
				aliases: [],
				searchText: '05 12 00 cc-100 structural steel framing'
			}
		]);

		expect(filtered.map((option) => option.label)).toEqual(['05 12 00']);
	});
});
