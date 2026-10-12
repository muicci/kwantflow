import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import {
	analyseSetupImportWorkbook,
	buildSetupImportSchemaDigest,
	formatSetupImportRowMessages,
	getSetupImportFieldLabel,
	parseSetupImportFile,
	previewSetupImportSheet,
	SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX
} from './setup-import.js';
import { SETUP_IMPORT_TARGET_TABLES } from '$lib/constants/setup-import-registry.js';

function readSetupImportFixture(fileName: string): string {
	return readFileSync(join(process.cwd(), 'tests/fixtures/setup-import', fileName), 'utf8');
}

describe('setup import service', () => {
	it('builds the supported import schema digest for the setup wizard', () => {
		const digest = buildSetupImportSchemaDigest();

		expect(digest.digestVersion).toBe('setup-import-v4');
		expect(digest.tables.map((table) => table.id)).toEqual([...SETUP_IMPORT_TARGET_TABLES]);
		expect(digest.tables.find((table) => table.id === 'contacts')).toMatchObject({
			label: 'Companies'
		});
		expect(digest.tables.find((table) => table.id === 'contacts')?.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'display_name', required: true }),
				expect.objectContaining({ id: 'kind', required: false }),
				expect.objectContaining({ id: 'linked_company_id' }),
				expect.objectContaining({ id: 'email' }),
				expect.objectContaining({ id: 'country_code', required: false })
			])
		);
		expect(digest.tables.find((table) => table.id === 'cost_codes')?.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'code', required: true }),
				expect.objectContaining({ id: 'name', required: true }),
				expect.objectContaining({ id: 'sort_order', required: false })
			])
		);
		expect(digest.tables.find((table) => table.id === 'materials')?.fields).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: 'is_active', required: false })])
		);
		expect(digest.tables.find((table) => table.id === 'classification_systems')?.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'classification_type', required: false }),
				expect.objectContaining({ id: 'aliases', required: false }),
				expect.objectContaining({ id: 'is_default', required: false })
			])
		);
		expect(digest.tables.find((table) => table.id === 'subcontract_rates')?.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'name', required: true }),
				expect.objectContaining({ id: 'default_rate' }),
				expect.objectContaining({ id: 'currency_code', required: false }),
				expect.objectContaining({ id: 'company_names', required: false })
			])
		);
		expect(digest.tables.find((table) => table.id === 'project_structure_templates')).toMatchObject(
			{
				label: 'Project Structure Templates'
			}
		);
		const subcontractFieldIds =
			digest.tables
				.find((table) => table.id === 'subcontract_rates')
				?.fields.map((field) => field.id) ?? [];
		expect(subcontractFieldIds).not.toContain(['supplier', 'name'].join('_'));
	});

	it('preserves semicolon-delimited company names for deterministic catalogue linking', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'materials.csv',
			text: 'name,default_rate,unit,supplier\nSteel Plate,4.85,kg,Acme Steel\n'
		});
		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'materials',
			sheetName: 'materials',
			targetTable: 'materials',
			readiness: 'ready',
			summary: 'Materials',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'default_rate',
					targetField: 'default_rate',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'unit',
					targetField: 'unit',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'supplier',
					targetField: 'company_names',
					status: 'green',
					confidence: 'high',
					reason: 'Supplier relationship'
				}
			]
		});

		expect(preview.validRows).toEqual([
			expect.objectContaining({ name: 'Steel Plate', company_names: ['Acme Steel'] })
		]);
	});

	it('preserves every mapped material commercial field through preview validation', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'materials.csv',
			text:
				'name,unit,default_rate,currency,effective,verified,basis,lead,availability,reference\n' +
				'Steel Plate,kg,4.85,nzd,2026-01-01,2026-02-01,sell,2 weeks,in stock,SQ-12\n'
		});
		const fieldMap = {
			name: 'name',
			unit: 'unit',
			default_rate: 'default_rate',
			currency: 'currency_code',
			effective: 'effective_date',
			verified: 'verified_date',
			basis: 'rate_basis',
			lead: 'lead_time',
			availability: 'availability',
			reference: 'reference'
		} as const;
		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'materials',
			sheetName: 'materials',
			targetTable: 'materials',
			readiness: 'ready',
			summary: 'Materials',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: Object.entries(fieldMap).map(([sourceColumn, targetField]) => ({
				sourceColumn,
				targetField,
				status: 'green' as const,
				confidence: 'high' as const,
				reason: 'Direct match'
			}))
		});

		expect(preview.validRows[0]).toMatchObject({
			currency_code: 'NZD',
			effective_date: '2026-01-01',
			verified_date: '2026-02-01',
			rate_basis: 'sell',
			lead_time: '2 weeks',
			availability: 'in stock',
			reference: 'SQ-12'
		});
	});

	it('assigns combined CRM contact details to the expanded person record', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'crm.csv',
			text: 'company,contact,email,phone,role\nAcme Steel,Mina Hart,mina@acme.test,0414077617,Estimator\n'
		});
		const preview = previewSetupImportSheet(
			workbook.sheets[0],
			{
				sheetId: 'crm',
				sheetName: 'crm',
				targetTable: 'contacts',
				readiness: 'ready',
				summary: 'Companies',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					['company', 'display_name'],
					['contact', 'person_name'],
					['email', 'email'],
					['phone', 'phone'],
					['role', 'role_title']
				].map(([sourceColumn, targetField]) => ({
					sourceColumn,
					targetField,
					status: 'green' as const,
					confidence: 'high' as const,
					reason: 'Direct match'
				}))
			},
			{ workspaceCountryCode: 'AU' }
		);

		expect(preview.validRows).toHaveLength(2);
		expect(preview.validRows[0]).toMatchObject({ kind: 'company', display_name: 'Acme Steel' });
		expect(preview.validRows[0]).toMatchObject({ email: '', phone: '' });
		expect(preview.validRows[1]).toMatchObject({
			kind: 'person',
			display_name: 'Mina Hart',
			email: 'mina@acme.test',
			phone: '0414 077 617',
			role_title: 'Estimator'
		});
	});

	it('parses a CSV file into a single-sheet workbook payload', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'name,email,country_code\nAcme,hello@acme.test,AU\nBeta,beta@test.com,NZ\n'
		});

		expect(workbook.fileName).toBe('companies.csv');
		expect(workbook.sheets).toHaveLength(1);
		expect(workbook.sheets[0]).toEqual(
			expect.objectContaining({
				sheetId: 'companies',
				sheetName: 'companies',
				headers: ['name', 'email', 'country_code'],
				rowCount: 2,
				rows: [
					{ name: 'Acme', email: 'hello@acme.test', country_code: 'AU' },
					{ name: 'Beta', email: 'beta@test.com', country_code: 'NZ' }
				]
			})
		);
		expect(workbook.sheets[0].sampleRows).toEqual([
			{ name: 'Acme', email: 'hello@acme.test', country_code: 'AU' },
			{ name: 'Beta', email: 'beta@test.com', country_code: 'NZ' }
		]);
	});

	it('imports project structure template setup records', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'project-structure-templates.csv',
			text: readSetupImportFixture('project-structure-templates.csv')
		});
		const analysis = await analyseSetupImportWorkbook(workbook);
		expect(analysis.sheets[0]?.targetTable).toBe('project_structure_templates');
		const preview = previewSetupImportSheet(workbook.sheets[0]!, analysis.sheets[0]!);
		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({
				code: 'WBS-FAB',
				name: 'Fabrication Project',
				description: 'Standard fabrication project structure',
				is_active: true
			})
		]);
	});

	it('preserves quoted multiline CSV cells instead of splitting them into separate rows', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'name,notes,country_code\nAcme,"Line one\nLine two",AU\n'
		});

		expect(workbook.sheets).toHaveLength(1);
		expect(workbook.sheets[0]?.rowCount).toBe(1);
		expect(workbook.sheets[0]?.rows[0]).toEqual({
			name: 'Acme',
			notes: 'Line one\nLine two',
			country_code: 'AU'
		});
	});

	it('parses semicolon-delimited CSV files with quoted values', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'crew-rates.csv',
			text:
				'Crew Title;Rate per hr;UOM;Enabled\n' +
				'"Site Crew";"145.50";hr;yes\n' +
				'"Workshop Crew";"132.00";hr;yes\n'
		});

		expect(workbook.sheets).toHaveLength(1);
		expect(workbook.sheets[0]).toEqual(
			expect.objectContaining({
				headers: ['Crew Title', 'Rate per hr', 'UOM', 'Enabled'],
				rowCount: 2,
				rows: [
					{
						'Crew Title': 'Site Crew',
						'Rate per hr': '145.50',
						UOM: 'hr',
						Enabled: 'yes'
					},
					{
						'Crew Title': 'Workshop Crew',
						'Rate per hr': '132.00',
						UOM: 'hr',
						Enabled: 'yes'
					}
				]
			})
		);
	});

	it('detects the header row after export-title rows in messy CSV files', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'clients.csv',
			text:
				'Customer export generated 2026\n' +
				'Generated by Legacy ERP\n' +
				'Client Ref,Client Name,Country\n' +
				'CUST-001,Acme Fabrication Pty Ltd,AU\n'
		});

		expect(workbook.sheets).toHaveLength(1);
		expect(workbook.sheets[0]).toEqual(
			expect.objectContaining({
				headers: ['Client Ref', 'Client Name', 'Country'],
				rowCount: 1,
				rows: [
					{
						'Client Ref': 'CUST-001',
						'Client Name': 'Acme Fabrication Pty Ltd',
						Country: 'AU'
					}
				]
			})
		);
	});

	it('infers target tables from prefixed sheet names and preserves exact field-id mappings', async () => {
		const materialWorkbook = {
			fileName: 'bridge-smoke.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'bridge_materials',
					sheetName: 'Bridge Materials',
					headers: ['code', 'name', 'unit', 'default_rate', 'is_active'],
					headerIssues: [],
					headerRowNumber: 1,
					rowCount: 1,
					sourceRowNumbers: [2],
					rows: [
						{
							code: 'BR-M2',
							name: 'Bridge Plate',
							unit: 'm^2',
							default_rate: '45.25',
							is_active: 'yes'
						}
					],
					sampleRows: [
						{
							code: 'BR-M2',
							name: 'Bridge Plate',
							unit: 'm^2',
							default_rate: '45.25',
							is_active: 'yes'
						}
					]
				}
			]
		};
		const contactWorkbook = {
			fileName: 'bridge-smoke.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'bridge_companies',
					sheetName: 'Bridge Companies',
					headers: ['display_name', 'company_name', 'country_code'],
					headerIssues: [],
					headerRowNumber: 1,
					rowCount: 1,
					sourceRowNumbers: [2],
					rows: [
						{
							display_name: 'Bridge Test Fabrication',
							company_name: 'Bridge Test Fabrication',
							country_code: 'AU'
						}
					],
					sampleRows: [
						{
							display_name: 'Bridge Test Fabrication',
							company_name: 'Bridge Test Fabrication',
							country_code: 'AU'
						}
					]
				}
			]
		};
		const materialAnalysis = await analyseSetupImportWorkbook(materialWorkbook);
		const contactAnalysis = await analyseSetupImportWorkbook(contactWorkbook);
		const contactMappings = Object.fromEntries(
			contactAnalysis.sheets[0]?.mappings.map((mapping) => [mapping.sourceColumn, mapping]) ?? []
		);

		expect(materialAnalysis.sheets[0]).toEqual(
			expect.objectContaining({ targetTable: 'materials' })
		);
		expect(contactMappings.display_name).toEqual(
			expect.objectContaining({ targetField: 'display_name', status: 'green' })
		);
		expect(contactMappings.company_name).toEqual(
			expect.objectContaining({ targetField: 'company_name', status: 'green' })
		);
	});

	it('analyses the messy companies fixture with customer-style headers and mixed phone review', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies-directory-messy.csv',
			text: readSetupImportFixture('companies-directory-messy.csv')
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const mappings = Object.fromEntries(
			analysis.sheets[0]?.mappings.map((mapping) => [mapping.sourceColumn, mapping]) ?? []
		);

		expect(workbook.sheets[0]).toEqual(
			expect.objectContaining({
				headers: [
					'Client Ref',
					'Client Name',
					'Contact Person',
					'Email Address',
					'Mobile',
					'GST No',
					'Street Addr',
					'Country',
					'Memo'
				],
				rowCount: 2
			})
		);
		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'contacts',
				readiness: 'needs_review'
			})
		);
		expect(mappings['Client Name']).toEqual(
			expect.objectContaining({ targetField: 'display_name', status: 'green' })
		);
		expect(mappings['Contact Person']).toEqual(
			expect.objectContaining({ targetField: 'person_name', status: 'green' })
		);
		expect(mappings['Email Address']).toEqual(
			expect.objectContaining({ targetField: 'email', status: 'green' })
		);
		expect(mappings['Mobile']).toEqual(
			expect.objectContaining({ targetField: 'phone', status: 'yellow', confidence: 'medium' })
		);
	});

	it('flags duplicate spreadsheet headers as blocking sheet issues', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'name,name,country_code\nAcme,Secondary,AU\n'
		});

		expect(workbook.sheets).toHaveLength(1);
		expect(workbook.sheets[0]?.headerIssues).toEqual(
			expect.arrayContaining(['Duplicate column header: name'])
		);
	});

	it('maps material alias fixture columns into the materials table with semicolon aliases', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'materials-aliases.csv',
			text: readSetupImportFixture('materials-aliases.csv')
		});
		const analysis = await analyseSetupImportWorkbook(workbook);
		const preview = previewSetupImportSheet(workbook.sheets[0]!, analysis.sheets[0]!);
		const mappings = Object.fromEntries(
			analysis.sheets[0]?.mappings.map((mapping) => [mapping.sourceColumn, mapping]) ?? []
		);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'materials',
				readiness: 'ready'
			})
		);
		expect(mappings['Alt Names']).toEqual(
			expect.objectContaining({ targetField: 'aliases', status: 'green' })
		);
		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'MAT-PL-001',
					name: 'Plate 10mm Mild Steel',
					unit: 'm2',
					default_rate: 176.4,
					aliases: ['10mm plate', 'mild steel plate', 'stair plate']
				})
			])
		);
	});

	it('maps classification fixture aliases and default flags from a real fixture file', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'classification-systems.csv',
			text: readSetupImportFixture('classification-systems.csv')
		});
		const analysis = await analyseSetupImportWorkbook(workbook);
		const preview = previewSetupImportSheet(workbook.sheets[0]!, analysis.sheets[0]!);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'classification_systems',
				readiness: 'ready'
			})
		);
		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'FAB',
					name: 'Workshop Fabrication',
					classification_type: 'custom',
					is_default: true,
					aliases: ['steel coding', 'fabrication codes', 'workshop taxonomy']
				})
			])
		);
	});

	it('expands a real mixed company-and-person fixture into linked company and person rows', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'contacts-company-person.csv',
			text: readSetupImportFixture('contacts-company-person.csv')
		});
		const analysis = await analyseSetupImportWorkbook(workbook);
		const preview = previewSetupImportSheet(workbook.sheets[0]!, analysis.sheets[0]!);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'contacts',
				readiness: 'ready'
			})
		);
		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'company',
					display_name: 'Acme Fabrication Pty Ltd',
					contact_name: '',
					email: ''
				}),
				expect.objectContaining({
					kind: 'person',
					display_name: 'Mia Collins',
					company_name: 'Acme Fabrication Pty Ltd',
					email: 'estimating@acme.test',
					is_primary_company_contact: true,
					linked_company_id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}acme_fabrication_pty_ltd|au`
				}),
				expect.objectContaining({
					kind: 'company',
					display_name: 'Harbour Steelworks',
					contact_name: '',
					email: ''
				}),
				expect.objectContaining({
					kind: 'person',
					display_name: 'Rangi Te Aho',
					company_name: 'Harbour Steelworks',
					email: 'quotes@harboursteel.test',
					is_primary_company_contact: true,
					linked_company_id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}harbour_steelworks|nz`
				})
			])
		);
	});

	it('keeps valid material rows while flagging junk and blank rows from a real fixture file', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'materials.csv',
			text: readSetupImportFixture('materials-junk-rows.csv')
		});
		const analysis = await analyseSetupImportWorkbook(workbook);
		const preview = previewSetupImportSheet(workbook.sheets[0]!, analysis.sheets[0]!);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'materials',
				readiness: 'ready'
			})
		);
		expect(preview.validRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'MAT-PL-010',
					name: 'Floor Plate',
					unit: 'm2',
					default_rate: 185.5,
					aliases: ['plate flooring', 'floor plate']
				}),
				expect.objectContaining({
					code: 'MAT-BOLT',
					name: 'Anchor Bolt',
					unit: 'ea',
					default_rate: 12.75,
					aliases: ['fixing bolt']
				})
			])
		);
		expect(preview.skippedRowCount).toBe(0);
		expect(preview.errors).toEqual([
			expect.objectContaining({
				rowNumber: 4,
				messages: ['Name is blank in this row']
			})
		]);
	});

	it('parses an XLSX file into multiple workbook sheets', async () => {
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet([
				['code', 'name', 'default_rate', 'unit'],
				['MAT-001', 'Plate', 2.85, 'kg']
			]),
			'Materials'
		);
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet([
				['code', 'name', 'classification_type', 'is_default'],
				['MF', 'MasterFormat', 'masterformat', true]
			]),
			'Classifications'
		);

		const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
		const parsed = await parseSetupImportFile({
			fileName: 'setup.xlsx',
			bytes: new Uint8Array(bytes)
		});

		expect(parsed.sheets.map((sheet) => sheet.sheetName)).toEqual(['Materials', 'Classifications']);
		expect(parsed.sheets[0].headers).toEqual(['code', 'name', 'default_rate', 'unit']);
		expect(parsed.sheets[0].rows).toEqual([
			{ code: 'MAT-001', name: 'Plate', default_rate: '2.85', unit: 'kg' }
		]);
		expect(parsed.sheets[1].sampleRows[0]).toEqual({
			code: 'MF',
			name: 'MasterFormat',
			classification_type: 'masterformat',
			is_default: 'true'
		});
	});

	it('normalises XLSX dates and uses cached formula values deterministically', async () => {
		const workbook = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet(
			[
				['name', 'effective_date', 'default_rate'],
				['Steel Plate', new Date(Date.UTC(2026, 5, 30)), 0]
			],
			{ cellDates: true }
		);
		sheet.C2 = { t: 'n', f: '10+2.5', v: 12.5 };
		XLSX.utils.book_append_sheet(workbook, sheet, 'Materials');

		const parsed = await parseSetupImportFile({
			fileName: 'dates-and-formulas.xlsx',
			bytes: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: true })
		});

		expect(parsed.sheets[0]?.rows[0]).toEqual({
			name: 'Steel Plate',
			effective_date: '2026-06-30',
			default_rate: '12.5'
		});
	});

	it('analyses obvious customer mappings deterministically without model inference', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'clients.csv',
			text:
				'Client Ref,Country,Client Name,Contact Person,Email Address,Mobile,GST No,Street Addr,Memo,Legacy CRM Tag\n' +
				'CUST-001,AU,Acme Fabrication Pty Ltd,Mia Collins,estimating@acmefab.example,0412 555 100,51 123 456 789,14 Foundry Road,Prefers revs by email,A-tier\n' +
				'CUST-002,NZ,Harbour Steelworks,Rangi Te Aho,quotes@harboursteel.example,yes,98-765-432,22 Port Lane,Needs GST split shown,Needs review\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const mappings = Object.fromEntries(
			analysis.sheets[0]?.mappings.map((mapping) => [mapping.sourceColumn, mapping]) ?? []
		);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'contacts',
				readiness: 'needs_review'
			})
		);
		expect(mappings['Client Ref']).toEqual(
			expect.objectContaining({ targetField: 'business_id_value', status: 'green' })
		);
		expect(mappings['Country']).toEqual(
			expect.objectContaining({ targetField: 'country_code', status: 'green' })
		);
		expect(mappings['Client Name']).toEqual(
			expect.objectContaining({ targetField: 'display_name', status: 'green' })
		);
		expect(mappings['Contact Person']).toEqual(
			expect.objectContaining({ targetField: 'person_name', status: 'green' })
		);
		expect(mappings['Email Address']).toEqual(
			expect.objectContaining({ targetField: 'email', status: 'green' })
		);
		expect(mappings['GST No']).toEqual(
			expect.objectContaining({ targetField: 'tax_id_value', status: 'green' })
		);
		expect(mappings['Street Addr']).toEqual(
			expect.objectContaining({ targetField: 'address', status: 'green' })
		);
		expect(mappings['Memo']).toEqual(
			expect.objectContaining({ targetField: 'notes', status: 'green' })
		);
		expect(mappings['Legacy CRM Tag']).toEqual(
			expect.objectContaining({ targetField: null, status: 'ignored', confidence: 'low' })
		);
		expect(mappings['Mobile']).toEqual(
			expect.objectContaining({ targetField: 'phone', status: 'yellow', confidence: 'medium' })
		);
	});

	it('parses mapped cost preset payload JSON into preview rows', () => {
		const preview = previewSetupImportSheet(
			{
				sheetId: 'cost-presets',
				sheetName: 'Cost Presets',
				headers: ['Preset Name', 'Components JSON'],
				headerIssues: [],
				rowCount: 1,
				rows: [
					{
						'Preset Name': 'Fabrication Pack',
						'Components JSON':
							'[{"category":"labour","source_type":"manual","name":"Workshop Labour","description":"","quantity":1,"unit":"hr","unit_rate":95,"formula":{},"metadata":{},"sort_order":0}]'
					}
				],
				sampleRows: []
			},
			{
				sheetId: 'cost-presets',
				sheetName: 'Cost Presets',
				targetTable: 'cost_presets',
				readiness: 'ready',
				summary: 'Cost Presets',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'Preset Name',
						targetField: 'name',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'Components JSON',
						targetField: 'components_json',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					}
				]
			}
		);

		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({
				name: 'Fabrication Pack',
				components_json: [
					expect.objectContaining({
						category: 'labour',
						name: 'Workshop Labour',
						unit: 'hr',
						unit_rate: 95
					})
				]
			})
		]);
	});

	it('flags invalid estimate template payload JSON as a row issue', () => {
		const preview = previewSetupImportSheet(
			{
				sheetId: 'templates',
				sheetName: 'Templates',
				headers: ['Template Name', 'Estimate JSON'],
				headerIssues: [],
				rowCount: 1,
				rows: [
					{
						'Template Name': 'Starter Template',
						'Estimate JSON': '{"scope_summary":"Scope","notes":"Bad payload"}'
					}
				],
				sampleRows: []
			},
			{
				sheetId: 'templates',
				sheetName: 'Templates',
				targetTable: 'estimate_templates',
				readiness: 'ready',
				summary: 'Estimate Templates',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'Template Name',
						targetField: 'name',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'Estimate JSON',
						targetField: 'estimate_json',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					}
				]
			}
		);

		expect(preview.validRows).toEqual([]);
		expect(preview.errors).toEqual([
			expect.objectContaining({
				rowNumber: 2,
				messages: expect.arrayContaining([expect.stringContaining('Estimate data')])
			})
		]);
	});

	it('defers row validation until required mapping is complete', () => {
		const preview = previewSetupImportSheet(
			{
				sheetId: 'labour-rates',
				sheetName: 'Crew Rates',
				headers: ['Rate per hr'],
				headerIssues: [],
				rowCount: 2,
				rows: [{ 'Rate per hr': '92.5' }, { 'Rate per hr': '105' }],
				sampleRows: []
			},
			{
				sheetId: 'labour-rates',
				sheetName: 'Crew Rates',
				targetTable: 'labour_rates',
				readiness: 'blocked',
				summary: 'Labour Rates',
				unmatchedColumns: [],
				ignoredColumns: [],
				missingRequiredFields: ['name'],
				mappings: [
					{
						sourceColumn: 'Rate per hr',
						targetField: 'default_rate',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					}
				]
			}
		);

		expect(preview.validRows).toEqual([]);
		expect(preview.errors).toEqual([]);
		expect(preview.rowValidationDeferred).toBe(true);
		expect(preview.blocked).toBe(true);
	});

	it('auto-selects obvious target tables for multiple sheets locally', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'setup.xlsx',
			bytes: new Uint8Array(
				XLSX.write(
					(() => {
						const workbook = XLSX.utils.book_new();
						XLSX.utils.book_append_sheet(
							workbook,
							XLSX.utils.aoa_to_sheet([
								['Client Name', 'Country'],
								['Acme Fabrication Pty Ltd', 'AU']
							]),
							'Client Directory'
						);
						XLSX.utils.book_append_sheet(
							workbook,
							XLSX.utils.aoa_to_sheet([
								['SKU', 'Material Desc', 'UOM', 'Unit Cost', 'Enabled?'],
								['MAT-001', 'Hot Rolled Plate', 'kg', 2.85, 'yes']
							]),
							'Material Master'
						);
						return workbook;
					})(),
					{ type: 'buffer', bookType: 'xlsx' }
				)
			)
		});

		const analysis = await analyseSetupImportWorkbook(workbook);

		expect(analysis.sheets.find((sheet) => sheet.sheetName === 'Client Directory')).toEqual(
			expect.objectContaining({ targetTable: 'contacts' })
		);
		expect(analysis.sheets.find((sheet) => sheet.sheetName === 'Material Master')).toEqual(
			expect.objectContaining({ targetTable: 'materials' })
		);
	});

	it('matches dirty labour-rate headers with weighted fuzzy scoring', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'crew-rates.csv',
			text:
				'Crew Title,Rate per hr,UOM,Enabled\n' +
				'Site Crew,145.5,hr,yes\n' +
				'Workshop Crew,132,hr,yes\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const sheet = analysis.sheets[0];
		const mappings = Object.fromEntries(
			sheet?.mappings.map((mapping) => [mapping.sourceColumn, mapping]) ?? []
		);

		expect(sheet).toEqual(
			expect.objectContaining({
				targetTable: 'labour_rates',
				readiness: 'ready'
			})
		);
		expect(mappings['Crew Title']).toEqual(
			expect.objectContaining({ targetField: 'name', status: 'green' })
		);
		expect(mappings['Rate per hr']).toEqual(
			expect.objectContaining({ targetField: 'default_rate', status: 'green' })
		);
		expect(mappings['UOM']).toEqual(
			expect.objectContaining({ targetField: 'unit', status: 'green' })
		);
		expect(mappings['Enabled']).toEqual(
			expect.objectContaining({ targetField: 'is_active', status: 'green' })
		);
	});

	it('does not block labour-rate sheets when Active is omitted', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'crew-rates.csv',
			text: 'Crew Title,Rate per hr,UOM\nSite Crew,145.5,hr\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const sheet = analysis.sheets[0];

		expect(sheet).toEqual(
			expect.objectContaining({
				targetTable: 'labour_rates',
				readiness: 'ready',
				missingRequiredFields: []
			})
		);
	});

	it('does not block classification sheets when Type and Default are omitted', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'systems.csv',
			text: 'System Name,System Code\nFabrication,FAB\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const sheet = analysis.sheets[0];

		expect(sheet).toEqual(
			expect.objectContaining({
				targetTable: 'classification_systems',
				readiness: 'ready',
				missingRequiredFields: []
			})
		);
	});

	it('does not block cost-code sheets when Sort order is omitted', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'codes.csv',
			text: 'Cost Code,Description\n01,General\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const sheet = analysis.sheets[0];

		expect(sheet).toEqual(
			expect.objectContaining({
				targetTable: 'cost_codes',
				missingRequiredFields: []
			})
		);
		expect(sheet?.readiness).not.toBe('blocked');
	});

	it('prefers exact preset aliases so obvious cost-preset columns auto-map', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'presets.csv',
			text:
				'Preset Ref,Preset Name,Keywords,Enabled?,Components JSON\n' +
				'PRE-001,Standard Plate Assembly,starter; assembly,yes,[]\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const mappings = Object.fromEntries(
			analysis.sheets[0]?.mappings.map((mapping) => [mapping.sourceColumn, mapping]) ?? []
		);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'cost_presets'
			})
		);
		expect(mappings['Preset Name']).toEqual(
			expect.objectContaining({ targetField: 'name', status: 'green' })
		);
		expect(mappings['Preset Ref']).toEqual(
			expect.objectContaining({ targetField: 'code', status: 'green' })
		);
		expect(mappings['Keywords']).toEqual(
			expect.objectContaining({ targetField: 'aliases', status: 'green' })
		);
		expect(mappings['Enabled?']).toEqual(
			expect.objectContaining({ targetField: 'is_active', status: 'green' })
		);
		expect(mappings['Components JSON']).toEqual(
			expect.objectContaining({ targetField: 'components_json', status: 'green' })
		);
	});

	it('maps a real cost-preset fixture with aliases and components JSON', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'presets.csv',
			text: readSetupImportFixture('cost-presets-aliases.csv')
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const preview = previewSetupImportSheet(workbook.sheets[0]!, analysis.sheets[0]!);
		const mappings = Object.fromEntries(
			analysis.sheets[0]?.mappings.map((mapping) => [mapping.sourceColumn, mapping]) ?? []
		);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'cost_presets',
				readiness: 'ready'
			})
		);
		expect(mappings['Keywords']).toEqual(
			expect.objectContaining({ targetField: 'aliases', status: 'green' })
		);
		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'PRE-001',
					name: 'Standard Plate Assembly',
					aliases: ['starter', 'assembly'],
					is_active: true,
					components_json: []
				})
			])
		);
	});

	it('parses preset and template aliases as delimiter-flexible arrays', async () => {
		const presetWorkbook = await parseSetupImportFile({
			fileName: 'presets.csv',
			text: 'Preset Name,Keywords\nStarter Pack,"starter; pack, assembly\nfield install"\n'
		});
		const templateWorkbook = await parseSetupImportFile({
			fileName: 'templates.csv',
			text: 'Template Name,Keywords\nStair Package,"stairs; access, platform\nentry canopy"\n'
		});

		const presetPreview = previewSetupImportSheet(presetWorkbook.sheets[0], {
			sheetId: 'cost_presets',
			sheetName: 'cost_presets',
			targetTable: 'cost_presets',
			readiness: 'ready',
			summary: 'Cost Presets',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'Preset Name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'Keywords',
					targetField: 'aliases',
					status: 'green',
					confidence: 'high',
					reason: 'Alias field match'
				}
			]
		});
		const templatePreview = previewSetupImportSheet(templateWorkbook.sheets[0], {
			sheetId: 'estimate_templates',
			sheetName: 'estimate_templates',
			targetTable: 'estimate_templates',
			readiness: 'ready',
			summary: 'Estimate Templates',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'Template Name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'Keywords',
					targetField: 'aliases',
					status: 'green',
					confidence: 'high',
					reason: 'Alias field match'
				}
			]
		});

		expect(presetPreview.validRows[0]).toEqual(
			expect.objectContaining({ aliases: ['starter', 'pack', 'assembly', 'field install'] })
		);
		expect(templatePreview.validRows[0]).toEqual(
			expect.objectContaining({ aliases: ['stairs', 'access', 'platform', 'entry canopy'] })
		);
	});

	it('auto-ignores optional export columns once required fields are already covered', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'systems.csv',
			text:
				'System Ref,System Name,System Code,Family Type,Default?,Obsolete Flag\n' +
				'CLS-MF,Masterformat Fabrication,MFAB,masterformat,yes,legacy\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const mappings = Object.fromEntries(
			analysis.sheets[0]?.mappings.map((mapping) => [mapping.sourceColumn, mapping]) ?? []
		);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'classification_systems',
				readiness: 'ready'
			})
		);
		expect(mappings['System Name']).toEqual(
			expect.objectContaining({ targetField: 'name', status: 'green' })
		);
		expect(mappings['System Code']).toEqual(
			expect.objectContaining({ targetField: 'code', status: 'green' })
		);
		expect(mappings['Family Type']).toEqual(
			expect.objectContaining({ targetField: 'classification_type', status: 'green' })
		);
		expect(mappings['System Ref']).toEqual(
			expect.objectContaining({ targetField: null, status: 'ignored' })
		);
		expect(mappings['Obsolete Flag']).toEqual(
			expect.objectContaining({ targetField: null, status: 'ignored' })
		);
	});

	it('does not block mixed company-and-person contact sheets when kind is inferred locally', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'clients.csv',
			text:
				'Client Name,Contact Person,Email Address,Country\n' +
				'Acme Fabrication Pty Ltd,Mia Collins,estimating@acme.test,AU\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);

		expect(analysis.sheets[0]).toEqual(
			expect.objectContaining({
				targetTable: 'contacts',
				readiness: 'ready',
				missingRequiredFields: []
			})
		);
	});

	it('downgrades risky mapped contact fields to review when sample values are inconsistent', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'clients.csv',
			text:
				'Client Name,Country,Mobile\n' +
				'Acme Fabrication Pty Ltd,AU,0412 555 100\n' +
				'Harbour Steelworks,NZ,yes\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const mobileMapping = analysis.sheets[0]?.mappings.find(
			(mapping) => mapping.sourceColumn === 'Mobile'
		);

		expect(analysis.sheets[0]?.readiness).toBe('needs_review');
		expect(mobileMapping).toEqual(
			expect.objectContaining({
				targetField: 'phone',
				status: 'yellow',
				confidence: 'medium'
			})
		);
		expect(mobileMapping?.reason).toMatch(/review|value/i);
	});

	it('materialises and validates mapped customer rows locally', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'customer_email,name,country_code\nhello@acme.test,Acme,AU\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'contacts',
			sheetName: 'contacts',
			targetTable: 'contacts',
			readiness: 'ready',
			summary: 'Customer list',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'customer_email',
					targetField: 'email',
					status: 'green',
					confidence: 'high',
					reason: 'Synonym match'
				},
				{
					sourceColumn: 'name',
					targetField: 'display_name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'country_code',
					targetField: 'country_code',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				}
			]
		});

		expect(preview.validRows).toEqual([
			{
				kind: 'company',
				display_name: 'Acme',
				country_code: 'AU',
				name: 'Acme',
				company_name: '',
				contact_name: '',
				email: 'hello@acme.test',
				website: '',
				phone: '',
				phone_country_code: '',
				phone_e164: '',
				abn: '',
				business_id_label: '',
				business_id_value: '',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: '',
				is_primary_company_contact: false,
				tax_id_label: '',
				tax_id_value: '',
				address: '',
				notes: '',
				custom_role_label: '',
				roles: [],
				tags: [],
				is_active: true
			}
		]);
		expect(preview.errors).toEqual([]);
		expect(preview.blocked).toBe(false);
	});

	it('falls back to the workspace country when contact imports omit a country field', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'customer_email,name\nhello@acme.test,Acme\n'
		});

		const preview = previewSetupImportSheet(
			workbook.sheets[0],
			{
				sheetId: 'contacts',
				sheetName: 'contacts',
				targetTable: 'contacts',
				readiness: 'ready',
				summary: 'Customer list',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'customer_email',
						targetField: 'email',
						status: 'green',
						confidence: 'high',
						reason: 'Synonym match'
					},
					{
						sourceColumn: 'name',
						targetField: 'display_name',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					}
				]
			},
			{ workspaceCountryCode: 'NZ' }
		);

		expect(preview.validRows).toEqual([
			expect.objectContaining({
				display_name: 'Acme',
				country_code: 'NZ'
			})
		]);
		expect(preview.errors).toEqual([]);
	});

	it('defaults omitted classification_type and default flag for classification imports', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'classifications.csv',
			text: 'name,code\nFabrication,FAB\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'classifications',
			sheetName: 'Classifications',
			targetTable: 'classification_systems',
			readiness: 'ready',
			summary: 'Classification Systems',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'code',
					targetField: 'code',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				}
			]
		});

		expect(preview.validRows).toEqual([
			expect.objectContaining({
				name: 'Fabrication',
				code: 'FAB',
				classification_type: 'custom',
				is_default: false
			})
		]);
		expect(preview.errors).toEqual([]);
	});

	it('parses classification aliases as delimiter-flexible arrays', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'classifications.csv',
			text: 'name,code,classification_type,aliases\nFabrication,FAB,custom,"steel coding; fabrication codes, workshop taxonomy\nshop codes"\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'classifications',
			sheetName: 'Classifications',
			targetTable: 'classification_systems',
			readiness: 'ready',
			summary: 'Classification Systems',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'code',
					targetField: 'code',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'classification_type',
					targetField: 'classification_type',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'aliases',
					targetField: 'aliases',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				}
			]
		});

		expect(preview.validRows).toEqual([
			expect.objectContaining({
				name: 'Fabrication',
				code: 'FAB',
				classification_type: 'custom',
				aliases: ['steel coding', 'fabrication codes', 'workshop taxonomy', 'shop codes']
			})
		]);
		expect(preview.errors).toEqual([]);
	});

	it('handles a messy client-style fixture matrix across setup import target tables', async () => {
		const cases = [
			{
				fileName: 'contacts-legacy-crm.csv',
				targetTable: 'contacts',
				expectations: {
					readinessNot: 'blocked',
					mappings: {
						'Client Name': 'display_name',
						'Contact Person': 'person_name',
						'Account Code': 'business_id_value'
					}
				}
			},
			{
				fileName: 'contacts-personnel-register.csv',
				targetTable: 'contacts',
				expectations: {
					readinessNot: 'blocked',
					mappings: {
						'Company Name': 'company_name',
						'Job Title': 'role_title',
						'Primary Contact': 'is_primary_company_contact'
					}
				}
			},
			{
				fileName: 'materials-vendor-catalogue.csv',
				targetTable: 'materials',
				expectations: {
					row: {
						code: 'MAT-PL-012',
						name: 'Plate 12mm Mild Steel',
						unit: 'm2',
						default_rate: 182.4,
						aliases: ['12mm plate', 'floor plate', 'mild steel plate']
					}
				}
			},
			{
				fileName: 'labour-rates-crew-export.csv',
				targetTable: 'labour_rates',
				expectations: {
					row: {
						code: 'LAB-ERE',
						name: 'Erector Crew',
						unit: 'hr',
						default_rate: 96.5,
						aliases: ['erector', 'install crew']
					}
				}
			},
			{
				fileName: 'equipment-hire-catalogue.csv',
				targetTable: 'equipment_rates',
				expectations: {
					row: {
						code: 'EQ-CRANE',
						name: '20T Franna Crane',
						unit: 'hr',
						default_rate: 185,
						aliases: ['franna', 'pick-and-carry']
					}
				}
			},
			{
				fileName: 'subcontract-supplier-schedule.csv',
				targetTable: 'subcontract_rates',
				expectations: {
					row: {
						code: 'SUB-ENG',
						name: 'Structural Engineering Review',
						unit: 'ea',
						default_rate: 1250,
						aliases: ['engineer', 'engineering review']
					}
				}
			},
			{
				fileName: 'classification-systems-keywords.csv',
				targetTable: 'classification_systems',
				expectations: {
					row: {
						code: 'WST',
						name: 'Workshop Steel Taxonomy',
						classification_type: 'custom',
						is_default: true,
						aliases: ['steel coding', 'workshop classes', 'fabrication taxonomy']
					}
				}
			},
			{
				fileName: 'cost-codes-hierarchy-messy.csv',
				targetTable: 'cost_codes',
				expectations: {
					rows: [
						{ code: '01', name: 'General Requirements', sort_order: 10, is_active: true },
						{
							parent_id: '01',
							code: '01.10',
							name: 'Structural Steel',
							sort_order: 20,
							is_active: true
						}
					]
				}
			},
			{
				fileName: 'cost-presets-starter-library.csv',
				targetTable: 'cost_presets',
				expectations: {
					row: {
						code: 'PRE-START',
						name: 'Starter Install Pack',
						is_active: true,
						aliases: ['starter', 'install pack', 'canopy install'],
						components_json: []
					}
				}
			},
			{
				fileName: 'estimate-templates-seed-library.csv',
				targetTable: 'estimate_templates',
				expectations: {
					row: {
						code: 'TMP-CANOPY',
						name: 'Canopy Starter Template',
						is_active: true,
						aliases: ['canopy package', 'starter estimate']
					}
				}
			}
		] as const;

		for (const entry of cases) {
			const workbook = await parseSetupImportFile({
				fileName: entry.fileName,
				text: readSetupImportFixture(entry.fileName)
			});
			const analysis = await analyseSetupImportWorkbook(workbook);
			const sheetAnalysis = analysis.sheets[0];

			expect(sheetAnalysis?.targetTable).toBe(entry.targetTable);
			if ('readinessNot' in entry.expectations) {
				expect(sheetAnalysis?.readiness).not.toBe(entry.expectations.readinessNot);
			}

			if ('mappings' in entry.expectations) {
				const mappings = Object.fromEntries(
					sheetAnalysis?.mappings.map((mapping) => [mapping.sourceColumn, mapping.targetField]) ??
						[]
				);
				for (const [column, fieldId] of Object.entries(entry.expectations.mappings)) {
					expect(mappings[column]).toBe(fieldId);
				}
				continue;
			}

			const preview = previewSetupImportSheet(workbook.sheets[0]!, sheetAnalysis!);
			expect(preview.errors).toEqual([]);

			if ('row' in entry.expectations) {
				expect(preview.validRows).toEqual(
					expect.arrayContaining([expect.objectContaining(entry.expectations.row)])
				);
			}

			if ('rows' in entry.expectations) {
				expect(preview.validRows).toEqual(
					expect.arrayContaining(entry.expectations.rows.map((row) => expect.objectContaining(row)))
				);
			}
		}
	});

	it('defaults omitted cost code sort order to the source row index', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'codes.csv',
			text: 'code,name\n01,General\n02,Metals\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'codes',
			sheetName: 'Codes',
			targetTable: 'cost_codes',
			readiness: 'ready',
			summary: 'Cost Codes',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'code',
					targetField: 'code',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				}
			]
		});

		expect(preview.validRows).toEqual([
			expect.objectContaining({ code: '01', name: 'General', sort_order: 0, is_active: true }),
			expect.objectContaining({ code: '02', name: 'Metals', sort_order: 1, is_active: true })
		]);
		expect(preview.errors).toEqual([]);
	});

	it('excludes skipped rows from row validation and import previews', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'materials.csv',
			text: 'name,default_rate,unit\nPlate,2.85,kg\nBroken Rate,not sure,kg\n'
		});

		const preview = previewSetupImportSheet(
			workbook.sheets[0],
			{
				sheetId: 'materials',
				sheetName: 'materials',
				targetTable: 'materials',
				readiness: 'ready',
				summary: 'Materials',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'name',
						targetField: 'name',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					},
					{
						sourceColumn: 'default_rate',
						targetField: 'default_rate',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					},
					{
						sourceColumn: 'unit',
						targetField: 'unit',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					}
				]
			},
			{ skippedRowNumbers: [3] }
		);

		expect(preview.validRows).toHaveLength(1);
		expect(preview.errors).toEqual([]);
		expect(preview.skippedRowCount).toBe(1);
	});

	it('expands mixed contact rows into linked company and person records', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text:
				'Client Name,Contact Person,Email Address,Country,Street Addr\n' +
				'Acme Fabrication Pty Ltd,Mia Collins,estimating@acme.test,AU,14 Foundry Road\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'contacts',
			sheetName: 'contacts',
			targetTable: 'contacts',
			readiness: 'ready',
			summary: 'Client list',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'Client Name',
					targetField: 'display_name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'Contact Person',
					targetField: 'person_name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'Email Address',
					targetField: 'email',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'Country',
					targetField: 'country_code',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'Street Addr',
					targetField: 'address',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				}
			]
		});

		expect(preview.validRows).toHaveLength(2);
		expect(preview.validRows[0]).toEqual(
			expect.objectContaining({
				kind: 'company',
				display_name: 'Acme Fabrication Pty Ltd',
				name: 'Acme Fabrication Pty Ltd',
				contact_name: '',
				email: '',
				address: '14 Foundry Road'
			})
		);
		expect(preview.validRows[1]).toEqual(
			expect.objectContaining({
				kind: 'person',
				display_name: 'Mia Collins',
				name: 'Mia Collins',
				person_first_name: 'Mia',
				person_last_name: 'Collins',
				company_name: 'Acme Fabrication Pty Ltd',
				email: 'estimating@acme.test',
				is_primary_company_contact: true,
				linked_company_id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}acme_fabrication_pty_ltd|au`
			})
		);
	});

	it('reports row validation errors for invalid mapped rows', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'customer_email,name,country_code\nnot-an-email,Acme,AU\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'contacts',
			sheetName: 'contacts',
			targetTable: 'contacts',
			readiness: 'ready',
			summary: 'Customer list',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'customer_email',
					targetField: 'email',
					status: 'green',
					confidence: 'high',
					reason: 'Synonym match'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'country_code',
					targetField: 'country_code',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				}
			]
		});

		expect(preview.validRows).toEqual([]);
		expect(preview.errors).toHaveLength(1);
		expect(preview.errors[0].messages).toContain('Enter a valid email address');
		expect(preview.blocked).toBe(false);
	});

	it('blocks imported contact cells with multiple email candidates', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'customer_email,name,country_code\n  SALES@ACME.TEST ; Mia@Acme.Test  ,Acme,AU\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0]!, {
			sheetId: 'contacts',
			sheetName: 'contacts',
			targetTable: 'contacts',
			readiness: 'ready',
			summary: 'Customer list',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'customer_email',
					targetField: 'email',
					status: 'green',
					confidence: 'high',
					reason: 'Synonym match'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'country_code',
					targetField: 'country_code',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				}
			]
		});

		expect(preview.validRows).toEqual([]);
		expect(preview.errors[0]).toEqual(
			expect.objectContaining({
				messages: ['Email contains multiple possible values. Choose one email before importing.']
			})
		);
	});

	it('normalises single imported email values to trimmed lowercase output', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'customer_email,name,country_code\n  SALES@ACME.TEST  ,Acme,AU\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0]!, {
			sheetId: 'contacts',
			sheetName: 'contacts',
			targetTable: 'contacts',
			readiness: 'ready',
			summary: 'Customer list',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'customer_email',
					targetField: 'email',
					status: 'green',
					confidence: 'high',
					reason: 'Synonym match'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				},
				{
					sourceColumn: 'country_code',
					targetField: 'country_code',
					status: 'green',
					confidence: 'high',
					reason: 'Direct match'
				}
			]
		});

		expect(preview.validRows[0]).toEqual(
			expect.objectContaining({
				email: 'sales@acme.test'
			})
		);
	});

	it('formats imported contact phone values with the resolved contact country', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'name,country_code,phone\nAcme,AU,0414077617\n'
		});

		const preview = previewSetupImportSheet(
			workbook.sheets[0]!,
			{
				sheetId: workbook.sheets[0]!.sheetId,
				sheetName: workbook.sheets[0]!.sheetName,
				targetTable: 'contacts',
				readiness: 'ready',
				summary: 'Ready',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'name',
						targetField: 'display_name',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					},
					{
						sourceColumn: 'country_code',
						targetField: 'country_code',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					},
					{
						sourceColumn: 'phone',
						targetField: 'phone',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					}
				]
			},
			{ workspaceCountryCode: 'AU' }
		);

		expect(preview.validRows[0]).toEqual(
			expect.objectContaining({
				phone: '0414 077 617',
				country_code: 'AU'
			})
		);
	});

	it('uses the shared validators when normalising imported email and phone values', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text:
				'name,country_code,customer_email,phone\n' +
				'Acme,AU,"Primary@Acme.Test ; invalid-email","Call me on 0414077617 ext 5"\n'
		});

		const preview = previewSetupImportSheet(
			workbook.sheets[0]!,
			{
				sheetId: workbook.sheets[0]!.sheetId,
				sheetName: workbook.sheets[0]!.sheetName,
				targetTable: 'contacts',
				readiness: 'ready',
				summary: 'Ready',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'name',
						targetField: 'display_name',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					},
					{
						sourceColumn: 'country_code',
						targetField: 'country_code',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					},
					{
						sourceColumn: 'customer_email',
						targetField: 'email',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					},
					{
						sourceColumn: 'phone',
						targetField: 'phone',
						status: 'green',
						confidence: 'high',
						reason: 'Direct match'
					}
				]
			},
			{ workspaceCountryCode: 'AU' }
		);

		expect(preview.validRows[0]).toEqual(
			expect.objectContaining({
				email: 'primary@acme.test',
				phone: '0414 077 617'
			})
		);
	});

	it('uses user-facing field labels for required-field summaries and row issues', () => {
		expect(getSetupImportFieldLabel('contacts', 'kind')).toBe('Record kind');
		expect(getSetupImportFieldLabel('classification_systems', 'is_default')).toBe('Default');

		expect(
			formatSetupImportRowMessages('classification_systems', [
				{ fieldId: 'name', message: 'System name is required' },
				{
					fieldId: 'classification_type',
					message: 'Invalid option: expected one of "masterformat"|"uniformat"|"xactimate"|"custom"'
				}
			])
		).toEqual([
			'Name is blank in this row',
			'Type must be one of Masterformat, Uniformat, Xactimate, or Custom'
		]);
	});

	it('explains blank required values as row issues even when the column is matched', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'systems.csv',
			text: 'System Name,Family Type\nMasterFormat,masterformat\n,uniformat\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'systems',
			sheetName: 'Classification Systems',
			targetTable: 'classification_systems',
			readiness: 'ready',
			summary: 'Classification Systems',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'System Name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'Family Type',
					targetField: 'classification_type',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.validRows).toHaveLength(1);
		expect(preview.errors).toEqual([
			expect.objectContaining({
				rowNumber: 3,
				messages: ['Name is blank in this row']
			})
		]);
	});

	it('normalises classification_type casing before row validation', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'systems.csv',
			text: 'System Name,Family Type,Default?\nMasterformat Fabrication, MASTERFORMAT ,yes\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'systems',
			sheetName: 'Classification Systems',
			targetTable: 'classification_systems',
			readiness: 'ready',
			summary: 'Classification Systems',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'System Name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'Family Type',
					targetField: 'classification_type',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'Default?',
					targetField: 'is_default',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({
				name: 'Masterformat Fabrication',
				classification_type: 'masterformat',
				is_default: true
			})
		]);
	});

	it('normalises common labour and equipment unit synonyms before row validation', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'labour.csv',
			text:
				'Crew Title,Rate per hr,UOM,Enabled\n' +
				'Site Crew,145.5,Hours,yes\n' +
				'Workshop Crew,132,mins,y\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'labour',
			sheetName: 'Crew Rates',
			targetTable: 'labour_rates',
			readiness: 'ready',
			summary: 'Labour Rates',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'Crew Title',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'Rate per hr',
					targetField: 'default_rate',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'UOM',
					targetField: 'unit',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'Enabled',
					targetField: 'is_active',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({ name: 'Site Crew', unit: 'hr', is_active: true }),
			expect.objectContaining({ name: 'Workshop Crew', unit: 'min', is_active: true })
		]);
	});

	it('accepts weekly equipment units during preview before final import', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'equipment.csv',
			text: 'name,default_rate,unit\nCrane Weekly Hire,2400,Weekly\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'equipment',
			sheetName: 'Plant Hire',
			targetTable: 'equipment_rates',
			readiness: 'ready',
			summary: 'Equipment Rates',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'default_rate',
					targetField: 'default_rate',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'unit',
					targetField: 'unit',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({ name: 'Crane Weekly Hire', unit: 'week' })
		]);
	});

	it('blocks unsupported equipment units before apply', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'equipment.csv',
			text: 'name,default_rate,unit\nCrane Hire,2400,Fortnightly\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'equipment',
			sheetName: 'Plant Hire',
			targetTable: 'equipment_rates',
			readiness: 'ready',
			summary: 'Equipment Rates',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'default_rate',
					targetField: 'default_rate',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'unit',
					targetField: 'unit',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.validRows).toEqual([]);
		expect(preview.errors).toEqual([
			expect.objectContaining({
				rowNumber: 2,
				fieldIssues: [expect.objectContaining({ fieldId: 'unit' })]
			})
		]);
	});

	it('revalidates blocked rows when session-scoped row overrides are applied', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'systems.csv',
			text:
				'System Name,System Code,Family Type,Default?\n' +
				'Masterformat Fabrication,MFAB,masterformat,yes\n' +
				',WKSP,mystery,no\n'
		});

		const analysis = await analyseSetupImportWorkbook(workbook);
		const withoutOverrides = previewSetupImportSheet(workbook.sheets[0], analysis.sheets[0]);
		const withOverrides = previewSetupImportSheet(workbook.sheets[0], analysis.sheets[0], {
			3: { name: 'Workshop Custom', classification_type: 'custom' }
		});

		expect(withoutOverrides.validRows).toHaveLength(1);
		expect(withoutOverrides.errors).toEqual([
			expect.objectContaining({
				rowNumber: 3,
				fieldIssues: expect.arrayContaining([
					expect.objectContaining({ fieldId: 'name' }),
					expect.objectContaining({ fieldId: 'classification_type' })
				])
			})
		]);
		expect(withOverrides.errors).toEqual([]);
		expect(withOverrides.validRows).toEqual([
			expect.objectContaining({
				name: 'Masterformat Fabrication',
				classification_type: 'masterformat'
			}),
			expect.objectContaining({
				name: 'Workshop Custom',
				classification_type: 'custom'
			})
		]);
	});

	it('blocks preview when the source sheet has header issues', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'companies.csv',
			text: 'name,name,country_code\nAcme,Secondary,AU\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'contacts',
			sheetName: 'contacts',
			targetTable: 'contacts',
			readiness: 'blocked',
			summary: 'Header issues',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: []
		});

		expect(preview.validRows).toEqual([]);
		expect(preview.errors).toEqual([
			expect.objectContaining({
				rowNumber: 1,
				messages: expect.arrayContaining(['Duplicate column header: name'])
			})
		]);
		expect(preview.blocked).toBe(true);
	});

	it('blocks cost-code rows whose parent cannot be resolved before apply', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'codes.csv',
			text: 'code,name,parent_id\nCC-110,Child Code,CC-100\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'codes',
			sheetName: 'Codes',
			targetTable: 'cost_codes',
			readiness: 'ready',
			summary: 'Cost codes',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'code',
					targetField: 'code',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'parent_id',
					targetField: 'parent_id',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.validRows).toEqual([]);
		expect(preview.errors).toEqual([
			expect.objectContaining({
				rowNumber: 2,
				messages: [
					'Parent cost code "CC-100" must exist in this sheet or in the selected classification system.'
				],
				fieldIssues: [
					expect.objectContaining({
						fieldId: 'parent_id',
						message:
							'Parent cost code "CC-100" must exist in this sheet or in the selected classification system.'
					})
				]
			})
		]);
	});

	it('accepts cost-code rows when the parent already exists in the selected classification system', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'codes.csv',
			text: 'code,name,parent_id\nCC-110,Child Code,CC-100\n'
		});

		const preview = previewSetupImportSheet(
			workbook.sheets[0],
			{
				sheetId: 'codes',
				sheetName: 'Codes',
				targetTable: 'cost_codes',
				readiness: 'ready',
				summary: 'Cost codes',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'code',
						targetField: 'code',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'name',
						targetField: 'name',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'parent_id',
						targetField: 'parent_id',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					}
				]
			},
			{
				costCodeExistingCodes: [{ id: 'existing-parent', code: 'CC-100' }]
			}
		);

		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({
				code: 'CC-110',
				name: 'Child Code',
				parent_id: 'CC-100'
			})
		]);
	});

	it('blocks repeated import keys within the same workbook sheet', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'materials.csv',
			text: 'code,name,default_rate,unit\nMAT-001,Plate,2.85,kg\nMAT-001,Plate duplicate,3.00,kg\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'materials',
			sheetName: 'materials',
			targetTable: 'materials',
			readiness: 'ready',
			summary: 'Materials',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'code',
					targetField: 'code',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'default_rate',
					targetField: 'default_rate',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'unit',
					targetField: 'unit',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.validRows).toEqual([]);
		expect(preview.errors.map((error) => error.rowNumber)).toEqual([2, 3]);
		expect(preview.errors[0]?.messages[0]).toContain('same import key');
	});

	it('resolves person linked-company values against existing companies', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'people.csv',
			text: 'kind,display_name,company_name,email,country_code\nperson,Mia Steel,Acme Fabrication,mia@acme.test,AU\n'
		});

		const preview = previewSetupImportSheet(
			workbook.sheets[0],
			{
				sheetId: 'people',
				sheetName: 'people',
				targetTable: 'contacts',
				readiness: 'ready',
				summary: 'People',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'kind',
						targetField: 'kind',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'display_name',
						targetField: 'display_name',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'company_name',
						targetField: 'company_name',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'email',
						targetField: 'email',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'country_code',
						targetField: 'country_code',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					}
				]
			},
			{
				existingCompanyContacts: [
					{
						id: 'company-1',
						kind: 'company',
						display_name: 'Acme Fabrication',
						name: 'Acme Fabrication Pty Ltd',
						company_name: 'Acme Fabrication',
						business_id_value: 'ACME-001'
					}
				]
			}
		);

		expect(preview.errors).toEqual([]);
		expect(preview.validRows[0]).toEqual(
			expect.objectContaining({ kind: 'person', linked_company_id: 'company-1' })
		);
	});

	it('resolves person linked-company values against pending companies in the same sheet', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'people.csv',
			text:
				'kind,display_name,company_name,linked_company_id,email,country_code\n' +
				'company,Acme Fabrication,Acme Fabrication,,hello@acme.test,AU\n' +
				'person,Mia Steel,,Acme Fabrication,mia@acme.test,AU\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'people',
			sheetName: 'people',
			targetTable: 'contacts',
			readiness: 'ready',
			summary: 'People',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'kind',
					targetField: 'kind',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'display_name',
					targetField: 'display_name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'company_name',
					targetField: 'company_name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'linked_company_id',
					targetField: 'linked_company_id',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'email',
					targetField: 'email',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'country_code',
					targetField: 'country_code',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.errors).toEqual([]);
		expect(preview.validRows[1]).toEqual(
			expect.objectContaining({
				kind: 'person',
				linked_company_id: expect.stringContaining(SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX)
			})
		);
	});

	it('does not resolve a person link through a skipped pending company row', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'people.csv',
			text: 'kind,display_name,company_name,linked_company_id,email,country_code\ncompany,,Acme Pty Ltd,,bad-email,AU\nperson,Mia Steel,,Acme Pty Ltd,mia@acme.test,AU\n'
		});

		const preview = previewSetupImportSheet(
			workbook.sheets[0],
			{
				sheetId: 'people',
				sheetName: 'people',
				targetTable: 'contacts',
				readiness: 'ready',
				summary: 'People',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'kind',
						targetField: 'kind',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'display_name',
						targetField: 'display_name',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'company_name',
						targetField: 'company_name',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'linked_company_id',
						targetField: 'linked_company_id',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'email',
						targetField: 'email',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					},
					{
						sourceColumn: 'country_code',
						targetField: 'country_code',
						status: 'green',
						confidence: 'high',
						reason: 'Matched'
					}
				]
			},
			{ skippedRowNumbers: [2] }
		);

		expect(preview.validRows).toEqual([]);
		expect(preview.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fieldIssues: [expect.objectContaining({ fieldId: 'linked_company_id' })]
				})
			])
		);
	});

	it('allows same-named people under different companies', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'people.csv',
			text: 'kind,display_name,company_name,linked_company_id,email,country_code\ncompany,North Co,North Co,,,AU\ncompany,South Co,South Co,,,AU\nperson,Alex Smith,,North Co,,AU\nperson,Alex Smith,,South Co,,AU\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'people',
			sheetName: 'people',
			targetTable: 'contacts',
			readiness: 'ready',
			summary: 'People',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'kind',
					targetField: 'kind',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'display_name',
					targetField: 'display_name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'company_name',
					targetField: 'company_name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'linked_company_id',
					targetField: 'linked_company_id',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'email',
					targetField: 'email',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'country_code',
					targetField: 'country_code',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.validRows.map((row) => (row as { display_name?: string }).display_name)).toEqual(
			['North Co', 'South Co', 'Alex Smith', 'Alex Smith']
		);
		expect(preview.errors).toEqual([]);
	});

	it('blocks unresolved person linked-company values before apply', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'people.csv',
			text: 'kind,display_name,linked_company_id,email,country_code\nperson,Mia Steel,Missing Co,mia@missing.test,AU\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'people',
			sheetName: 'people',
			targetTable: 'contacts',
			readiness: 'ready',
			summary: 'People',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'kind',
					targetField: 'kind',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'display_name',
					targetField: 'display_name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'linked_company_id',
					targetField: 'linked_company_id',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'email',
					targetField: 'email',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'country_code',
					targetField: 'country_code',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.validRows).toEqual([]);
		expect(preview.errors[0]).toEqual(
			expect.objectContaining({
				fieldIssues: [expect.objectContaining({ fieldId: 'linked_company_id' })]
			})
		);
	});

	it('blocks duplicate labour and equipment names before SQLite unique-name constraints fail apply', async () => {
		const labourWorkbook = await parseSetupImportFile({
			fileName: 'labour.csv',
			text: 'code,name,category,work_center,unit,default_rate\nLAB-1,Bridge Crew,Site,North,hr,120\nLAB-2,Bridge Crew,Shop,South,hr,130\n'
		});
		const equipmentWorkbook = await parseSetupImportFile({
			fileName: 'equipment.csv',
			text: 'code,name,category,work_center,unit,default_rate\nEQ-1,Bridge Hoist,Plant,North,hr,80\nEQ-2,Bridge Hoist,Hire,South,hr,90\n'
		});

		const baseMappings = [
			{
				sourceColumn: 'code',
				targetField: 'code',
				status: 'green' as const,
				confidence: 'high' as const,
				reason: 'Matched'
			},
			{
				sourceColumn: 'name',
				targetField: 'name',
				status: 'green' as const,
				confidence: 'high' as const,
				reason: 'Matched'
			},
			{
				sourceColumn: 'category',
				targetField: 'category',
				status: 'green' as const,
				confidence: 'high' as const,
				reason: 'Matched'
			},
			{
				sourceColumn: 'work_center',
				targetField: 'work_center',
				status: 'green' as const,
				confidence: 'high' as const,
				reason: 'Matched'
			},
			{
				sourceColumn: 'unit',
				targetField: 'unit',
				status: 'green' as const,
				confidence: 'high' as const,
				reason: 'Matched'
			},
			{
				sourceColumn: 'default_rate',
				targetField: 'default_rate',
				status: 'green' as const,
				confidence: 'high' as const,
				reason: 'Matched'
			}
		];

		const labourPreview = previewSetupImportSheet(labourWorkbook.sheets[0], {
			sheetId: 'labour',
			sheetName: 'Labour',
			targetTable: 'labour_rates',
			readiness: 'ready',
			summary: 'Labour',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: baseMappings
		});
		const equipmentPreview = previewSetupImportSheet(equipmentWorkbook.sheets[0], {
			sheetId: 'equipment',
			sheetName: 'Equipment',
			targetTable: 'equipment_rates',
			readiness: 'ready',
			summary: 'Equipment',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: baseMappings
		});

		expect(labourPreview.validRows).toEqual([]);
		expect(equipmentPreview.validRows).toEqual([]);
		expect(labourPreview.errors.map((error) => error.rowNumber)).toEqual([2, 3]);
		expect(equipmentPreview.errors.map((error) => error.rowNumber)).toEqual([2, 3]);
	});

	it('normalises extra customer unit variants used in workbook exports', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'rates.csv',
			text: 'name,default_rate,unit\nSite Labour,120,$/hr\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'rates',
			sheetName: 'rates',
			targetTable: 'labour_rates',
			readiness: 'ready',
			summary: 'Rates',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'default_rate',
					targetField: 'default_rate',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'unit',
					targetField: 'unit',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.errors).toEqual([]);
		expect(preview.validRows[0]).toEqual(expect.objectContaining({ unit: 'hr' }));
	});

	it('infers cost-code parents from dotted child codes when explicit parents are omitted', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'codes.csv',
			text: 'code,name\n01,Division\n01.10,Section\n01.10.20,Item\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'codes',
			sheetName: 'codes',
			targetTable: 'cost_codes',
			readiness: 'ready',
			summary: 'Cost codes',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'code',
					targetField: 'code',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({ code: '01', parent_id: null }),
			expect.objectContaining({ code: '01.10', parent_id: '01' }),
			expect.objectContaining({ code: '01.10.20', parent_id: '01.10' })
		]);
	});

	it('infers cost-code parents from path columns when explicit parents are omitted', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'codes.csv',
			text: 'code,name,path\n01,Division,01\n01.10,Section,01 > 01.10\n01.10.20,Item,01 > 01.10 > 01.10.20\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'codes',
			sheetName: 'codes',
			targetTable: 'cost_codes',
			readiness: 'ready',
			summary: 'Cost codes',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'code',
					targetField: 'code',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({ code: '01', parent_id: null }),
			expect.objectContaining({ code: '01.10', parent_id: '01' }),
			expect.objectContaining({ code: '01.10.20', parent_id: '01.10' })
		]);
	});

	it('infers cost-code parents from level columns when explicit parents are omitted', async () => {
		const workbook = await parseSetupImportFile({
			fileName: 'codes.csv',
			text: 'code,name,level 1,level 2,level 3\n01,Division,01,,\n01.10,Section,01,01.10,\n01.10.20,Item,01,01.10,01.10.20\n'
		});

		const preview = previewSetupImportSheet(workbook.sheets[0], {
			sheetId: 'codes',
			sheetName: 'codes',
			targetTable: 'cost_codes',
			readiness: 'ready',
			summary: 'Cost codes',
			unmatchedColumns: [],
			missingRequiredFields: [],
			mappings: [
				{
					sourceColumn: 'code',
					targetField: 'code',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				},
				{
					sourceColumn: 'name',
					targetField: 'name',
					status: 'green',
					confidence: 'high',
					reason: 'Matched'
				}
			]
		});

		expect(preview.errors).toEqual([]);
		expect(preview.validRows).toEqual([
			expect.objectContaining({ code: '01', parent_id: null }),
			expect.objectContaining({ code: '01.10', parent_id: '01' }),
			expect.objectContaining({ code: '01.10.20', parent_id: '01.10' })
		]);
	});

	it('rejects oversized setup-import cells with clear workbook-limit errors', async () => {
		await expect(
			parseSetupImportFile({
				fileName: 'materials.csv',
				text: `name,default_rate,unit\n${'x'.repeat(2001)},1,ea\n`
			})
		).rejects.toThrow('contains a cell longer than 2000 characters');
	});

	it('keeps setup-import Rust apply statements aligned with alias-backed targets', () => {
		const rustSource = readFileSync(join(process.cwd(), 'src-tauri/src/db/commands.rs'), 'utf8');
		// Check each table assertion within the setup-import apply function context
		const setupFnIndex = rustSource.indexOf('fn apply_setup_import_session_command');
		expect(setupFnIndex).toBeGreaterThanOrEqual(0);
		const fnContext = rustSource.slice(setupFnIndex);
		for (const tableName of [
			'material_catalog_items',
			'labour_rate_cards',
			'equipment_rate_cards',
			'subcontract_rate_cards',
			'cost_component_presets',
			'estimate_templates',
			'classification_systems'
		]) {
			expect(fnContext).toContain(tableName);
			expect(fnContext).toContain('aliases_json');
		}
		expect(rustSource).toContain('json_field_to_string(data, "aliases", serde_json::json!([]))?');
	});

	it('forwards catalogue company links through the typed setup-import IPC payload', () => {
		const serviceSource = readFileSync(join(process.cwd(), 'src/lib/services/db.ts'), 'utf8');
		const methodStart = serviceSource.indexOf('async applySetupImportSession');
		const methodEnd = serviceSource.indexOf('async reorderProjects', methodStart);
		expect(methodStart).toBeGreaterThanOrEqual(0);
		expect(serviceSource.slice(methodStart, methodEnd)).toContain(
			'companyCatalogueLinks: payload.companyCatalogueLinks'
		);
	});
});
