import { describe, expect, it } from 'vitest';
import {
	evaluateDecimalExpression,
	validateQuantityFormula
} from '$lib/services/assistant-tools/calculator.js';
import { previewTakeoffItem } from '$lib/services/assistant-tools/takeoff-preview.js';
import {
	describeRecords,
	getRecord,
	searchRecords
} from '$lib/services/assistant-tools/records.js';
import {
	buildMutationSourceItems,
	proposeSourceRecordChange,
	requiredCreateFieldsByScope
} from '$lib/services/assistant-tools/source-record-proposals.js';
import {
	getAssistantActionDefinition,
	getAssistantToolDeclarations
} from '$lib/services/assistant-actions/registry.js';

describe('deterministic assistant estimator tools', () => {
	it.each([[{}], [12], [true], [null], ['  ']])(
		'rejects invalid catalogue proposal aliases %j',
		(...aliases) => {
			const result = proposeSourceRecordChange({
				scope: 'materials',
				action: 'create',
				fields: { name: 'Plate', unit: 'kg', default_rate: 4.85, aliases }
			});
			expect(result).toMatchObject({
				status: 'error',
				code: 'invalid_field_values',
				issues: [expect.objectContaining({ field: 'aliases' })]
			});
		}
	);

	it('normalizes valid catalogue proposal aliases without discarding them', () => {
		expect(
			proposeSourceRecordChange({
				scope: 'materials',
				action: 'create',
				fields: {
					name: 'Plate',
					unit: 'kg',
					default_rate: 4.85,
					aliases: [' plate ', 'ms plate']
				}
			})
		).toMatchObject({
			status: 'proposal',
			proposal: { fields: { aliases: ['plate', 'ms plate'] } }
		});
	});

	it('evaluates decimal expressions without binary floating point drift', () => {
		const result = evaluateDecimalExpression({ expression: '0.1 + 0.2' });

		expect(result.value).toBe('0.3');
		expect(result.provenance.toolName).toBe('calculator_evaluate_decimal');
	});

	it('allows ordinary negative arithmetic results', () => {
		expect(evaluateDecimalExpression({ expression: '5 - 12' }).value).toBe('-7');
	});

	it('supports postfix percentage expressions', () => {
		expect(evaluateDecimalExpression({ expression: '250 * 15%' }).value).toBe('37.5');
		expect(evaluateDecimalExpression({ expression: '15% * 250' }).value).toBe('37.5');
	});

	it('cleans conversational helper prefixes and suffixes from expressions', () => {
		expect(evaluateDecimalExpression({ expression: 'count 2*2' }).value).toBe('4');
		expect(evaluateDecimalExpression({ expression: 'calculate 15 * 4' }).value).toBe('60');
		expect(evaluateDecimalExpression({ expression: 'solve 12 / 3' }).value).toBe('4');
		expect(evaluateDecimalExpression({ expression: '  evaluate   10 - 2 ' }).value).toBe('8');
		expect(evaluateDecimalExpression({ expression: '8 + 2 equals' }).value).toBe('10');
		expect(evaluateDecimalExpression({ expression: 'pi * 2' }).value).toBe('6.2831853071795864769');
	});

	it('rejects invalid expressions instead of executing JavaScript', () => {
		expect(() => evaluateDecimalExpression({ expression: 'globalThis.process.exit(1)' })).toThrow(
			/Unsupported token|Invalid decimal expression/
		);
	});

	it('rejects divide by zero', () => {
		expect(() => evaluateDecimalExpression({ expression: '10 / (5 - 5)' })).toThrow(
			/Division by zero/
		);
	});

	it('validates quantity formulas through the same decimal evaluator', () => {
		const result = validateQuantityFormula({ formula: '(1200 / 1000) * 4', unit: 'm' });

		expect(result.valid).toBe(true);
		expect(result.value).toBe('4.8');
		expect(result.unit).toBe('m');
	});

	it('exposes progressive read-only record discovery', async () => {
		const source = {
			describe: async () => [
				{
					scope: 'materials',
					label: 'Materials',
					description: 'Material catalogue records.',
					searchableFields: ['name'],
					detailFields: [{ name: 'default_rate', kind: 'number' }],
					supportedFilters: ['includeInactive']
				}
			],
			search: async () => [],
			get: async () => null
		};

		await expect(describeRecords({}, source)).resolves.toMatchObject({
			status: 'ok',
			scopes: [expect.objectContaining({ scope: 'materials' })]
		});
		await expect(searchRecords({ query: 'plate' }, source)).resolves.toMatchObject({
			status: 'ok',
			results: []
		});
		await expect(
			getRecord({ scope: 'materials', recordId: 'missing' }, source)
		).resolves.toMatchObject({ status: 'not_found', record: null });
	});

	it('returns model-actionable record tool recovery payloads', async () => {
		const source = {
			describe: async (scope?: string) => {
				if (scope === 'bad_scope') throw new Error('Unknown record scope: bad_scope');
				return [
					{
						scope: 'materials',
						label: 'Materials',
						description: 'Material catalogue records.',
						searchableFields: ['name'],
						detailFields: [{ name: 'default_rate', kind: 'number' }],
						supportedFilters: ['includeInactive']
					}
				];
			},
			search: async () => [],
			get: async () => null
		};

		await expect(searchRecords({ query: '' }, source)).resolves.toMatchObject({
			status: 'error',
			code: 'invalid_arguments',
			recoverable: true,
			retryHint: expect.any(String)
		});
		await expect(
			searchRecords({ scope: 'materials', query: '', browse: true }, source)
		).resolves.toMatchObject({
			status: 'ok',
			results: []
		});
		await expect(describeRecords({ scope: 'bad_scope' }, source)).resolves.toMatchObject({
			status: 'unavailable',
			code: 'describe_failed',
			recoverable: true,
			retryHint: expect.stringContaining('records_describe')
		});
		await expect(
			getRecord({ scope: 'materials', recordId: 'missing' }, source)
		).resolves.toMatchObject({
			status: 'not_found',
			code: 'record_not_found',
			recoverable: true,
			retryHint: expect.stringContaining('records_search')
		});
	});

	it('previews takeoff item totals without writing estimate state', () => {
		const result = previewTakeoffItem({
			name: 'Bracket install',
			quantity: '2',
			unit: 'ea',
			costComponents: [
				{ name: 'Steel plate', category: 'material', quantity: '3', unit: 'kg', unitRate: '9' },
				{ name: 'Fabrication', category: 'labour', quantity: '1.5', unit: 'hr', unitRate: '120' }
			]
		});

		expect(result.itemUnitCost).toBe('207');
		expect(result.itemTotalCost).toBe('414');
		expect(result.previewOnly).toBe(true);
	});

	it('includes deterministic estimator tools in the assistant registry', () => {
		const names = getAssistantToolDeclarations().map((entry) => entry.function.name);

		expect(names).toEqual(
			expect.arrayContaining([
				'calculator_evaluate_decimal',
				'formula_validate_quantity',
				'units_convert',
				'records_describe',
				'records_search',
				'records_get',
				'contact_change',
				'material_change',
				'labour_rate_change',
				'equipment_rate_change',
				'subcontract_rate_change',
				'wbs_item_change',
				'quote_option_change',
				'asset_change',
				'inspect_current_screen'
			])
		);
		expect(names).not.toContain(['records', 'propose', 'change'].join('_'));
		expect(names).not.toContain('estimate_preview_takeoff_item');
	});

	it('declares compact action-only proposal inputs for Gemma', () => {
		const declarations = getAssistantToolDeclarations();
		const material = declarations.find((entry) => entry.function.name === 'material_change');
		const contact = declarations.find((entry) => entry.function.name === 'contact_change');
		expect(material?.function.parameters).toMatchObject({
			properties: {
				action: { type: 'string', enum: ['create', 'update'] },
				sourceItem: { type: 'integer' },
				recordId: { type: 'string' }
			},
			required: ['action']
		});
		const materialProperties = material?.function.parameters.properties as
			Record<string, unknown> | undefined;
		const contactProperties = contact?.function.parameters.properties as
			Record<string, unknown> | undefined;
		expect(materialProperties?.scope).toBeUndefined();
		expect(materialProperties?.fields).toBeUndefined();
		expect(materialProperties?.summary).toBeUndefined();
		expect(materialProperties?.name).toBeUndefined();
		expect(materialProperties?.default_rate).toBeUndefined();
		expect(materialProperties?.display_name).toBeUndefined();
		expect(materialProperties?.text).toBeUndefined();
		expect(contactProperties?.sourceItem).toMatchObject({ type: 'integer' });
		expect(contactProperties?.default_rate).toBeUndefined();
	});

	it('preserves exact semicolon-delimited mutation source items', () => {
		expect(
			buildMutationSourceItems(
				'Create these three materials for approval: KF Multi Plate A, 4.85 AUD per kg, cost basis; KF Multi Cable B, 7.20 AUD per metre, cost basis; KF Multi Fastener C, 1.10 AUD per each, cost basis.'
			)
		).toEqual([
			'KF Multi Plate A, 4.85 AUD per kg, cost basis',
			'KF Multi Cable B, 7.20 AUD per metre, cost basis',
			'KF Multi Fastener C, 1.10 AUD per each, cost basis.'
		]);
	});

	it('extracts every item from a five-material source list', () => {
		const items = buildMutationSourceItems(
			'Create these five materials for approval: KF Five Plate A, 11.11 AUD per kg, cost basis; KF Five Cable B, 12.22 AUD per metre, cost basis; KF Five Fastener C, 13.33 AUD per each, cost basis; KF Five Sheet D, 14.44 AUD per sheet, cost basis; KF Five Tube E, 15.55 AUD per metre, cost basis.'
		);

		expect(items).toHaveLength(5);
		for (const text of items) {
			expect(
				proposeSourceRecordChange(
					{ scope: 'materials', action: 'create', text },
					{ sourceText: text }
				)
			).toMatchObject({ status: 'proposal' });
		}
	});

	it('uses authoritative source text even when an undeclared empty fields object is present', () => {
		expect(
			proposeSourceRecordChange({
				scope: 'materials',
				action: 'create',
				text: 'KF Five Fastener C, 13.33 AUD per each, cost basis',
				fields: {}
			})
		).toMatchObject({
			status: 'proposal',
			proposal: {
				fields: {
					name: 'KF Five Fastener C',
					default_rate: 13.33,
					unit: 'ea',
					currency_code: 'AUD',
					rate_basis: 'cost'
				}
			}
		});
	});

	it('keeps one unstructured mutation request as one exact source item', () => {
		const prompt =
			'Create one material called KF Approval Proof Plate with unit metre, rate 13.75 AUD, cost basis.';
		expect(buildMutationSourceItems(prompt)).toEqual([prompt]);
	});

	it('drafts a material proposal by extracting literal fields from compact text', () => {
		const result = proposeSourceRecordChange({
			scope: 'materials',
			action: 'create',
			text: 'Create material KF Closeout Single Plate with unit metre, rate 11.25 AUD, cost basis.'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				scope: 'materials',
				fields: {
					name: 'KF Closeout Single Plate',
					unit: 'm',
					default_rate: 11.25,
					currency_code: 'AUD',
					rate_basis: 'cost'
				}
			}
		});
	});

	it('preserves a material name introduced with “name it”', () => {
		const result = proposeSourceRecordChange({
			scope: 'materials',
			action: 'create',
			text: 'Create a material record for approval only. Name it Assistant Approval QA 20260711, code APPROVAL-QA-20260711, unit kg, and default rate 1.23 AUD per kg.'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				fields: {
					name: 'Assistant Approval QA 20260711',
					code: 'APPROVAL-QA-20260711',
					unit: 'kg',
					default_rate: 1.23,
					currency_code: 'AUD'
				}
			}
		});
	});

	it('extracts a literal amount followed by currency and per-unit wording', () => {
		const result = proposeSourceRecordChange({
			scope: 'materials',
			action: 'create',
			text: 'Create material KF Multi Plate A, 4.85 AUD per kg, cost basis.'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				fields: {
					name: 'KF Multi Plate A',
					unit: 'kg',
					default_rate: 4.85,
					currency_code: 'AUD',
					rate_basis: 'cost'
				}
			}
		});
	});

	it('extracts an update rate expressed with natural to wording', () => {
		const result = proposeSourceRecordChange({
			scope: 'materials',
			action: 'update',
			recordId: 'material-1',
			text: 'Update KF Multi Plate A rate to 5.55 AUD.'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				recordId: 'material-1',
				summary: 'Update material “KF Multi Plate A”.',
				fields: { default_rate: 5.55, currency_code: 'AUD' }
			}
		});
	});

	it('uses an update code to identify the record without proposing a code change', () => {
		const result = proposeSourceRecordChange({
			scope: 'materials',
			action: 'update',
			recordId: 'material-1',
			text: 'Update the existing material with code UPDATE-QA-20260711 to a default rate of 2.34 AUD per kg.'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				recordId: 'material-1',
				summary: 'Update material “UPDATE-QA-20260711”.',
				fields: { default_rate: 2.34, unit: 'kg', currency_code: 'AUD' }
			}
		});
		expect(result).not.toMatchObject({ proposal: { fields: { code: expect.anything() } } });
	});

	it('preserves an explicit material code from the authoritative source item', () => {
		const result = proposeSourceRecordChange({
			scope: 'materials',
			action: 'create',
			text: 'Create material named QA Test Material with code QA-TEST-001, unit EA, and default rate 1 AUD.'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				fields: {
					name: 'QA Test Material',
					code: 'QA-TEST-001',
					unit: 'ea',
					default_rate: 1,
					currency_code: 'AUD'
				}
			}
		});
	});

	it('does not manufacture missing proposal fields from the original user request', () => {
		const result = proposeSourceRecordChange(
			{
				scope: 'materials',
				action: 'create',
				text: 'KF Closeout Single Plate'
			},
			{
				sourceText:
					'Create one material called KF Closeout Single Plate with unit metre, rate 11.25 AUD, cost basis.'
			}
		);

		expect(result).toMatchObject({
			status: 'error',
			code: 'missing_required_fields',
			missing: expect.arrayContaining(['unit', 'default_rate'])
		});
	});

	it('rejects a shortened proposal label instead of overwriting it from the user prompt', () => {
		const result = proposeSourceRecordChange(
			{
				scope: 'materials',
				action: 'create',
				text: 'Closeout Single Plate'
			},
			{
				sourceText:
					'Create one material called KF Closeout Single Plate with unit metre, rate 11.25 AUD, cost basis.'
			}
		);

		expect(result).toMatchObject({
			status: 'error',
			code: 'missing_required_fields'
		});
	});

	it('keeps canonical field validation available for internal proposal payloads', () => {
		const material = getAssistantToolDeclarations().find(
			(entry) => entry.function.name === 'material_change'
		);
		const properties = material?.function.parameters.properties as Record<string, unknown>;

		expect(properties.unit).toBeUndefined();
		expect(properties.rate_basis).toBeUndefined();
		expect(properties.currency_code).toBeUndefined();
	});

	it('drafts source-record proposals without writing data', () => {
		const result = proposeSourceRecordChange({
			scope: 'materials',
			action: 'create',
			fields: {
				name: 'KF Test Plate',
				unit: 'kg',
				default_rate: 4.85
			},
			summary: 'Create a validation material.'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				scope: 'materials',
				fields: {
					name: 'KF Test Plate',
					unit: 'kg',
					default_rate: 4.85
				}
			}
		});
	});

	it('rejects proposal values that drift from literal user-specified names and numbers', () => {
		const result = proposeSourceRecordChange(
			{
				scope: 'materials',
				action: 'create',
				fields: {
					name: 'KF Close Plate',
					unit: 'm',
					default_rate: 1.5,
					currency_code: 'AUD',
					rate_basis: 'cost'
				},
				summary: 'Create a material.'
			},
			{
				sourceText:
					'Create one material called KF Closeout Single Plate with unit metre, rate 11.25 AUD, cost basis.'
			}
		);

		expect(result).toMatchObject({
			status: 'error',
			code: 'literal_value_mismatch',
			recoverable: true
		});
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ field: 'name' }),
				expect.objectContaining({ field: 'default_rate' })
			])
		);
	});

	it('keeps quote-option create requirements aligned with the Rust trust boundary', () => {
		expect(requiredCreateFieldsByScope.quote_options).toEqual([
			'project_id',
			'label',
			'markup_percentage'
		]);
	});

	it('normalizes flattened native proposal calls into allowlisted fields', () => {
		const result = proposeSourceRecordChange({
			scope: 'Materials',
			action: 'update',
			recordId: 'material-1',
			name: 'KF Test Plate',
			unit: 'kg',
			rate: '5.25',
			currency: 'AUD',
			basis: 'cost',
			specs: '10mm galvanised plate'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				scope: 'materials',
				action: 'update',
				recordId: 'material-1',
				fields: {
					name: 'KF Test Plate',
					unit: 'kg',
					default_rate: 5.25,
					currency_code: 'AUD',
					rate_basis: 'cost',
					specification: '10mm galvanised plate'
				},
				summary: 'Update material “KF Test Plate”.'
			}
		});
	});

	it('canonicalizes proposal units, currencies, and rate basis before staging', () => {
		const material = proposeSourceRecordChange({
			scope: 'materials',
			action: 'create',
			fields: {
				name: 'KF Canonical Plate',
				unit: 'metre',
				default_rate: 4.85,
				currency_code: 'aud',
				rate_basis: 'SELL'
			},
			summary: 'Create canonical plate.'
		});
		const eachMaterial = proposeSourceRecordChange({
			scope: 'materials',
			action: 'create',
			fields: { name: 'KF Each Plate', unit: 'each', default_rate: 2 },
			summary: 'Create each plate.'
		});

		expect(material).toMatchObject({
			status: 'proposal',
			proposal: {
				fields: { unit: 'm', currency_code: 'AUD', rate_basis: 'sell' }
			}
		});
		expect(eachMaterial).toMatchObject({
			status: 'proposal',
			proposal: { fields: { unit: 'ea' } }
		});
	});

	it('rejects units unsupported by the selected proposal scope', () => {
		const result = proposeSourceRecordChange({
			scope: 'labour_rates',
			action: 'create',
			fields: { name: 'KF Invalid Labour', unit: 'kg', default_rate: 120 },
			summary: 'Create invalid labour rate.'
		});

		expect(result).toMatchObject({
			status: 'error',
			code: 'invalid_field_values',
			issues: [expect.objectContaining({ field: 'unit' })]
		});
	});

	it('normalizes nested proposal field aliases without inventing omitted fields', () => {
		const result = proposeSourceRecordChange({
			scope: 'materials',
			action: 'update',
			recordId: 'material-1',
			fields: {
				rate: '6.75',
				currency: 'AUD',
				spec: '12mm plate'
			},
			summary: 'Update material rate and specification.'
		});

		expect(result).toMatchObject({
			status: 'proposal',
			proposal: {
				fields: {
					default_rate: 6.75,
					currency_code: 'AUD',
					specification: '12mm plate'
				}
			}
		});
		expect(result.status === 'proposal' ? result.proposal.fields : {}).not.toHaveProperty(
			'category'
		);
	});

	it('returns recoverable proposal errors instead of silently dropping unsupported fields', () => {
		expect(
			proposeSourceRecordChange({
				scope: 'materials',
				action: 'create',
				fields: {
					name: 'KF Test Plate',
					unit: 'kg',
					default_rate: 4.85,
					internal_table_name: 'assistant_action_audit'
				},
				summary: 'Create a validation material.'
			})
		).toMatchObject({
			status: 'error',
			code: 'unsupported_fields',
			recoverable: true,
			rejected: ['internal_table_name'],
			retryHint: expect.stringContaining('name')
		});
	});

	it('returns recoverable proposal errors for invalid field values', () => {
		expect(
			proposeSourceRecordChange({
				scope: 'materials',
				action: 'create',
				fields: {
					name: 'KF Test Plate',
					unit: 'kg',
					default_rate: -4.85
				},
				summary: 'Create a validation material.'
			})
		).toMatchObject({
			status: 'error',
			code: 'invalid_field_values',
			recoverable: true,
			issues: [{ field: 'default_rate', message: expect.any(String) }]
		});
	});

	it('uses the narrow supported mutation scopes for source-record proposals', () => {
		expect(
			proposeSourceRecordChange({
				scope: 'materials',
				action: 'create',
				fields: {
					name: 'KF Validation Plate',
					unit: 'kg',
					default_rate: 4.85
				},
				summary: 'Create a validation material.'
			})
		).toMatchObject({
			status: 'proposal',
			proposal: {
				scope: 'materials'
			}
		});

		expect(
			proposeSourceRecordChange({
				scope: 'templates',
				action: 'create',
				fields: { name: 'Legacy alias' },
				summary: 'Create with a legacy alias.'
			})
		).toMatchObject({
			status: 'error',
			code: 'invalid_arguments',
			recoverable: true
		});
	});

	it.each([
		'projects',
		'estimates',
		'quote_option_presets',
		'estimate_templates',
		'project_structure_templates',
		'cost_component_presets'
	])('rejects unsupported mutation scope %s instead of creating a disabled proposal', (scope) => {
		expect(
			proposeSourceRecordChange({
				scope,
				action: 'create',
				fields: { name: 'Unsupported record' },
				summary: 'Create an unsupported record.'
			})
		).toMatchObject({
			status: 'error',
			code: 'invalid_arguments',
			recoverable: true
		});
	});

	it('returns recoverable proposal errors for updates without exact targets', () => {
		expect(
			proposeSourceRecordChange({
				scope: 'materials',
				action: 'update',
				fields: { name: 'Missing ID', unit: 'kg', default_rate: 1 },
				summary: 'Update material.'
			})
		).toMatchObject({
			status: 'error',
			code: 'missing_record_id',
			recoverable: true
		});
	});

	it('accepts patch updates without requiring unchanged fields', () => {
		expect(
			proposeSourceRecordChange({
				scope: 'materials',
				action: 'update',
				recordId: 'material-1',
				fields: { default_rate: 5.25 },
				summary: 'Update material rate.'
			})
		).toMatchObject({
			status: 'proposal',
			proposal: {
				scope: 'materials',
				action: 'update',
				recordId: 'material-1',
				fields: { default_rate: 5.25 }
			}
		});
	});

	it('normalizes contact role/title aliases to role_title', () => {
		expect(
			proposeSourceRecordChange({
				scope: 'contacts',
				action: 'create',
				fields: { kind: 'person', name: 'Mina Hart', role_title: 'Estimator' },
				summary: 'Create estimator contact.'
			})
		).toMatchObject({ status: 'proposal' });

		expect(
			proposeSourceRecordChange({
				scope: 'contacts',
				action: 'create',
				fields: { kind: 'person', name: 'Mina Hart', role: 'Estimator' },
				summary: 'Create estimator contact.'
			})
		).toMatchObject({
			status: 'proposal',
			proposal: {
				fields: {
					role_title: 'Estimator'
				}
			}
		});
	});

	it('accepts model-emitted calculator expression without precision/rounding fields', () => {
		const calculatorDefinition = getAssistantActionDefinition('calculator_evaluate_decimal');
		expect(calculatorDefinition).toBeTruthy();

		// Model only sends expression — precision, decimalPlaces, roundingMode
		// are app-owned and never exposed to the model in the function schema.
		const parsed = calculatorDefinition?.parse({
			expression: '1200.2 + 4830.8'
		});

		expect(parsed).toMatchObject({
			expression: '1200.2 + 4830.8'
		});
	});

	it('supports exponentiation, math constants, and functions', () => {
		// Test power operator
		expect(evaluateDecimalExpression({ expression: '2^3' }).value).toBe('8');
		expect(evaluateDecimalExpression({ expression: '2^3^2' }).value).toBe('512'); // right-associative: 2^(3^2) = 2^9 = 512
		expect(evaluateDecimalExpression({ expression: '2 * 3^2' }).value).toBe('18'); // precedence: multiplication after power

		// Test constants (pi / PI)
		expect(evaluateDecimalExpression({ expression: 'pi' }).value).toBe('3.14159265358979323846');
		expect(evaluateDecimalExpression({ expression: 'PI' }).value).toBe('3.14159265358979323846');
		expect(evaluateDecimalExpression({ expression: 'pi * 2.5^2', decimalPlaces: 4 }).value).toBe(
			'19.635'
		);

		// Test function calls
		expect(evaluateDecimalExpression({ expression: 'sqrt(9)' }).value).toBe('3');
		expect(evaluateDecimalExpression({ expression: 'sqrt(3^2 + 4^2)' }).value).toBe('5');
		expect(evaluateDecimalExpression({ expression: 'abs(-5.25)' }).value).toBe('5.25');
		expect(evaluateDecimalExpression({ expression: 'ceil(4.001)' }).value).toBe('5');
		expect(evaluateDecimalExpression({ expression: 'floor(4.999)' }).value).toBe('4');
		expect(evaluateDecimalExpression({ expression: 'round(4.5678, 2)' }).value).toBe('4.57');
		expect(evaluateDecimalExpression({ expression: 'round(4.5678)' }).value).toBe('5');

		// Test min/max functions
		expect(evaluateDecimalExpression({ expression: 'min(10.5, 4.2, 8.9)' }).value).toBe('4.2');
		expect(evaluateDecimalExpression({ expression: 'max(10.5, 4.2, 8.9)' }).value).toBe('10.5');

		// Test nested functions
		expect(evaluateDecimalExpression({ expression: 'ceil(min(max(4.2, 5.5), 10.1))' }).value).toBe(
			'6'
		);
	});

	it('throws descriptive errors for unsupported or invalid function/operator calls', () => {
		// Divide by zero
		expect(() => evaluateDecimalExpression({ expression: '1 / 0' })).toThrow(/Division by zero/);
		// Negative square root
		expect(() => evaluateDecimalExpression({ expression: 'sqrt(-1)' })).toThrow(
			/Square root of negative number/
		);
		// Invalid arguments to sqrt
		expect(() => evaluateDecimalExpression({ expression: 'sqrt(9, 4)' })).toThrow(
			/Function "sqrt" expects exactly 1 argument/
		);
		// Invalid arguments to min
		expect(() => evaluateDecimalExpression({ expression: 'min(1)' })).toThrow(
			/Function "min" expects at least 2 arguments/
		);
		// Unsupported function
		expect(() => evaluateDecimalExpression({ expression: 'log(10)' })).toThrow(
			/Unsupported mathematical function/
		);
		// Invalid expression format
		expect(() => evaluateDecimalExpression({ expression: 'sqrt(1' })).toThrow(
			/missing closing parenthesis/
		);
	});
});
