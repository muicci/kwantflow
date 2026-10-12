import {
	equipmentRateCardFormSchema,
	labourRateCardFormSchema,
	materialCatalogItemFormSchema,
	type EquipmentRateCardFormValues,
	type LabourRateCardFormValues,
	type MaterialCatalogItemFormValues
} from '$lib/schemas/index.js';
import type {
	CatalogueImportError,
	CatalogueImportKind,
	CatalogueImportPreview
} from '$lib/types/index.js';

type CatalogueFormValues =
	MaterialCatalogItemFormValues | LabourRateCardFormValues | EquipmentRateCardFormValues;

const COLUMN_ALIASES: Record<CatalogueImportKind, Record<string, string>> = {
	material: {
		code: 'code',
		name: 'name',
		category: 'category',
		specification: 'specification',
		spec: 'specification',
		unit: 'unit',
		default_rate: 'default_rate',
		rate: 'default_rate',
		is_active: 'is_active',
		active: 'is_active'
	},
	'labour-rate': {
		code: 'code',
		name: 'name',
		category: 'category',
		work_center: 'work_center',
		'work centre': 'work_center',
		workcentre: 'work_center',
		unit: 'unit',
		default_rate: 'default_rate',
		rate: 'default_rate',
		is_active: 'is_active',
		active: 'is_active'
	},
	'equipment-rate': {
		code: 'code',
		name: 'name',
		category: 'category',
		work_center: 'work_center',
		'work centre': 'work_center',
		workcentre: 'work_center',
		unit: 'unit',
		default_rate: 'default_rate',
		rate: 'default_rate',
		is_active: 'is_active',
		active: 'is_active'
	}
};

function parseCsvLine(line: string): string[] {
	const values: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		const next = line[i + 1];

		if (char === '"') {
			if (inQuotes && next === '"') {
				current += '"';
				i += 1;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}

		if (char === ',' && !inQuotes) {
			values.push(current.trim());
			current = '';
			continue;
		}

		current += char;
	}

	values.push(current.trim());
	return values;
}

function normaliseHeaders(kind: CatalogueImportKind, headers: string[]): string[] {
	const aliases = COLUMN_ALIASES[kind];
	return headers.map(
		(header) => aliases[header.trim().toLowerCase()] ?? header.trim().toLowerCase()
	);
}

function parseBoolean(value: string | undefined): boolean {
	const normalized = (value ?? '').trim().toLowerCase();
	return ['1', 'true', 'yes', 'y'].includes(normalized);
}

function parseNumber(value: string | undefined): number {
	const sanitized = (value ?? '').replace(/[$,\s]/g, '');
	return Number(sanitized);
}

function buildRowRecord(headers: string[], values: string[]): Record<string, string> {
	return headers.reduce<Record<string, string>>((record, header, index) => {
		record[header] = values[index] ?? '';
		return record;
	}, {});
}

function formatZodMessages(error: {
	flatten(): { fieldErrors: Record<string, string[] | undefined> };
}): string[] {
	return Object.values(error.flatten().fieldErrors).flatMap((messages) => messages ?? []);
}

function previewMaterialImport(
	headers: string[],
	rows: string[][]
): CatalogueImportPreview<MaterialCatalogItemFormValues> {
	const errors: CatalogueImportError[] = [];
	const validRows: MaterialCatalogItemFormValues[] = [];

	rows.forEach((row, index) => {
		const raw = buildRowRecord(headers, row);
		const parsed = materialCatalogItemFormSchema.safeParse({
			code: raw.code ?? '',
			name: raw.name ?? '',
			category: raw.category ?? '',
			specification: raw.specification ?? '',
			unit: raw.unit ?? '',
			default_rate: parseNumber(raw.default_rate),
			is_active: parseBoolean(raw.is_active)
		});

		if (parsed.success) {
			validRows.push(parsed.data);
			return;
		}

		errors.push({
			rowNumber: index + 2,
			raw,
			messages: formatZodMessages(parsed.error)
		});
	});

	return {
		kind: 'material',
		headers,
		totalRows: rows.length,
		validRows,
		errors,
		warnings: []
	};
}

function previewLabourImport(
	headers: string[],
	rows: string[][]
): CatalogueImportPreview<LabourRateCardFormValues> {
	const errors: CatalogueImportError[] = [];
	const validRows: LabourRateCardFormValues[] = [];

	rows.forEach((row, index) => {
		const raw = buildRowRecord(headers, row);
		const parsed = labourRateCardFormSchema.safeParse({
			code: raw.code ?? '',
			name: raw.name ?? '',
			category: raw.category ?? '',
			work_center: raw.work_center ?? '',
			unit: raw.unit ?? '',
			default_rate: parseNumber(raw.default_rate),
			is_active: parseBoolean(raw.is_active)
		});

		if (parsed.success) {
			validRows.push(parsed.data);
			return;
		}

		errors.push({
			rowNumber: index + 2,
			raw,
			messages: formatZodMessages(parsed.error)
		});
	});

	return {
		kind: 'labour-rate',
		headers,
		totalRows: rows.length,
		validRows,
		errors,
		warnings: []
	};
}

function previewEquipmentImport(
	headers: string[],
	rows: string[][]
): CatalogueImportPreview<EquipmentRateCardFormValues> {
	const errors: CatalogueImportError[] = [];
	const validRows: EquipmentRateCardFormValues[] = [];

	rows.forEach((row, index) => {
		const raw = buildRowRecord(headers, row);
		const parsed = equipmentRateCardFormSchema.safeParse({
			code: raw.code ?? '',
			name: raw.name ?? '',
			category: raw.category ?? '',
			work_center: raw.work_center ?? '',
			unit: raw.unit ?? '',
			default_rate: parseNumber(raw.default_rate),
			is_active: parseBoolean(raw.is_active)
		});

		if (parsed.success) {
			validRows.push(parsed.data);
			return;
		}

		errors.push({
			rowNumber: index + 2,
			raw,
			messages: formatZodMessages(parsed.error)
		});
	});

	return {
		kind: 'equipment-rate',
		headers,
		totalRows: rows.length,
		validRows,
		errors,
		warnings: []
	};
}

export function previewCatalogueImport(
	kind: 'material',
	csvText: string
): CatalogueImportPreview<MaterialCatalogItemFormValues>;
export function previewCatalogueImport(
	kind: 'labour-rate',
	csvText: string
): CatalogueImportPreview<LabourRateCardFormValues>;
export function previewCatalogueImport(
	kind: 'equipment-rate',
	csvText: string
): CatalogueImportPreview<EquipmentRateCardFormValues>;
export function previewCatalogueImport(
	kind: CatalogueImportKind,
	csvText: string
): CatalogueImportPreview<CatalogueFormValues> {
	const lines = csvText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	if (lines.length === 0) {
		return {
			kind,
			headers: [],
			totalRows: 0,
			validRows: [],
			errors: [],
			warnings: ['The selected CSV file is empty.']
		};
	}

	const headers = normaliseHeaders(kind, parseCsvLine(lines[0]));
	const rows = lines.slice(1).map((line) => parseCsvLine(line));

	switch (kind) {
		case 'material':
			return previewMaterialImport(headers, rows);
		case 'labour-rate':
			return previewLabourImport(headers, rows);
		case 'equipment-rate':
			return previewEquipmentImport(headers, rows);
	}
}
