/* eslint-disable preserve-caught-error */ // Local workspace schema v2.
// Codebase review improvements: Standardized JSON parsing with JsonStringSchema, optimized sequential database operations with Promise.all, and ensured SQLite boolean compatibility (0/1).
import { storeService } from './store.js';
import { JsonStringSchema } from '../schemas/index.js';
import { invoke } from '@tauri-apps/api/core';
import { NativeDatabase } from './native-database.js';
import { resolveLocalDocumentPath } from './local-documents.js';
import { copyFile, mkdir, remove } from '@tauri-apps/plugin-fs';
import { isTauri } from '../utils/env';
import { MOCK_PROJECTS } from '../mocks/projects';
import {
	APP_VERSION,
	ONBOARDING_OPERATOR_ROLES,
	PriorityLevel,
	ProjectStatus,
	SUPPORTED_CURRENCY_CODES,
	SUPPORTED_DATE_FORMATS,
	SUPPORTED_LANGUAGE_LOCALES,
	SUPPORTED_NUMBER_LOCALES,
	getGeneralFileThumbnailPriority,
	getCurrencySymbol,
	inferGeneralFileMimeType,
	type SupportedCurrencyCode,
	getWorkspaceCountryLanguageLocale,
	getWorkspaceCountryMeasurementUnit,
	getWorkspaceCountryNumberLocale,
	getWorkspaceCountryProfile,
	getWorkspaceCountryTaxDefaults,
	normaliseEquipmentRateUnitCode,
	normaliseLabourRateUnitCode,
	normaliseMaterialUnitCode,
	normaliseSubcontractRateUnitCode,
	normaliseUnitCode
} from '../constants/index.js';
import {
	projectWorkspacePath,
	VAULT_ROOT,
	workspaceVaultRelativePath
} from '../constants/index.js';
import type { OptionalSetupPageId } from '$lib/constants/setup-page-visibility.js';
import {
	removeDerivedPreviewCacheForSource,
	removePreparedEvidenceCacheForSource
} from './assets.js';
import { normaliseEmailValue } from './email.js';
import {
	normaliseReusableEstimatePayload,
	normaliseReusablePresetComponents
} from '$lib/utils/estimate-template-normalisation.js';
import {
	ProjectArraySchema,
	AssetArraySchema,
	AssetFileArraySchema,
	ContactSchema,
	WorkspaceIdentityRowSchema,
	WorkspaceProfileRowSchema,
	WorkspaceAiKnowledgeFileRowSchema,
	WorkspaceAiFeedbackEntryRowSchema,
	WorkspaceOnboardingProfileRowSchema,
	WorkspaceMemberRowSchema,
	RuntimeContractStateRowSchema,
	EstimateRowSchema,
	EstimateRowArraySchema,
	EstimateSummaryArraySchema,
	ClassificationSystemRowSchema,
	ClassificationSystemRowArraySchema,
	CostCodeRowSchema,
	CostCodeRowArraySchema,
	WbsNodeRowSchema,
	WbsNodeRowArraySchema,
	TakeoffItemRowArraySchema,
	CostComponentRowArraySchema,
	MaterialCatalogueItemRowSchema,
	MaterialCatalogueItemRowArraySchema,
	LabourRateCardRowSchema,
	LabourRateCardRowArraySchema,
	EquipmentRateCardRowSchema,
	EquipmentRateCardRowArraySchema,
	SubcontractRateCardRowSchema,
	SubcontractRateCardRowArraySchema,
	CostComponentPresetRowSchema,
	CostComponentPresetRowArraySchema,
	EstimateTemplateRowSchema,
	EstimateTemplateRowArraySchema,
	ProjectStructureTemplateRowSchema,
	ProjectStructureTemplateRowArraySchema,
	ProjectStructureTemplateNodeRowArraySchema,
	QuoteOptionPresetRowSchema,
	QuoteOptionPresetRowArraySchema,
	QuoteOptionRowArraySchema,
	QuoteRevisionRowArraySchema,
	QuoteRevisionOptionRowArraySchema,
	AiRunRowSchema,
	AiRunInputRowSchema,
	AiTaskSummaryRowArraySchema,
	AiRunOutputRowSchema,
	AiEvidenceRefRowArraySchema,
	AiReviewEventRowArraySchema,
	AiOverrideEventRowArraySchema,
	type ContactFormValues,
	type MaterialCatalogItemFormValues,
	type LabourRateCardFormValues,
	type EquipmentRateCardFormValues,
	type SubcontractRateCardFormValues,
	type ClassificationSystemFormValues,
	type CostCodeFormValues,
	type WbsNodeFormValues,
	type CostComponentPresetFormValues,
	type EstimateTemplateFormValues,
	type ProjectStructureTemplateFormValues,
	type QuoteOptionFormValues,
	type QuoteOptionPresetFormValues
} from '../schemas/index.js';
import type {
	Project,
	Asset,
	AssetFile,
	ExplorerPreviewFile,
	Estimate,
	EstimateSummary,
	TakeoffItem,
	CostComponent,
	Contact,
	WorkspaceIdentity,
	WorkspaceProfile,
	WorkspaceAiFeedbackEntry,
	WorkspaceAiKnowledgeFile,
	WorkspaceOnboardingProfile,
	WorkspaceMember,
	ClassificationSystem,
	CostCode,
	WbsNode,
	MaterialCatalogueItem,
	LabourRateCard,
	EquipmentRateCard,
	SubcontractRateCard,
	CostComponentPreset,
	EstimateTemplate,
	ProjectStructureTemplate,
	ProjectStructureTemplateNode,
	QuoteOption,
	QuoteOptionPreset,
	QuoteRevision,
	CreateQuoteRevisionInput,
	AiRun,
	AiRunInput,
	AiTaskSummary,
	AiRunOutput,
	IncidentAiRunFailure,
	IncidentAssistantActionFailure,
	ProductUsageSnapshotAggregate,
	AiEvidenceRef,
	AiReviewEvent,
	AiOverrideEvent,
	SearchResultRow,
	CatalogueRecordCompanyLinksResult,
	CompanyCatalogueLinksResult,
	LinkedCompanySummary
} from '$lib/types/index.js';
import { getProjectContactDisplayName, normaliseContactName } from '$lib/utils/project-contact.js';
import { resolvePersonNameParts } from '$lib/utils/person-name.js';
import {
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	sql,
	type Dialect,
	type Driver,
	type DatabaseConnection,
	type TransactionSettings,
	type QueryResult,
	type CompiledQuery
} from 'kysely';
import type { DB, FxRateSnapshotRow, RuntimeContractStateRow } from '../types/db.js';
import type { LocalAssistantSourceRecordScope } from '../types/index.js';
import { normalizePositiveDecimalString } from '../utils/math.js';
import {
	assertRuntimeSchemaHealth,
	inspectRuntimeSchemaHealth,
	inspectRuntimeContractVersion,
	type RuntimeSchemaHealthReport
} from './db-schema-health.js';
import { CURRENT_APP_SCHEMA_VERSION } from '$lib/constants/index.js';
import { createLogger } from './logger.js';
import { normalisePhoneValue } from './phone.js';
import type { SetupImportCostPresetRow, SetupImportEstimateTemplateRow } from './setup-import.js';

type ProjectWorkspaceFileSeed = {
	id: string;
	file_path: string;
	original_name: string;
	byte_size?: number;
	content_hash?: string | null;
	document_type?: string;
	revision_label?: string;
	received_at?: string | null;
	source_label?: string;
	source_metadata?: Record<string, unknown>;
};

type SetupImportAction = 'create' | 'update';

type SetupImportEntityOperation<T> = {
	id: string;
	action: SetupImportAction;
	mappedFields: string[];
	data: T;
};

type SetupImportClassificationSystemOperation =
	SetupImportEntityOperation<ClassificationSystemFormValues> & {
		clientKey: string;
	};

type SetupImportCostCodeOperation = SetupImportEntityOperation<CostCodeFormValues> & {
	classificationSystemId: string;
};

type SetupImportCompanyCatalogueLink = {
	scope: 'materials' | 'labour_rates' | 'equipment_rates' | 'subcontract_rates';
	recordId: string;
	companyId: string;
};

export type SetupImportSessionPayload = {
	audit: {
		id: string;
		sourceFileName: string;
		sourceContentHash: string;
		importedSheetIds: string[];
		duplicateModesJson: string;
		createdCount: number;
		updatedCount: number;
		skippedCount: number;
		failureSummary: string | null;
	};
	contacts: SetupImportEntityOperation<ContactFormValues>[];
	materials: SetupImportEntityOperation<MaterialCatalogItemFormValues>[];
	labourRates: SetupImportEntityOperation<LabourRateCardFormValues>[];
	equipmentRates: SetupImportEntityOperation<EquipmentRateCardFormValues>[];
	subcontractRates: SetupImportEntityOperation<SubcontractRateCardFormValues>[];
	costPresets: SetupImportEntityOperation<SetupImportCostPresetRow>[];
	estimateTemplates: SetupImportEntityOperation<SetupImportEstimateTemplateRow>[];
	projectStructureTemplates: SetupImportEntityOperation<ProjectStructureTemplateFormValues>[];
	classificationSystems: SetupImportClassificationSystemOperation[];
	costCodes: SetupImportCostCodeOperation[];
	companyCatalogueLinks: SetupImportCompanyCatalogueLink[];
};

export type AssistantApprovedContactActionOperation = {
	id: string;
	action: 'create' | 'update';
	recordId?: string;
	data: ContactFormValues;
};

export type AssistantApprovedContactsBundlePayload = {
	proposalId: string;
	turnId: string;
	toolName: string;
	actions: AssistantApprovedContactActionOperation[];
};

export type AssistantApprovedContactsBundleResult = {
	status: 'succeeded' | 'failed';
	successCount: number;
	failureCount: number;
	errors: string[];
};

export type AssistantApprovedRecordProposalSetPayload = {
	proposalSetId: string;
	turnId: string;
	items: Array<{
		proposalId: string;
		scope: LocalAssistantSourceRecordScope;
		action: 'create' | 'update';
		recordId?: string;
		fields: Record<string, unknown>;
	}>;
};

const log = createLogger('dbService');

const isMissingPathError = (error: unknown): boolean => {
	const message = String(error ?? '').toLowerCase();
	return (
		message.includes('not found') ||
		message.includes('does not exist') ||
		message.includes('path not found') ||
		message.includes('enoent')
	);
};

const LOCAL_WORKSPACE_ID = 'local-workspace';

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

async function sha256Text(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function inferPayloadContractVersion(payload: Record<string, unknown>): string {
	const version = payload.version ?? payload.contractVersion ?? payload.contract_version;
	if (typeof version === 'string') return version;
	const promptVersion = payload.systemInstructionVersion ?? payload.extractionPromptVersion;
	return typeof promptVersion === 'string' ? promptVersion : '';
}
const LOCAL_PRIMARY_MEMBER_ID = 'primary-member';
const DEFAULT_WORKSPACE_NAME = 'Workspace';
const LOCAL_ONBOARDING_VERSION = 1;
const READ_ONLY_PREVIEW_PATH_PATTERN = /^\/preview(?:\/|$)/;
const SUPPORTED_CURRENCY_CODE_SET = new Set<string>(SUPPORTED_CURRENCY_CODES);
const DEFAULT_QUOTE_PAYMENT_TERMS = 'Payment Terms: Due on receipt.';
const DEFAULT_QUOTE_VALIDITY_DAYS = 30;
const DEFAULT_QUOTE_NUMBER_PREFIX = 'Q';
const DEFAULT_QUOTE_NUMBER_FORMAT = '{prefix}-{yyyy}-{seq}';
const SUPPORTED_DATE_FORMAT_SET = new Set<string>(SUPPORTED_DATE_FORMATS);
const SUPPORTED_LANGUAGE_LOCALE_SET = new Set<string>(SUPPORTED_LANGUAGE_LOCALES);
const SUPPORTED_NUMBER_LOCALE_SET = new Set<string>(SUPPORTED_NUMBER_LOCALES);
const SUPPORTED_MEASUREMENT_UNIT_SET = new Set<string>(['Metric', 'Imperial']);

export type DatabaseInitializationFailureKind =
	'update_required' | 'repair_required' | 'initialization_error';

export class DatabaseInitializationError extends Error {
	constructor(
		public readonly kind: DatabaseInitializationFailureKind,
		message: string,
		public readonly cause: unknown
	) {
		super(message);
		this.name = 'DatabaseInitializationError';
	}
}

export function classifyDatabaseInitializationError(error: unknown): DatabaseInitializationError {
	const message = String(error);

	if (/Unsupported (?:control|workspace) database schema version/.test(message)) {
		return new DatabaseInitializationError(
			'update_required',
			'This local workspace was last opened by a newer Kwantflow build. Install the latest app build before continuing.',
			error
		);
	}

	if (
		message.includes('Local database schema is missing required runtime tables or columns') ||
		message.includes('no such table:') ||
		message.includes('no such column:')
	) {
		return new DatabaseInitializationError(
			'repair_required',
			'Local database schema is incomplete for this build. Use a compatible app build or restore a verified backup before continuing. Your existing data has been preserved.',
			error
		);
	}

	return new DatabaseInitializationError(
		'initialization_error',
		message.trim() || 'Kwantflow could not open the local workspace database.',
		error
	);
}

function stringifyJson(value: Record<string, unknown> | undefined): string {
	return JSON.stringify(value ?? {});
}

function stringifyJsonArray<T>(value: T[] | undefined): string {
	return JSON.stringify(value ?? []);
}

function normaliseCountryCode(value: string | null | undefined): string {
	const normalised = value?.trim().toUpperCase() ?? '';
	return /^[A-Z]{2}$/.test(normalised) ? normalised : 'AU';
}

function normaliseOptionalText(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

function buildWorkspaceRegionalDefaults(countryCode: string): {
	countryCode: string;
	businessIdLabel: string;
	taxIdLabel: string;
	taxDisplayLabel: string;
	taxRatePercentage: number;
	currencyCode: string;
	currencySymbol: string;
	dateFormat: string;
	languageLocale: string;
	numberLocale: string;
	measurementUnit: WorkspaceProfile['measurementUnit'];
	phoneCountryCode: string;
} {
	const profile = getWorkspaceCountryProfile(normaliseCountryCode(countryCode));
	const taxDefaults = getWorkspaceCountryTaxDefaults(profile.code);
	return {
		countryCode: profile.code,
		businessIdLabel: profile.businessIdLabel,
		taxIdLabel: profile.taxIdLabel,
		taxDisplayLabel: taxDefaults.taxDisplayLabel,
		taxRatePercentage: taxDefaults.taxRatePercentage,
		currencyCode: profile.currencyCode,
		currencySymbol: getCurrencySymbol(profile.currencyCode),
		dateFormat: profile.dateFormat,
		languageLocale: getWorkspaceCountryLanguageLocale(profile.code),
		numberLocale: getWorkspaceCountryNumberLocale(profile.code),
		measurementUnit: getWorkspaceCountryMeasurementUnit(profile.code),
		phoneCountryCode: profile.phoneCountryCode
	};
}

function normalisePhoneForWorkspace(phone: string | null | undefined, countryCode: string) {
	// Keep DB-owned phone snapshots aligned with the shared UI formatter/parser contract.
	return normalisePhoneValue(phone, normaliseCountryCode(countryCode));
}

function isReadOnlyPreviewWindowContext(): boolean {
	if (typeof window === 'undefined') return false;
	return READ_ONLY_PREVIEW_PATH_PATTERN.test(window.location?.pathname ?? '');
}

type EstimateReferenceIndex = {
	classificationSystemIds: Set<string>;
	costCodeToClassificationId: Map<string, string>;
	costComponentPresetIds: Set<string>;
	estimateTemplateIds: Set<string>;
	materialSourceIds: Set<string>;
	labourSourceIds: Set<string>;
	equipmentSourceIds: Set<string>;
	subcontractSourceIds: Set<string>;
};

type PersistableTakeoffItem = {
	item: TakeoffItem;
	sortOrder: number;
};

function resolvePersistableTakeoffItems(items: TakeoffItem[]): PersistableTakeoffItem[] {
	const entries = items.map((item, sortOrder) => ({ item, sortOrder }));
	const byId = new Map(entries.map((entry) => [entry.item.id, entry] as const));
	const ordered: PersistableTakeoffItem[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();

	const visit = (itemId: string): void => {
		if (visited.has(itemId)) return;
		if (visiting.has(itemId)) {
			throw new Error(`Takeoff items contain a parent cycle at ${itemId}`);
		}

		const entry = byId.get(itemId);
		if (!entry) {
			throw new Error(`Takeoff item ${itemId} is missing from the estimate payload`);
		}

		visiting.add(itemId);
		const parentId = entry.item.parent_id;
		if (parentId) {
			if (!byId.has(parentId)) {
				throw new Error(
					`Takeoff item "${entry.item.name}" references a missing parent "${parentId}"`
				);
			}
			visit(parentId);
		}
		visiting.delete(itemId);
		visited.add(itemId);
		ordered.push(entry);
	};

	for (const entry of entries) {
		visit(entry.item.id);
	}

	return ordered;
}

function unwrapRollbackFollowupError(error: unknown): unknown {
	let current = error;
	while (current instanceof Error && current.cause) {
		const message = current.message.toLowerCase();
		if (
			message.includes('cannot rollback') ||
			message.includes('no transaction is active') ||
			message.includes('no such savepoint')
		) {
			current = current.cause;
			continue;
		}
		break;
	}
	return current;
}

export class TauriSqlDriver implements Driver {
	constructor(private db: NativeDatabase) {}
	async init(): Promise<void> {}
	async acquireConnection(): Promise<DatabaseConnection> {
		return new TauriSqlConnection(this.db);
	}
	private getConnection(connection: DatabaseConnection): TauriSqlConnection {
		if (!(connection instanceof TauriSqlConnection)) {
			throw new Error('TauriSqlDriver received an unexpected database connection instance');
		}
		return connection;
	}

	async beginTransaction(
		connection: DatabaseConnection,
		settings: TransactionSettings
	): Promise<void> {
		void settings;
		await this.getConnection(connection).beginTransaction();
	}

	async commitTransaction(connection: DatabaseConnection): Promise<void> {
		await this.getConnection(connection).commitTransaction();
	}

	async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
		await this.getConnection(connection).rollbackTransaction();
	}

	async releaseConnection(connection: DatabaseConnection): Promise<void> {
		void connection;
	}
	async destroy(): Promise<void> {}
}

export class TauriSqlConnection implements DatabaseConnection {
	constructor(private db: NativeDatabase) {}
	async executeStatement(sql: string, parameters: readonly unknown[] = []): Promise<void> {
		await this.db.execute(sql, [...parameters]);
	}
	async beginTransaction(): Promise<void> {
		throw new Error(
			'Frontend transactions are unsupported over request-scoped database IPC. Use a typed Rust command instead.'
		);
	}
	async commitTransaction(): Promise<void> {
		throw new Error(
			'Frontend transactions are unsupported over request-scoped database IPC. Use a typed Rust command instead.'
		);
	}
	async rollbackTransaction(): Promise<void> {
		throw new Error(
			'Frontend transactions are unsupported over request-scoped database IPC. Use a typed Rust command instead.'
		);
	}
	async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
		const parameters = compiledQuery.parameters as unknown[];
		const sql = compiledQuery.sql.trim();
		const isReadQuery = /^(select|pragma|with)\b/i.test(sql);

		if (isReadQuery) {
			const rows = await this.db.select<R[]>(compiledQuery.sql, parameters);
			return {
				rows,
				numAffectedRows: BigInt(rows.length)
			};
		}

		const result = await this.db.execute(compiledQuery.sql, parameters);
		return {
			rows: [] as R[],
			numAffectedRows: BigInt(result.rowsAffected),
			insertId: BigInt(result.lastInsertId ?? 0)
		};
	}
	async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
		throw new Error('Streaming not supported in Tauri SQL plugin');
		yield undefined as never; // Satisfy generator requirement
	}
}

class TauriSqlDialect implements Dialect {
	constructor(private db: NativeDatabase) {}
	createAdapter() {
		return new SqliteAdapter();
	}
	createDriver() {
		return new TauriSqlDriver(this.db);
	}
	createIntrospector(db: Kysely<DB>) {
		return new SqliteIntrospector(db);
	}
	createQueryCompiler() {
		return new SqliteQueryCompiler();
	}
}

const mockProjectsMap = new Map<string, Project>(MOCK_PROJECTS.map((p) => [p.id, p]));

/**
 * KwantflowDatabase — The Single Authority for all SQLite operations.
 */
class KwantflowDatabase {
	private db: NativeDatabase | null = null;
	private kysely: Kysely<DB> | null = null;
	private dbName: string | null = null;
	private initPromise: Promise<void> | null = null;
	private readOnlyDbPromise: Promise<NativeDatabase> | null = null;
	private _workspaceCurrencyCode: SupportedCurrencyCode | null = null;
	private connectionGeneration = 0;

	private writeLock: Promise<void> = Promise.resolve();

	// Frontend serialisation only. Atomic multi-step desktop writes must use typed Rust commands.
	private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
		const previous = this.writeLock;
		let release: () => void;
		this.writeLock = new Promise<void>((r) => {
			release = r;
		});
		await previous;
		try {
			await storeService.waitForBackupWrites();
			return await fn();
		} finally {
			release!();
		}
	}

	getDatabasePath(): string | null {
		return this.dbName;
	}

	adoptActiveWorkspace(workspaceId: string): void {
		if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) {
			throw new Error('Invalid active workspace ID.');
		}
		const normalisedPath = `sqlite:workspaces/${workspaceId}/workspace.db`;
		if (normalisedPath === this.dbName) return;
		this.db = null;
		this.kysely = null;
		this.readOnlyDbPromise = null;
		this.initPromise = null;
		this.dbName = normalisedPath;
		this.connectionGeneration += 1;
	}

	private async loadDatabaseWithCurrentBaseline(): Promise<NativeDatabase> {
		return new NativeDatabase('workspace');
	}

	private async getReadOnlyDatabase(): Promise<NativeDatabase> {
		if (this.db) {
			return this.db;
		}
		if (isReadOnlyPreviewWindowContext()) {
			if (!this.readOnlyDbPromise) {
				this.readOnlyDbPromise = Promise.resolve(new NativeDatabase('workspace')).catch((error) => {
					this.readOnlyDbPromise = null;
					throw error;
				});
			}
			return await this.readOnlyDbPromise;
		}
		if (this.initPromise) {
			await this.initPromise;
			if (this.db) {
				return this.db;
			}
		}
		await this.init();
		if (this.db) {
			return this.db;
		}
		if (!this.readOnlyDbPromise) {
			this.readOnlyDbPromise = Promise.resolve(new NativeDatabase('workspace')).catch((error) => {
				this.readOnlyDbPromise = null;
				throw error;
			});
		}
		return await this.readOnlyDbPromise;
	}

	private async withReadOnlyDatabase<T>(fn: (db: NativeDatabase) => Promise<T>): Promise<T> {
		return await fn(await this.getReadOnlyDatabase());
	}

	private async syncRuntimeContractState(db: NativeDatabase): Promise<void> {
		await db.execute(
			`INSERT INTO runtime_contract_state (
				id,
				schema_version,
				last_opened_app_version,
				minimum_supported_app_version,
				contract_status,
				last_checked_at
			) VALUES ($1, $2, $3, $4, $5, datetime('now'))
			ON CONFLICT(id) DO UPDATE SET
				schema_version = excluded.schema_version,
				last_opened_app_version = excluded.last_opened_app_version,
				contract_status = excluded.contract_status,
				last_checked_at = datetime('now'),
				updated_at = datetime('now')`,
			['primary', CURRENT_APP_SCHEMA_VERSION, APP_VERSION, null, 'ready']
		);

		const rows = await db.select<Array<Record<string, unknown>>>(
			'SELECT * FROM runtime_contract_state WHERE id = $1 LIMIT 1',
			['primary']
		);
		RuntimeContractStateRowSchema.parse(rows[0] as RuntimeContractStateRow);
	}
	private runtimeSchemaProfile(): 'workspace' {
		return 'workspace';
	}

	async init() {
		if (this.db && this.kysely) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			if (!isTauri()) {
				log.warn('Native database IPC is unavailable. Running in mock mode.');
				return;
			}
			const schemaProfile = this.runtimeSchemaProfile();
			if (this.db || this.kysely) {
				log.warn('Partial database initialization detected. Resetting connection state.');
				this.db = null;
				this.kysely = null;
			}
			try {
				const readOnlyPreview = isReadOnlyPreviewWindowContext();
				const db = this.readOnlyDbPromise
					? await this.readOnlyDbPromise
					: await this.loadDatabaseWithCurrentBaseline();
				if (this.readOnlyDbPromise) {
					this.readOnlyDbPromise = null;
				}
				await assertRuntimeSchemaHealth(db, schemaProfile);
				if (!readOnlyPreview) {
					await this.syncRuntimeContractState(db);
				}
				this.db = db;
				this.kysely = new Kysely<DB>({
					dialect: new TauriSqlDialect(db)
				});
				log.info('Database initialized with Kysely.');
			} catch (err) {
				this.db = null;
				this.kysely = null;
				const classifiedError = classifyDatabaseInitializationError(err);
				log.error(
					`Failed to initialise database (${classifiedError.kind}): ${classifiedError.message}`
				);
				if (classifiedError.cause && classifiedError.cause !== classifiedError.message) {
					log.error(`Database init technical details: ${classifiedError.cause}`);
				}
				throw classifiedError;
			}
		})();

		try {
			await this.initPromise;
		} finally {
			this.initPromise = null;
		}
	}

	async getRuntimeSchemaHealthReport(): Promise<RuntimeSchemaHealthReport> {
		if (!isTauri()) {
			return {
				ok: true,
				missingTables: [],
				missingColumns: []
			};
		}

		const db = this.db ?? (await this.loadDatabaseWithCurrentBaseline());
		try {
			return await inspectRuntimeSchemaHealth(db, this.runtimeSchemaProfile());
		} finally {
			if (!this.db) {
				await db.close();
			}
		}
	}

	async getRuntimeDatabaseDiagnostics(): Promise<{
		appVersion: string;
		bundledSchemaVersion: number;
		runtimeSchemaVersion: number | null;
		schema: RuntimeSchemaHealthReport;
	}> {
		if (!isTauri()) {
			return {
				appVersion: APP_VERSION,
				bundledSchemaVersion: CURRENT_APP_SCHEMA_VERSION,
				runtimeSchemaVersion: CURRENT_APP_SCHEMA_VERSION,
				schema: {
					ok: true,
					missingTables: [],
					missingColumns: []
				}
			};
		}

		const db = this.db ?? (await this.loadDatabaseWithCurrentBaseline());
		try {
			const schemaProfile = this.runtimeSchemaProfile();
			const [schema, runtimeSchemaVersion] = await Promise.all([
				inspectRuntimeSchemaHealth(db, schemaProfile),
				inspectRuntimeContractVersion(db)
			]);

			return {
				appVersion: APP_VERSION,
				bundledSchemaVersion: CURRENT_APP_SCHEMA_VERSION,
				runtimeSchemaVersion,
				schema
			};
		} finally {
			if (!this.db) {
				await db.close();
			}
		}
	}

	async close(): Promise<void> {
		this.initPromise = null;
		this.connectionGeneration += 1;
		if (!this.db) {
			this.kysely = null;
			this.readOnlyDbPromise = null;
			return;
		}

		try {
			await this.db.close();
		} catch (err) {
			log.warn(`Failed to close database cleanly: ${err}`);
		} finally {
			this.db = null;
			this.kysely = null;
			this.readOnlyDbPromise = null;
		}
	}

	private mapWorkspaceIdentityRow(row: unknown): WorkspaceIdentity {
		const parsed = WorkspaceIdentityRowSchema.parse(row);
		return {
			id: parsed.id,
			bootstrapCompletedAt: parsed.bootstrap_completed_at,
			onboardingCompletedAt: parsed.onboarding_completed_at,
			onboardingVersion: parsed.onboarding_version,
			workspaceRole: parsed.workspace_role,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		};
	}

	private mapContactRow(row: unknown): Contact {
		const source = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
		const parsed = ContactSchema.safeParse({
			...source,
			roles:
				typeof source.roles_json === 'string'
					? source.roles_json
					: Array.isArray(source.roles)
						? source.roles
						: '[]',
			tags:
				typeof source.tags_json === 'string'
					? source.tags_json
					: Array.isArray(source.tags)
						? source.tags
						: '[]',
			custom_role_label:
				typeof source.custom_role_label === 'string' ? source.custom_role_label : null
		});
		if (!parsed.success) {
			log.error(`Failed to parse contact row ${String(source.id ?? 'unknown')}`, parsed.error);
			throw parsed.error;
		}
		return parsed.data;
	}

	private mapContactRows(rows: unknown[]): Contact[] {
		return rows.map((row) => this.mapContactRow(row));
	}

	private mapWorkspaceProfileRow(row: unknown): WorkspaceProfile {
		const parsed = WorkspaceProfileRowSchema.parse(row);
		const businessContactName = resolvePersonNameParts({
			firstName: parsed.business_contact_first_name,
			lastName: parsed.business_contact_last_name,
			displayName: parsed.business_contact_name
		});
		return {
			workspaceId: parsed.workspace_id,
			displayName: parsed.display_name,
			countryCode: parsed.country_code,
			businessName: parsed.business_name,
			logoFilePath: parsed.logo_file_path,
			aiPlaybookText: parsed.ai_playbook_text,
			emailSignature: parsed.email_signature,
			abn: parsed.business_id_label === 'ABN' ? parsed.business_id_value : (parsed.abn ?? ''),
			businessIdLabel: parsed.business_id_label,
			businessIdValue: parsed.business_id_value,
			taxIdLabel: parsed.tax_id_label,
			taxIdValue: parsed.tax_id_value,
			taxDisplayLabel: parsed.tax_display_label,
			taxRatePercentage: parsed.tax_rate_percentage,
			businessAddress: parsed.business_address,
			businessContactName: businessContactName.displayName,
			businessContactFirstName: businessContactName.firstName,
			businessContactLastName: businessContactName.lastName,
			businessContactEmail: parsed.business_contact_email,
			businessContactPhone: parsed.business_contact_phone,
			businessContactPhoneE164: parsed.business_contact_phone_e164,
			businessContactPhoneCountryCode: parsed.business_contact_phone_country_code,
			currencyCode: parsed.currency_code,
			currencySymbol: parsed.currency_symbol,
			measurementUnit: parsed.measurement_unit as WorkspaceProfile['measurementUnit'],
			dateFormat: parsed.date_format,
			languageLocale: parsed.language_locale,
			numberLocale: parsed.number_locale,
			quotePaymentTerms: parsed.quote_payment_terms,
			quoteValidityDays: parsed.quote_validity_days,
			quoteDefaultInclusions: parsed.quote_default_inclusions,
			quoteDefaultExclusions: parsed.quote_default_exclusions,
			quoteDefaultTerms: parsed.quote_default_terms,
			quoteNumberPrefix: parsed.quote_number_prefix,
			quoteNumberFormat: parsed.quote_number_format,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		};
	}

	private mapWorkspaceAiKnowledgeFileRow(row: unknown): WorkspaceAiKnowledgeFile {
		const parsed = WorkspaceAiKnowledgeFileRowSchema.parse(row);
		return {
			id: parsed.id,
			workspaceId: parsed.workspace_id,
			filePath: parsed.file_path,
			originalName: parsed.original_name,
			mimeType: parsed.mime_type,
			byteSize: parsed.byte_size,
			extractedText: parsed.extracted_text,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		};
	}

	private mapWorkspaceAiFeedbackEntryRow(row: unknown): WorkspaceAiFeedbackEntry {
		const parsed = WorkspaceAiFeedbackEntryRowSchema.parse(row);
		return {
			id: parsed.id,
			workspaceId: parsed.workspace_id,
			runId: parsed.run_id,
			assetId: parsed.asset_id,
			estimateId: parsed.estimate_id,
			feedbackText: parsed.feedback_text,
			created_at: parsed.created_at
		};
	}

	private mapWorkspaceOnboardingProfileRow(row: unknown): WorkspaceOnboardingProfile {
		const parsed = WorkspaceOnboardingProfileRowSchema.parse(row);
		return {
			workspaceId: parsed.workspace_id,
			primaryOperatorRole: parsed.primary_operator_role,
			industry: parsed.industry,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		};
	}

	private mapWorkspaceMemberRow(row: unknown): WorkspaceMember {
		const parsed = WorkspaceMemberRowSchema.parse(row);
		const memberName = resolvePersonNameParts({
			firstName: parsed.first_name,
			lastName: parsed.last_name,
			displayName: parsed.display_name
		});
		return {
			id: parsed.id,
			workspaceId: parsed.workspace_id,
			role: parsed.role,
			displayName: memberName.displayName,
			firstName: memberName.firstName,
			lastName: memberName.lastName,
			email: parsed.email,
			avatarPath: parsed.avatar_path,
			isPrimary: parsed.is_primary,
			joinedAt: parsed.joined_at,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		};
	}

	private mapAiRunRow(row: unknown): AiRun {
		const parsed = AiRunRowSchema.parse(row);
		return {
			id: parsed.id,
			asset_id: parsed.asset_id,
			provider: parsed.provider,
			model_id: parsed.model_id,
			status: parsed.status,
			trigger_source: parsed.trigger_source,
			started_at: parsed.started_at,
			completed_at: parsed.completed_at,
			failed_at: parsed.failed_at,
			cancelled_at: parsed.cancelled_at,
			error_message: parsed.error_message,
			usage: parsed.usage_json,
			prompt_contract_version: parsed.prompt_contract_version,
			context_fingerprint: parsed.context_fingerprint,
			failure_kind: parsed.failure_kind,
			failure_stage: parsed.failure_stage,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		};
	}

	private async getNextProjectSortOrder(workspaceId: string): Promise<number> {
		// Prepend new projects at the top (sort_order = 0) and bump existing ones
		await this.kysely!.updateTable('projects')
			.set((eb) => ({ sort_order: eb('sort_order', '+', 1) }))
			.where('workspace_id', '=', workspaceId)
			.execute();
		return 0;
	}

	private async getNextContactSortOrder(workspaceId: string): Promise<number> {
		const row = await this.kysely!.selectFrom('contacts')
			.select(({ fn }) => fn.max<number>('sort_order').as('max_sort_order'))
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		return (row?.max_sort_order ?? -1) + 1;
	}

	private async validateOrderedIds(
		table: 'projects' | 'contacts',
		workspaceId: string,
		orderedIds: string[]
	): Promise<void> {
		const rows = await this.kysely!.selectFrom(table)
			.select('id')
			.where('workspace_id', '=', workspaceId)
			.execute();
		const existingIds = rows.map((row) => row.id);

		if (existingIds.length !== orderedIds.length) {
			throw new Error('Manual order does not match the current record set');
		}

		const existingIdSet = new Set(existingIds);
		if (orderedIds.some((id) => !existingIdSet.has(id))) {
			throw new Error('Manual order includes rows outside the current record set');
		}
	}

	private normalizeContactFormData(data: ContactFormValues): ContactFormValues {
		const contactData = data;
		const countryCode = normaliseCountryCode(data.country_code);
		const regionalDefaults = buildWorkspaceRegionalDefaults(countryCode);
		const phone = normalisePhoneForWorkspace(data.phone?.trim() ?? '', countryCode);
		const rawTags = Array.isArray(contactData.tags) ? contactData.tags : [];
		const normalizedTags: string[] = Array.from(
			new Set(rawTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))
		);
		const rawRoles = Array.isArray(contactData.roles)
			? contactData.roles
			: (['customer'] as ContactFormValues['roles']);
		const normalizedRoles: ContactFormValues['roles'] = Array.from(
			new Set(rawRoles.filter(Boolean))
		);
		const personName = [contactData.person_first_name?.trim(), contactData.person_last_name?.trim()]
			.filter(Boolean)
			.join(' ')
			.trim();
		const companyName = contactData.company_name?.trim() ?? '';
		const displayName =
			contactData.display_name?.trim() || data.name?.trim() || companyName || personName;
		const kind: ContactFormValues['kind'] = contactData.kind ?? 'company';
		const isCompany = kind === 'company';
		return {
			kind,
			country_code: countryCode,
			display_name: displayName.replace(/\s+/g, ' '),
			name: displayName.replace(/\s+/g, ' '),
			company_name: isCompany ? companyName : '',
			person_first_name: contactData.person_first_name?.trim() ?? '',
			person_last_name: contactData.person_last_name?.trim() ?? '',
			role_title: contactData.role_title?.trim() ?? '',
			linked_company_id: isCompany ? '' : contactData.linked_company_id?.trim() || '',
			is_primary_company_contact: Boolean(contactData.is_primary_company_contact),
			contact_name: '',
			email: normaliseEmailValue(data.email),
			phone: phone.displayPhone,
			phone_country_code: phone.phoneCountryCode,
			phone_e164: phone.e164,
			abn: isCompany ? (data.abn?.trim() ?? '') : '',
			business_id_label: (data.business_id_label?.trim() || regionalDefaults.businessIdLabel).slice(
				0,
				100
			),
			business_id_value: isCompany ? (data.business_id_value?.trim() ?? '') : '',
			tax_id_label: (data.tax_id_label?.trim() || regionalDefaults.taxIdLabel).slice(0, 100),
			tax_id_value: isCompany ? (data.tax_id_value?.trim() ?? '') : '',
			website: isCompany ? (data.website?.trim() ?? '') : '',
			address: isCompany ? (data.address?.trim() ?? '') : '',
			notes: isCompany ? (data.notes?.trim() ?? '') : '',
			logo_file_path: isCompany ? (data.logo_file_path?.trim() ?? '') : '',
			custom_role_label: isCompany ? (data.custom_role_label?.trim() ?? '') : '',
			roles: isCompany ? normalizedRoles : [],
			tags: isCompany ? normalizedTags : [],
			is_active: contactData.is_active ?? true
		};
	}

	private normalizeMaterialCatalogueItemFormData(data: MaterialCatalogItemFormValues) {
		return {
			code: this.normalizeCodeValue(data.code),
			name: data.name.trim().replace(/\s+/g, ' '),
			category: data.category?.trim().replace(/\s+/g, ' ') ?? '',
			specification: data.specification?.trim() ?? '',
			aliases: this.normalizeAliasValues(data.aliases),
			unit: normaliseMaterialUnitCode(data.unit) ?? 'ea',
			default_rate: data.default_rate,
			currency_code: data.currency_code ?? this.resolveWorkspaceCurrencySync(),
			effective_date: data.effective_date || '',
			verified_date: data.verified_date || '',
			rate_basis: data.rate_basis ?? 'cost',
			lead_time: data.lead_time?.trim() ?? '',
			availability: data.availability?.trim() ?? '',
			reference: data.reference?.trim() ?? '',
			is_active: data.is_active
		};
	}

	private normalizeLabourRateCardFormData(data: LabourRateCardFormValues) {
		return {
			code: this.normalizeCodeValue(data.code),
			name: data.name.trim().replace(/\s+/g, ' '),
			category: data.category?.trim().replace(/\s+/g, ' ') ?? '',
			work_center: data.work_center?.trim() ?? '',
			aliases: this.normalizeAliasValues(data.aliases),
			unit: normaliseLabourRateUnitCode(data.unit) ?? 'hr',
			default_rate: data.default_rate,
			currency_code: data.currency_code ?? this.resolveWorkspaceCurrencySync(),
			effective_date: data.effective_date || '',
			verified_date: data.verified_date || '',
			rate_basis: data.rate_basis ?? 'cost',
			lead_time: data.lead_time?.trim() ?? '',
			availability: data.availability?.trim() ?? '',
			reference: data.reference?.trim() ?? '',
			is_active: data.is_active
		};
	}

	private normalizeEquipmentRateCardFormData(data: EquipmentRateCardFormValues) {
		return {
			code: this.normalizeCodeValue(data.code),
			name: data.name.trim().replace(/\s+/g, ' '),
			category: data.category?.trim().replace(/\s+/g, ' ') ?? '',
			work_center: data.work_center?.trim() ?? '',
			aliases: this.normalizeAliasValues(data.aliases),
			unit: normaliseEquipmentRateUnitCode(data.unit) ?? 'hr',
			default_rate: data.default_rate,
			currency_code: data.currency_code ?? this.resolveWorkspaceCurrencySync(),
			effective_date: data.effective_date || '',
			verified_date: data.verified_date || '',
			rate_basis: data.rate_basis ?? 'cost',
			lead_time: data.lead_time?.trim() ?? '',
			availability: data.availability?.trim() ?? '',
			reference: data.reference?.trim() ?? '',
			is_active: data.is_active
		};
	}

	private normalizeSubcontractRateCardFormData(data: SubcontractRateCardFormValues) {
		return {
			code: this.normalizeCodeValue(data.code),
			name: data.name.trim().replace(/\s+/g, ' '),
			category: data.category?.trim().replace(/\s+/g, ' ') ?? '',
			aliases: this.normalizeAliasValues(data.aliases),
			unit: normaliseSubcontractRateUnitCode(data.unit) ?? 'lot',
			default_rate: data.default_rate,
			currency_code: data.currency_code ?? this.resolveWorkspaceCurrencySync(),
			effective_date: data.effective_date || '',
			verified_date: data.verified_date || '',
			rate_basis: data.rate_basis ?? 'cost',
			lead_time: data.lead_time?.trim() ?? '',
			availability: data.availability?.trim() ?? '',
			reference: data.reference?.trim() ?? '',
			is_active: data.is_active
		};
	}

	private normalizeAliasValues(values: string[] | undefined): string[] {
		const rawValues = Array.isArray(values) ? values : [];
		return Array.from(
			new Set(
				rawValues
					.map((value) => value.trim().replace(/\s+/g, ' '))
					.filter((value) => value.length > 0)
			)
		);
	}

	private normalizeClassificationSystemFormData(
		data: ClassificationSystemFormValues
	): ClassificationSystemFormValues {
		return {
			name: data.name.trim().replace(/\s+/g, ' '),
			code: this.normalizeCodeValue(data.code),
			classification_type: data.classification_type,
			aliases: this.normalizeAliasValues(data.aliases),
			is_default: data.is_default
		};
	}

	private normalizeCostCodeFormData(data: CostCodeFormValues): CostCodeFormValues {
		return {
			parent_id: data.parent_id || null,
			code: this.normalizeCodeValue(data.code),
			name: data.name.trim().replace(/\s+/g, ' '),
			description: data.description?.trim() ?? '',
			is_active: data.is_active,
			sort_order: data.sort_order
		};
	}

	private normalizeWbsNodeFormData(data: WbsNodeFormValues): WbsNodeFormValues {
		return {
			parent_id: data.parent_id || null,
			code: data.code?.trim() ?? '',
			name: data.name.trim().replace(/\s+/g, ' '),
			type: data.type,
			sort_order: data.sort_order
		};
	}

	private normalizeCostComponentPresetFormData(
		data: CostComponentPresetFormValues
	): CostComponentPresetFormValues {
		return {
			code: this.normalizeCodeValue(data.code),
			name: data.name.trim().replace(/\s+/g, ' '),
			description: data.description?.trim() ?? '',
			aliases: this.normalizeAliasValues(data.aliases),
			is_active: data.is_active
		};
	}

	private normalizeEstimateTemplateFormData(
		data: EstimateTemplateFormValues
	): EstimateTemplateFormValues {
		return {
			code: this.normalizeCodeValue(data.code),
			name: data.name.trim().replace(/\s+/g, ' '),
			description: data.description?.trim() ?? '',
			aliases: this.normalizeAliasValues(data.aliases),
			is_active: data.is_active
		};
	}

	private normalizeProjectStructureTemplateFormData(
		data: ProjectStructureTemplateFormValues
	): ProjectStructureTemplateFormValues {
		return {
			code: this.normalizeCodeValue(data.code),
			name: data.name.trim().replace(/\s+/g, ' '),
			description: data.description?.trim() ?? '',
			is_active: data.is_active
		};
	}

	private normalizeQuoteOptionFormData(data: QuoteOptionFormValues): QuoteOptionFormValues {
		return {
			label: data.label.trim().replace(/\s+/g, ' '),
			lead_time: data.lead_time.trim().replace(/\s+/g, ' '),
			markup_percentage: Math.max(-100, data.markup_percentage),
			material_markup_percentage:
				data.material_markup_percentage !== null && data.material_markup_percentage !== undefined
					? Math.max(-100, data.material_markup_percentage)
					: null,
			labour_markup_percentage:
				data.labour_markup_percentage !== null && data.labour_markup_percentage !== undefined
					? Math.max(-100, data.labour_markup_percentage)
					: null,
			equipment_markup_percentage:
				data.equipment_markup_percentage !== null && data.equipment_markup_percentage !== undefined
					? Math.max(-100, data.equipment_markup_percentage)
					: null,
			subcontract_markup_percentage:
				data.subcontract_markup_percentage !== null &&
				data.subcontract_markup_percentage !== undefined
					? Math.max(-100, data.subcontract_markup_percentage)
					: null,
			notes: data.notes?.trim() ?? '',
			is_default: data.is_default
		};
	}

	private normalizeQuoteOptionPresetFormData(
		data: QuoteOptionPresetFormValues
	): QuoteOptionPresetFormValues {
		return {
			label: data.label.trim().replace(/\s+/g, ' '),
			lead_time: data.lead_time.trim().replace(/\s+/g, ' '),
			markup_percentage: Math.max(-100, data.markup_percentage),
			material_markup_percentage:
				data.material_markup_percentage !== null && data.material_markup_percentage !== undefined
					? Math.max(-100, data.material_markup_percentage)
					: null,
			labour_markup_percentage:
				data.labour_markup_percentage !== null && data.labour_markup_percentage !== undefined
					? Math.max(-100, data.labour_markup_percentage)
					: null,
			equipment_markup_percentage:
				data.equipment_markup_percentage !== null && data.equipment_markup_percentage !== undefined
					? Math.max(-100, data.equipment_markup_percentage)
					: null,
			subcontract_markup_percentage:
				data.subcontract_markup_percentage !== null &&
				data.subcontract_markup_percentage !== undefined
					? Math.max(-100, data.subcontract_markup_percentage)
					: null,
			notes: data.notes?.trim() ?? ''
		};
	}

	private normalizeCodeValue(value: string | null | undefined): string {
		return value?.trim().replace(/\s+/g, ' ').toUpperCase() ?? '';
	}

	private async getAssetProjectId(assetId: string): Promise<string> {
		const asset = await this.kysely!.selectFrom('assets')
			.select('project_id')
			.where('id', '=', assetId)
			.executeTakeFirst();
		if (!asset) {
			throw new Error('Selected asset could not be found');
		}
		return asset.project_id;
	}

	private async ensureWbsNodeBelongsToProject(
		wbsNodeId: string,
		projectId: string,
		contextLabel: string
	): Promise<void> {
		const node = await this.kysely!.selectFrom('wbs_nodes')
			.select('project_id')
			.where('id', '=', wbsNodeId)
			.executeTakeFirst();
		if (!node) {
			throw new Error(`Selected ${contextLabel} could not be found`);
		}
		if (node.project_id !== projectId) {
			throw new Error(`${contextLabel} must belong to the same project as the estimate`);
		}
	}

	private async ensureUniqueMaterialCatalogueItem(
		id: string | null,
		workspaceId: string,
		data: MaterialCatalogItemFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('material_catalog_items')
			.select(['id', 'name', 'code'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const matchingName = duplicates.find(
			(item) => item.id !== id && item.name.trim().toLowerCase() === data.name.trim().toLowerCase()
		);
		if (matchingName) {
			throw new Error(`Material "${data.name}" already exists`);
		}

		if (!data.code) return;
		const normalizedCode = data.code.trim().toLowerCase();
		const matchingCode = duplicates.find(
			(item) => item.id !== id && (item.code ?? '').trim().toLowerCase() === normalizedCode
		);
		if (matchingCode) {
			throw new Error(`Material code "${data.code}" already exists`);
		}
	}

	private async ensureUniqueLabourRateCard(
		id: string | null,
		workspaceId: string,
		data: LabourRateCardFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('labour_rate_cards')
			.select(['id', 'name', 'code'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const matchingName = duplicates.find(
			(item) => item.id !== id && item.name.trim().toLowerCase() === data.name.trim().toLowerCase()
		);
		if (matchingName) {
			throw new Error(`Labour rate "${data.name}" already exists`);
		}

		if (!data.code) return;
		const normalizedCode = data.code.trim().toLowerCase();
		const matchingCode = duplicates.find(
			(item) => item.id !== id && (item.code ?? '').trim().toLowerCase() === normalizedCode
		);
		if (matchingCode) {
			throw new Error(`Labour rate code "${data.code}" already exists`);
		}
	}

	private async ensureUniqueEquipmentRateCard(
		id: string | null,
		workspaceId: string,
		data: EquipmentRateCardFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('equipment_rate_cards')
			.select(['id', 'name', 'code'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const matchingName = duplicates.find(
			(item) => item.id !== id && item.name.trim().toLowerCase() === data.name.trim().toLowerCase()
		);
		if (matchingName) {
			throw new Error(`Equipment rate "${data.name}" already exists`);
		}

		if (!data.code) return;
		const normalizedCode = data.code.trim().toLowerCase();
		const matchingCode = duplicates.find(
			(item) => item.id !== id && (item.code ?? '').trim().toLowerCase() === normalizedCode
		);
		if (matchingCode) {
			throw new Error(`Equipment rate code "${data.code}" already exists`);
		}
	}

	private async ensureUniqueSubcontractRateCard(
		id: string | null,
		workspaceId: string,
		data: SubcontractRateCardFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('subcontract_rate_cards')
			.select(['id', 'name', 'code'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const normalizedName = data.name.trim().toLowerCase();
		const matchingName = duplicates.find(
			(item) => item.id !== id && item.name.trim().toLowerCase() === normalizedName
		);
		if (matchingName) {
			throw new Error(`Subcontract rate "${data.name}" already exists`);
		}

		if (!data.code) return;
		const normalizedCode = data.code.trim().toLowerCase();
		const matchingCode = duplicates.find(
			(item) => item.id !== id && (item.code ?? '').trim().toLowerCase() === normalizedCode
		);
		if (matchingCode) {
			throw new Error(`Subcontract rate code "${data.code}" already exists`);
		}
	}

	private async ensureUniqueClassificationSystem(
		id: string | null,
		workspaceId: string,
		data: ClassificationSystemFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('classification_systems')
			.select(['id', 'name'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const matchingName = duplicates.find(
			(item) => item.id !== id && item.name.trim().toLowerCase() === data.name.trim().toLowerCase()
		);
		if (matchingName) {
			throw new Error(`Classification system "${data.name}" already exists`);
		}
	}

	private async ensureUniqueCostComponentPreset(
		id: string | null,
		workspaceId: string,
		data: CostComponentPresetFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('cost_component_presets')
			.select(['id', 'name', 'code'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const matchingName = duplicates.find(
			(item) => item.id !== id && item.name.trim().toLowerCase() === data.name.trim().toLowerCase()
		);
		if (matchingName) {
			throw new Error(`Cost component preset "${data.name}" already exists`);
		}

		if (!data.code) return;
		const normalizedCode = data.code.trim().toLowerCase();
		const matchingCode = duplicates.find(
			(item) => item.id !== id && (item.code ?? '').trim().toLowerCase() === normalizedCode
		);
		if (matchingCode) {
			throw new Error(`Cost component preset code "${data.code}" already exists`);
		}
	}

	private async ensureUniqueEstimateTemplate(
		id: string | null,
		workspaceId: string,
		data: EstimateTemplateFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('estimate_templates')
			.select(['id', 'name', 'code'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const matchingName = duplicates.find(
			(item) => item.id !== id && item.name.trim().toLowerCase() === data.name.trim().toLowerCase()
		);
		if (matchingName) {
			throw new Error(`Estimate template "${data.name}" already exists`);
		}

		if (!data.code) return;
		const normalizedCode = data.code.trim().toLowerCase();
		const matchingCode = duplicates.find(
			(item) => item.id !== id && (item.code ?? '').trim().toLowerCase() === normalizedCode
		);
		if (matchingCode) {
			throw new Error(`Estimate template code "${data.code}" already exists`);
		}
	}

	private async ensureUniqueQuoteOptionPreset(
		id: string | null,
		workspaceId: string,
		data: QuoteOptionPresetFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('quote_option_presets')
			.select(['id', 'label'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const matchingLabel = duplicates.find(
			(item) =>
				item.id !== id && item.label.trim().toLowerCase() === data.label.trim().toLowerCase()
		);
		if (matchingLabel) {
			throw new Error(`Quote option preset "${data.label}" already exists`);
		}
	}

	private async ensureUniqueProjectStructureTemplate(
		id: string | null,
		workspaceId: string,
		data: ProjectStructureTemplateFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('project_structure_templates')
			.select(['id', 'name', 'code'])
			.where('workspace_id', '=', workspaceId)
			.execute();

		const matchingName = duplicates.find(
			(item) => item.id !== id && item.name.trim().toLowerCase() === data.name.trim().toLowerCase()
		);
		if (matchingName) {
			throw new Error(`Project structure template "${data.name}" already exists`);
		}

		if (!data.code) return;
		const normalizedCode = data.code.trim().toLowerCase();
		const matchingCode = duplicates.find(
			(item) => item.id !== id && (item.code ?? '').trim().toLowerCase() === normalizedCode
		);
		if (matchingCode) {
			throw new Error(`Project structure template code "${data.code}" already exists`);
		}
	}

	private validateProjectStructureTemplateNodes(
		nodes: ProjectStructureTemplateNode[]
	): ProjectStructureTemplateNode[] {
		const nodeIds = new Set<string>();
		const normalizedNodes = [...nodes]
			.map((node, index) => ({
				...node,
				parent_id: node.parent_id || null,
				code: node.code?.trim() ?? null,
				name: node.name.trim().replace(/\s+/g, ' '),
				sort_order: Number.isFinite(node.sort_order) ? node.sort_order : index
			}))
			.sort(
				(left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)
			);

		for (const node of normalizedNodes) {
			if (!node.id) {
				throw new Error('Project structure template nodes require stable ids');
			}
			if (nodeIds.has(node.id)) {
				throw new Error('Project structure template nodes must have unique ids');
			}
			nodeIds.add(node.id);
			if (node.parent_id && !normalizedNodes.some((candidate) => candidate.id === node.parent_id)) {
				throw new Error('Project structure template node parent could not be found');
			}
		}

		const childrenByParent = new Map<string, string[]>();
		for (const node of normalizedNodes) {
			if (!node.parent_id) continue;
			const current = childrenByParent.get(node.parent_id) ?? [];
			current.push(node.id);
			childrenByParent.set(node.parent_id, current);
		}

		const visited = new Set<string>();
		const active = new Set<string>();
		const visit = (nodeId: string): void => {
			if (active.has(nodeId)) {
				throw new Error('Project structure template hierarchy cannot contain cycles');
			}
			if (visited.has(nodeId)) return;
			active.add(nodeId);
			for (const childId of childrenByParent.get(nodeId) ?? []) {
				visit(childId);
			}
			active.delete(nodeId);
			visited.add(nodeId);
		};

		for (const node of normalizedNodes) {
			visit(node.id);
		}

		return normalizedNodes;
	}

	private orderProjectStructureNodesForInsert(
		nodes: ProjectStructureTemplateNode[]
	): ProjectStructureTemplateNode[] {
		const nodesByParent = new Map<string | null, ProjectStructureTemplateNode[]>();
		for (const node of nodes) {
			const parentId = node.parent_id ?? null;
			const siblings = nodesByParent.get(parentId) ?? [];
			siblings.push(node);
			nodesByParent.set(parentId, siblings);
		}

		const orderedNodes: ProjectStructureTemplateNode[] = [];
		const visit = (parentId: string | null): void => {
			for (const node of nodesByParent.get(parentId) ?? []) {
				orderedNodes.push(node);
				visit(node.id);
			}
		};

		visit(null);

		if (orderedNodes.length !== nodes.length) {
			throw new Error('Project structure template hierarchy could not be ordered for persistence');
		}

		return orderedNodes;
	}

	private async ensureUniqueCostCode(
		id: string | null,
		classificationSystemId: string,
		data: CostCodeFormValues
	): Promise<void> {
		const duplicates = await this.kysely!.selectFrom('cost_codes')
			.select(['id', 'code'])
			.where('classification_system_id', '=', classificationSystemId)
			.execute();

		const matchingCode = duplicates.find(
			(item) => item.id !== id && item.code.trim().toLowerCase() === data.code.trim().toLowerCase()
		);
		if (matchingCode) {
			throw new Error(`Cost code "${data.code}" already exists in this classification system`);
		}
	}

	private async createsCostCodeCycle(id: string, parentId: string | null): Promise<boolean> {
		let currentId = parentId;
		while (currentId) {
			if (currentId === id) return true;
			const next = await this.kysely!.selectFrom('cost_codes')
				.select('parent_id')
				.where('id', '=', currentId)
				.executeTakeFirst();
			currentId = next?.parent_id ?? null;
		}
		return false;
	}

	private async createsWbsCycle(id: string, parentId: string | null): Promise<boolean> {
		let currentId = parentId;
		while (currentId) {
			if (currentId === id) return true;
			const next = await this.kysely!.selectFrom('wbs_nodes')
				.select('parent_id')
				.where('id', '=', currentId)
				.executeTakeFirst();
			currentId = next?.parent_id ?? null;
		}
		return false;
	}

	private async validateCostCodeParent(
		id: string | null,
		classificationSystemId: string,
		parentId: string | null
	): Promise<void> {
		if (!parentId) return;
		if (id && parentId === id) {
			throw new Error('Cost code parent cannot be the current code');
		}

		const parent = await this.kysely!.selectFrom('cost_codes')
			.select(['id', 'classification_system_id'])
			.where('id', '=', parentId)
			.executeTakeFirst();
		if (!parent) {
			throw new Error('Selected parent cost code could not be found');
		}
		if (parent.classification_system_id !== classificationSystemId) {
			throw new Error('Parent cost code must belong to the same classification system');
		}
		if (id && (await this.createsCostCodeCycle(id, parentId))) {
			throw new Error('Cost code parent cannot be a descendant of the current code');
		}
	}

	private async validateWbsParent(
		id: string | null,
		projectId: string,
		parentId: string | null
	): Promise<void> {
		if (!parentId) return;
		if (id && parentId === id) {
			throw new Error('WBS parent cannot be the current node');
		}

		const parent = await this.kysely!.selectFrom('wbs_nodes')
			.select(['id', 'project_id'])
			.where('id', '=', parentId)
			.executeTakeFirst();
		if (!parent) {
			throw new Error('Selected parent WBS node could not be found');
		}
		if (parent.project_id !== projectId) {
			throw new Error('Parent WBS node must belong to the same project');
		}
		if (id && (await this.createsWbsCycle(id, parentId))) {
			throw new Error('WBS parent cannot be a descendant of the current node');
		}
	}

	private async validateEstimateWbsLinks(assetId: string, estimate: Estimate): Promise<void> {
		const projectId = await this.getAssetProjectId(assetId);
		if (estimate.wbs_root_node_id) {
			await this.ensureWbsNodeBelongsToProject(
				estimate.wbs_root_node_id,
				projectId,
				'estimate WBS root'
			);
		}
		await Promise.all(
			estimate.takeoff_items.map(async (item) => {
				if (!item.wbs_node_id) return;
				await this.ensureWbsNodeBelongsToProject(item.wbs_node_id, projectId, 'takeoff WBS node');
			})
		);
	}

	private supportsSeparateTaxIdentifier(countryCode: string | null | undefined): boolean {
		return (countryCode ?? '').trim().toUpperCase() !== 'AU';
	}

	private async buildEstimateReferenceIndex(workspaceId: string): Promise<EstimateReferenceIndex> {
		const [
			classificationSystems,
			costCodes,
			costComponentPresets,
			estimateTemplates,
			materialCatalogItems,
			labourRateCards,
			equipmentRateCards,
			subcontractRateCards
		] = await Promise.all([
			this.kysely!.selectFrom('classification_systems')
				.select('id')
				.where('workspace_id', '=', workspaceId)
				.execute(),
			this.kysely!.selectFrom('cost_codes as c')
				.innerJoin('classification_systems as s', 'c.classification_system_id', 's.id')
				.select(['c.id as id', 'c.classification_system_id as classification_system_id'])
				.where('s.workspace_id', '=', workspaceId)
				.execute(),
			this.kysely!.selectFrom('cost_component_presets')
				.select('id')
				.where('workspace_id', '=', workspaceId)
				.execute(),
			this.kysely!.selectFrom('estimate_templates')
				.select('id')
				.where('workspace_id', '=', workspaceId)
				.execute(),
			this.kysely!.selectFrom('material_catalog_items')
				.select('id')
				.where('workspace_id', '=', workspaceId)
				.execute(),
			this.kysely!.selectFrom('labour_rate_cards')
				.select('id')
				.where('workspace_id', '=', workspaceId)
				.execute(),
			this.kysely!.selectFrom('equipment_rate_cards')
				.select('id')
				.where('workspace_id', '=', workspaceId)
				.execute(),
			this.kysely!.selectFrom('subcontract_rate_cards')
				.select('id')
				.where('workspace_id', '=', workspaceId)
				.execute()
		]);

		return {
			classificationSystemIds: new Set(classificationSystems.map((row) => row.id)),
			costCodeToClassificationId: new Map(
				costCodes.map((row) => [row.id, row.classification_system_id])
			),
			costComponentPresetIds: new Set(costComponentPresets.map((row) => row.id)),
			estimateTemplateIds: new Set(estimateTemplates.map((row) => row.id)),
			materialSourceIds: new Set(materialCatalogItems.map((row) => row.id)),
			labourSourceIds: new Set(labourRateCards.map((row) => row.id)),
			equipmentSourceIds: new Set(equipmentRateCards.map((row) => row.id)),
			subcontractSourceIds: new Set(subcontractRateCards.map((row) => row.id))
		};
	}

	private async buildProjectWbsNodeIndex(projectId: string): Promise<Set<string>> {
		const rows = await this.kysely!.selectFrom('wbs_nodes')
			.select('id')
			.where('project_id', '=', projectId)
			.execute();
		return new Set(rows.map((row) => row.id));
	}

	private async collectCostCodeSubtreeIds(rootId: string | string[]): Promise<string[]> {
		const rootIds = Array.isArray(rootId) ? rootId : [rootId];
		if (rootIds.length === 0) return [];

		const rows = await this.kysely!.withRecursive('cte_cost_codes', (db) =>
			db
				.selectFrom('cost_codes')
				.select('id')
				.where('id', 'in', rootIds)
				.unionAll((db) =>
					db
						.selectFrom('cost_codes as cc')
						.innerJoin('cte_cost_codes as cte', 'cc.parent_id', 'cte.id')
						.select('cc.id')
				)
		)
			.selectFrom('cte_cost_codes')
			.select('id')
			.execute();
		return Array.from(new Set(rows.map((r) => r.id)));
	}

	private async clearLinkedPresetReferences(presetId: string): Promise<void> {
		await this.kysely!.updateTable('takeoff_items')
			.set({
				applied_preset_id: null,
				applied_preset_name: null,
				updated_at: new Date().toISOString()
			})
			.where('applied_preset_id', '=', presetId)
			.execute();
	}

	private async clearLinkedTemplateReferences(templateId: string): Promise<void> {
		await this.kysely!.updateTable('estimates')
			.set({
				applied_template_id: null,
				applied_template_name: null,
				updated_at: new Date().toISOString()
			})
			.where('applied_template_id', '=', templateId)
			.execute();
	}

	private async clearLinkedCostCodeReferences(costCodeIds: string[]): Promise<void> {
		if (costCodeIds.length === 0) return;
		await this.kysely!.updateTable('takeoff_items')
			.set({
				cost_code_id: null,
				updated_at: new Date().toISOString()
			})
			.where('cost_code_id', 'in', costCodeIds)
			.execute();
	}

	private normaliseLinkedComponentSource(
		sourceType: CostComponent['source_type'],
		sourceId: string | null | undefined,
		references: EstimateReferenceIndex
	): Pick<CostComponent, 'source_type' | 'source_id'> {
		if (sourceType === 'manual') {
			return { source_type: 'manual', source_id: null };
		}

		if (!sourceId) {
			return { source_type: 'manual', source_id: null };
		}

		const sourceIds =
			sourceType === 'material_catalog'
				? references.materialSourceIds
				: sourceType === 'labour_rate_card'
					? references.labourSourceIds
					: sourceType === 'equipment_rate_card'
						? references.equipmentSourceIds
						: references.subcontractSourceIds;

		if (!sourceIds.has(sourceId)) {
			return { source_type: 'manual', source_id: null };
		}

		return { source_type: sourceType, source_id: sourceId };
	}

	private normaliseLinkedCostCodeId(
		costCodeId: string | null | undefined,
		classificationSystemId: string | null | undefined,
		references: EstimateReferenceIndex
	): string | null {
		if (!costCodeId) return null;
		const owningClassificationId = references.costCodeToClassificationId.get(costCodeId);
		if (!owningClassificationId) return null;
		if (classificationSystemId && owningClassificationId !== classificationSystemId) {
			return null;
		}
		return costCodeId;
	}

	private normaliseLinkedPresetRef(
		presetId: string | null | undefined,
		presetName: string | null | undefined,
		references: EstimateReferenceIndex
	): Pick<TakeoffItem, 'applied_preset_id' | 'applied_preset_name'> {
		if (!presetId || !references.costComponentPresetIds.has(presetId)) {
			return {
				applied_preset_id: null,
				applied_preset_name: null
			};
		}
		return {
			applied_preset_id: presetId,
			applied_preset_name: presetName ?? null
		};
	}

	private normaliseLinkedTemplateRef(
		templateId: string | null | undefined,
		templateName: string | null | undefined,
		references: EstimateReferenceIndex
	): Pick<Estimate, 'applied_template_id' | 'applied_template_name'> {
		if (!templateId || !references.estimateTemplateIds.has(templateId)) {
			return {
				applied_template_id: null,
				applied_template_name: null
			};
		}
		return {
			applied_template_id: templateId,
			applied_template_name: templateName ?? null
		};
	}

	private sanitisePersistedEstimatePayload(
		estimate: Estimate,
		references: EstimateReferenceIndex,
		wbsNodeIds?: Set<string>
	): Estimate {
		const classificationSystemId =
			estimate.classification_system_id &&
			references.classificationSystemIds.has(estimate.classification_system_id)
				? estimate.classification_system_id
				: null;

		return {
			...estimate,
			classification_system_id: classificationSystemId,
			wbs_root_node_id:
				estimate.wbs_root_node_id && wbsNodeIds && !wbsNodeIds.has(estimate.wbs_root_node_id)
					? null
					: (estimate.wbs_root_node_id ?? null),
			...this.normaliseLinkedTemplateRef(
				estimate.applied_template_id,
				estimate.applied_template_name,
				references
			),
			takeoff_items: estimate.takeoff_items.map((item) => ({
				...item,
				wbs_node_id:
					item.wbs_node_id && wbsNodeIds && !wbsNodeIds.has(item.wbs_node_id)
						? null
						: (item.wbs_node_id ?? null),
				cost_code_id: this.normaliseLinkedCostCodeId(
					item.cost_code_id,
					classificationSystemId,
					references
				),
				...this.normaliseLinkedPresetRef(
					item.applied_preset_id,
					item.applied_preset_name,
					references
				),
				cost_components: item.cost_components.map((component) => ({
					...component,
					...this.normaliseLinkedComponentSource(
						component.source_type,
						component.source_id ?? null,
						references
					)
				}))
			}))
		};
	}

	private sanitiseEstimateTemplatePayload(
		estimate: EstimateTemplate['estimate'],
		references: EstimateReferenceIndex
	): EstimateTemplate['estimate'] {
		const reusableEstimate = normaliseReusableEstimatePayload(estimate);
		const classificationSystemId =
			reusableEstimate.classification_system_id &&
			references.classificationSystemIds.has(reusableEstimate.classification_system_id)
				? reusableEstimate.classification_system_id
				: null;

		return {
			...reusableEstimate,
			classification_system_id: classificationSystemId,
			wbs_root_node_id: null,
			takeoff_items: reusableEstimate.takeoff_items.map((item) => ({
				...item,
				wbs_node_id: null,
				...this.normaliseLinkedPresetRef(
					item.applied_preset_id,
					item.applied_preset_name,
					references
				),
				cost_code_id: this.normaliseLinkedCostCodeId(
					item.cost_code_id,
					classificationSystemId,
					references
				),
				cost_components: item.cost_components.map((component) => ({
					...component,
					...this.normaliseLinkedComponentSource(
						component.source_type,
						component.source_id ?? null,
						references
					)
				}))
			}))
		};
	}

	private sanitiseCostComponentPresetComponents(
		components: CostComponentPreset['components'],
		references: EstimateReferenceIndex
	): CostComponentPreset['components'] {
		return normaliseReusablePresetComponents(components).map((component) => ({
			...component,
			...this.normaliseLinkedComponentSource(
				component.source_type,
				component.source_id ?? null,
				references
			)
		}));
	}

	private async validateEstimateReferenceLinks(
		estimate: Estimate,
		workspaceId: string
	): Promise<void> {
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		const classificationSystemId = estimate.classification_system_id ?? null;

		if (classificationSystemId && !references.classificationSystemIds.has(classificationSystemId)) {
			throw new Error('Selected classification system could not be found');
		}

		for (const item of estimate.takeoff_items) {
			if (!item.cost_code_id) continue;
			const owningClassificationId = references.costCodeToClassificationId.get(item.cost_code_id);
			if (!owningClassificationId) {
				throw new Error('Takeoff cost code could not be found');
			}
			if (classificationSystemId && owningClassificationId !== classificationSystemId) {
				throw new Error('Takeoff cost code must belong to the selected classification system');
			}
		}
	}

	private async reconcileReusableEstimatingArtifacts(workspaceId: string): Promise<void> {
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		const presetRows = CostComponentPresetRowArraySchema.parse(
			await this.kysely!.selectFrom('cost_component_presets')
				.selectAll()
				.where('workspace_id', '=', workspaceId)
				.execute()
		);
		await Promise.all(
			presetRows.map((row) => {
				const sanitisedComponents = this.sanitiseCostComponentPresetComponents(
					row.components_json,
					references
				);
				return this.kysely!.updateTable('cost_component_presets')
					.set({
						components_json: JSON.stringify(sanitisedComponents),
						updated_at: new Date().toISOString()
					})
					.where('id', '=', row.id)
					.execute();
			})
		);

		const templateRows = EstimateTemplateRowArraySchema.parse(
			await this.kysely!.selectFrom('estimate_templates')
				.selectAll()
				.where('workspace_id', '=', workspaceId)
				.execute()
		);
		await Promise.all(
			templateRows.map((row) => {
				const sanitisedEstimate = this.sanitiseEstimateTemplatePayload(
					row.estimate_json,
					references
				);
				return this.kysely!.updateTable('estimate_templates')
					.set({
						estimate_json: JSON.stringify(sanitisedEstimate),
						updated_at: new Date().toISOString()
					})
					.where('id', '=', row.id)
					.execute();
			})
		);
	}

	private resolveWorkspaceCurrencySync(): SupportedCurrencyCode {
		if (
			this._workspaceCurrencyCode &&
			SUPPORTED_CURRENCY_CODE_SET.has(this._workspaceCurrencyCode)
		) {
			return this._workspaceCurrencyCode as SupportedCurrencyCode;
		}
		const defaults = buildWorkspaceRegionalDefaults('AU');
		return defaults.currencyCode as SupportedCurrencyCode;
	}

	/**
	 * Resolve the estimate currency for a save operation.
	 *
	 * Policy:
	 *   create:
	 *     explicit supported currency → persist it
	 *     omitted currency → resolve workspace default → persist explicit ISO code
	 *
	 *   update:
	 *     explicit supported currency → persist it
	 *     omitted currency → preserve persisted estimate currency
	 *     persisted estimate currency is NULL → fail visibly
	 *       (do not use workspace default silently)
	 */
	private async resolveEstimateCurrencyForSave(
		assetId: string,
		incomingCurrencyCode: string | null | undefined
	): Promise<string> {
		// Check if the estimate already exists in the database
		const existing = await this.kysely!.selectFrom('estimates')
			.select('currency_code')
			.where('asset_id', '=', assetId)
			.executeTakeFirst();

		if (!existing) {
			// Create path
			return incomingCurrencyCode ?? this.resolveWorkspaceCurrencySync();
		}

		// Update path
		if (incomingCurrencyCode != null) {
			// Explicit currency provided
			return incomingCurrencyCode;
		}

		// Update with omitted currency
		if (existing.currency_code != null) {
			// Preserve persisted value
			return existing.currency_code;
		}

		// Update with omitted currency on persisted NULL — fail visibly
		throw new Error(
			`Cannot save estimate '${assetId}': reporting currency is NULL. ` +
				`Open the estimate and set an explicit currency, then save again.`
		);
	}

	private sanitizeCurrencyCode(value: string | null | undefined): string {
		return value && SUPPORTED_CURRENCY_CODE_SET.has(value) ? value : 'AUD';
	}

	private sanitizeDateFormat(value: string | null | undefined): string {
		return value && SUPPORTED_DATE_FORMAT_SET.has(value) ? value : 'en-AU';
	}

	private sanitizeLanguageLocale(value: string | null | undefined): string {
		return value && SUPPORTED_LANGUAGE_LOCALE_SET.has(value) ? value : 'en-AU';
	}

	private sanitizeNumberLocale(value: string | null | undefined): string {
		return value && SUPPORTED_NUMBER_LOCALE_SET.has(value) ? value : 'en-AU';
	}

	private sanitizeTaxRatePercentage(value: number | null | undefined, fallback = 0): number {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return fallback;
		}
		return Math.min(100, Math.max(0, value));
	}

	private sanitizeMeasurementUnit(
		value: string | null | undefined
	): WorkspaceProfile['measurementUnit'] {
		return value && SUPPORTED_MEASUREMENT_UNIT_SET.has(value)
			? (value as WorkspaceProfile['measurementUnit'])
			: 'Metric';
	}

	private parseJsonObject(value: unknown): Record<string, unknown> {
		if (!value) return {};
		if (typeof value === 'string') {
			try {
				const parsed = JsonStringSchema.parse(value);
				return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
			} catch {
				return {};
			}
		}
		return typeof value === 'object' ? (value as Record<string, unknown>) : {};
	}

	private mapTakeoffItems(
		rows: Array<{
			id: string;
			estimate_asset_id: string;
			parent_id: string | null;
			wbs_node_id: string | null;
			cost_code_id: string | null;
			name: string;
			description: string;
			quantity: number;
			unit: string;
			properties_json: Record<string, unknown> | string;
			sort_order: number;
		}>,
		componentMap: Map<string, CostComponent[]>
	): TakeoffItem[] {
		return rows.map((row) => ({
			id: row.id,
			estimate_asset_id: row.estimate_asset_id,
			parent_id: row.parent_id,
			wbs_node_id: row.wbs_node_id,
			cost_code_id: row.cost_code_id,
			name: row.name,
			description: row.description,
			quantity: row.quantity,
			unit: normaliseMaterialUnitCode(row.unit) ?? 'ea',
			properties: this.parseJsonObject(row.properties_json),
			sort_order: row.sort_order,
			cost_components: componentMap.get(row.id) ?? []
		}));
	}

	private mapCostComponents(
		rows: Array<{
			id: string;
			takeoff_item_id: string;
			category: CostComponent['category'];
			source_type: CostComponent['source_type'];
			source_id: string | null;
			name: string;
			description: string;
			quantity: number;
			unit: string;
			unit_rate: number;
			formula_json: Record<string, unknown> | string;
			metadata_json: Record<string, unknown> | string;
			sort_order: number;
		}>
	): Map<string, CostComponent[]> {
		const componentMap = new Map<string, CostComponent[]>();
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			let list = componentMap.get(row.takeoff_item_id);
			if (list === undefined) {
				list = [];
				componentMap.set(row.takeoff_item_id, list);
			}
			list.push({
				id: row.id,
				takeoff_item_id: row.takeoff_item_id,
				category: row.category,
				source_type: row.source_type,
				source_id: row.source_id,
				name: row.name,
				description: row.description,
				quantity: row.quantity,
				unit: normaliseUnitCode(row.unit) ?? 'ea',
				unit_rate: row.unit_rate,
				formula: this.parseJsonObject(row.formula_json),
				metadata: this.parseJsonObject(row.metadata_json),
				sort_order: row.sort_order
			});
		}
		return componentMap;
	}

	private async ensureThumbnailBelongsToAsset(
		assetId: string,
		projectId: string,
		thumbnailFileId: string
	): Promise<void> {
		const file = await this.kysely!.selectFrom('files')
			.select(['id', 'project_id', 'asset_id'])
			.where('id', '=', thumbnailFileId)
			.executeTakeFirst();

		if (!file || file.project_id !== projectId || file.asset_id !== assetId) {
			throw new Error('Thumbnail must belong to the selected asset');
		}
	}

	private async syncAssetThumbnail(assetId: string): Promise<void> {
		const asset = await this.kysely!.selectFrom('assets')
			.select('id')
			.where('id', '=', assetId)
			.executeTakeFirst();
		if (!asset) return;

		const nextFile = (
			await this.kysely!.selectFrom('files')
				.select(['id', 'file_path', 'created_at'])
				.where('asset_id', '=', assetId)
				.execute()
		)
			.filter((file) => getGeneralFileThumbnailPriority(file.file_path) !== null)
			.sort((left, right) => {
				const rightPriority = getGeneralFileThumbnailPriority(right.file_path) ?? -1;
				const leftPriority = getGeneralFileThumbnailPriority(left.file_path) ?? -1;
				if (rightPriority !== leftPriority) {
					return rightPriority - leftPriority;
				}
				return left.created_at.localeCompare(right.created_at);
			})[0];

		await this.kysely!.updateTable('assets')
			.set({ thumbnail_file_id: nextFile?.id ?? null })
			.where('id', '=', assetId)
			.execute();
	}

	async getWorkspaceIdentity(): Promise<WorkspaceIdentity | null> {
		if (!isTauri()) {
			const now = new Date().toISOString();
			return {
				id: LOCAL_WORKSPACE_ID,
				bootstrapCompletedAt: null,
				onboardingVersion: LOCAL_ONBOARDING_VERSION,
				workspaceRole: 'owner',
				created_at: now,
				updated_at: now
			};
		}
		await this.init();
		try {
			const raw = await this.db!.select<unknown[]>(
				`SELECT * FROM workspace_identity ORDER BY created_at ASC LIMIT 1`
			);
			const row = raw[0];
			return row ? this.mapWorkspaceIdentityRow(row) : null;
		} catch (err) {
			log.error(`Failed to fetch workspace identity: ${err}`);
			return null;
		}
	}

	async getWorkspaceProfile(): Promise<WorkspaceProfile | null> {
		if (!isTauri()) {
			const now = new Date().toISOString();
			const regionalDefaults = buildWorkspaceRegionalDefaults('AU');
			this._workspaceCurrencyCode = regionalDefaults.currencyCode as SupportedCurrencyCode;
			return {
				workspaceId: LOCAL_WORKSPACE_ID,
				displayName: DEFAULT_WORKSPACE_NAME,
				countryCode: regionalDefaults.countryCode,
				businessName: '',
				logoFilePath: '',
				aiPlaybookText: '',
				businessIdLabel: regionalDefaults.businessIdLabel,
				businessIdValue: '',
				taxIdLabel: regionalDefaults.taxIdLabel,
				taxIdValue: '',
				taxDisplayLabel: regionalDefaults.taxDisplayLabel,
				taxRatePercentage: regionalDefaults.taxRatePercentage,
				businessAddress: '',
				businessContactName: '',
				businessContactFirstName: '',
				businessContactLastName: '',
				businessContactEmail: '',
				businessContactPhone: '',
				businessContactPhoneE164: '',
				businessContactPhoneCountryCode: regionalDefaults.phoneCountryCode,
				currencyCode: regionalDefaults.currencyCode,
				currencySymbol: regionalDefaults.currencySymbol,
				measurementUnit: regionalDefaults.measurementUnit,
				dateFormat: regionalDefaults.dateFormat,
				languageLocale: regionalDefaults.languageLocale,
				numberLocale: regionalDefaults.numberLocale,
				quotePaymentTerms: DEFAULT_QUOTE_PAYMENT_TERMS,
				quoteValidityDays: DEFAULT_QUOTE_VALIDITY_DAYS,
				quoteDefaultInclusions: '',
				quoteDefaultExclusions: '',
				quoteDefaultTerms: '',
				quoteNumberPrefix: DEFAULT_QUOTE_NUMBER_PREFIX,
				quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
				emailSignature: '',
				created_at: now,
				updated_at: now
			};
		}
		await this.init();
		try {
			const raw = await this.db!.select<unknown[]>(
				`SELECT * FROM workspace_profile ORDER BY created_at ASC LIMIT 1`
			);
			const row = raw[0];
			if (row) {
				const profile = this.mapWorkspaceProfileRow(row);
				this._workspaceCurrencyCode = profile.currencyCode as SupportedCurrencyCode;
				return profile;
			}
			return null;
		} catch (err) {
			log.error(`Failed to fetch workspace profile: ${err}`);
			return null;
		}
	}

	// ── FX rate snapshot methods ──────────────────────────────────────
	// Append-only workspace-scoped persistence. No update/delete/upsert.
	// No inverse or cross-rate logic. No provider fetching.

	/**
	 * Create an FX rate snapshot.
	 * Validates ISO codes, enforces from != to, canonicalises the rate as
	 * an exact positive decimal string via decimal.js, then persists.
	 */
	async createFxRateSnapshot(input: {
		from_currency_code: string;
		to_currency_code: string;
		rate_decimal: string;
		effective_at: string;
		source?: string;
	}): Promise<FxRateSnapshotRow | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();

		// Validate ISO codes against canonical set
		const fromCode = input.from_currency_code?.trim().toUpperCase() ?? '';
		const toCode = input.to_currency_code?.trim().toUpperCase() ?? '';
		if (!SUPPORTED_CURRENCY_CODE_SET.has(fromCode)) {
			throw new Error(`Unsupported from_currency_code: ${input.from_currency_code}`);
		}
		if (!SUPPORTED_CURRENCY_CODE_SET.has(toCode)) {
			throw new Error(`Unsupported to_currency_code: ${input.to_currency_code}`);
		}
		if (fromCode === toCode) {
			throw new Error('from_currency_code and to_currency_code must differ');
		}

		// Canonicalize rate as exact positive decimal string
		let rate_decimal: string;
		try {
			rate_decimal = normalizePositiveDecimalString(input.rate_decimal);
		} catch (e) {
			throw new Error(`Invalid rate: ${(e as Error).message}`);
		}

		const id = crypto.randomUUID();
		await this.kysely!.insertInto('fx_rate_snapshots')
			.values({
				id,
				workspace_id: workspaceId,
				from_currency_code: fromCode,
				to_currency_code: toCode,
				rate_decimal,
				source: input.source ?? 'manual',
				effective_at: input.effective_at
			})
			.execute();

		// Readback
		const row = await this.kysely!.selectFrom('fx_rate_snapshots')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Get an FX rate snapshot by ID within the active workspace.
	 * Returns null if not found or if the snapshot belongs to a different workspace.
	 */
	async getFxRateSnapshotById(id: string): Promise<FxRateSnapshotRow | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const row = await this.kysely!.selectFrom('fx_rate_snapshots')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Validate FX snapshot references in cost components (Policy B).
	 *
	 * When a cost component references an fx_rate_snapshot_id, verify:
	 * - The snapshot exists in the active workspace
	 * - The snapshot from_currency_code matches the component source_currency_code
	 * - The snapshot to_currency_code matches the estimate currency_code
	 * - Source and target differ (enforced by snapshot CHECK constraint)
	 *
	 * Domestic components (no fx_rate_snapshot_id) are not validated here.
	 * Foreign writes without snapshot references are rejected.
	 */
	private async validateCostComponentSnapshots(
		components: CostComponent[],
		estimateCurrency: string | null
	): Promise<void> {
		for (const component of components) {
			const snapshotId = component.fx_rate_snapshot_id;
			const sourceCurrency = component.source_currency_code;

			// M3C.1 policy: all foreign-component writes are blocked until M4.
			// M4 will prove unit_rate = Decimal(source_unit_rate_decimal) ×
			// Decimal(snapshot.rate_decimal) before persisting.

			if (sourceCurrency && estimateCurrency && sourceCurrency !== estimateCurrency) {
				throw new Error(
					`Foreign cost component ${component.id}: source_currency_code ` +
						`"${sourceCurrency}" differs from estimate currency ` +
						`"${estimateCurrency}". Multi-currency cost components are ` +
						'not yet supported. Conversion support arrives in a future ' +
						'update (M4). Set source_currency_code to match the estimate ' +
						'currency for domestic-only estimates.'
				);
			}

			if (snapshotId) {
				// Snapshot references are blocked until M4 validates conversion math.
				// A domestic component with a snapshot reference is incoherent —
				// snapshots exist only for cross-currency conversion, which is not
				// yet supported at the cost-component level.
				throw new Error(
					`Cost component ${component.id} references FX rate snapshot ` +
						`"${snapshotId}", but snapshot references are not yet ` +
						'supported at the component level. Remove fx_rate_snapshot_id ' +
						'for domestic-only estimates. Conversion support arrives in ' +
						'a future update (M4).'
				);
			}

			// Domestic component without snapshot reference — allowed.
			// source_currency_code should equal estimateCurrency (or be omitted,
			// in which case the Rust save path fills from estimate.currency_code).
		}
	}

	/**
	 * List FX rate snapshots for the active workspace.
	 * Optionally filter by from/to currency code and limit results.
	 * Results ordered by effective_at DESC, then created_at DESC.
	 */
	async listFxRateSnapshots(options?: {
		from_currency_code?: string;
		to_currency_code?: string;
		limit?: number;
	}): Promise<FxRateSnapshotRow[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();

		let query = this.kysely!.selectFrom('fx_rate_snapshots')
			.selectAll()
			.where('workspace_id', '=', workspaceId);

		if (options?.from_currency_code) {
			const from = options.from_currency_code.trim().toUpperCase();
			if (!SUPPORTED_CURRENCY_CODE_SET.has(from)) {
				throw new Error(`Unsupported from_currency_code filter: ${options.from_currency_code}`);
			}
			query = query.where('from_currency_code', '=', from);
		}
		if (options?.to_currency_code) {
			const to = options.to_currency_code.trim().toUpperCase();
			if (!SUPPORTED_CURRENCY_CODE_SET.has(to)) {
				throw new Error(`Unsupported to_currency_code filter: ${options.to_currency_code}`);
			}
			query = query.where('to_currency_code', '=', to);
		}

		query = query
			.orderBy('effective_at', 'desc')
			.orderBy('created_at', 'desc')
			.orderBy('id', 'desc');

		if (options?.limit && options.limit > 0) {
			query = query.limit(options.limit);
		}

		return query.execute();
	}

	// ── end FX rate snapshot methods ────────────────────────────────

	async getWorkspaceOnboardingProfile(): Promise<WorkspaceOnboardingProfile | null> {
		if (!isTauri()) {
			const now = new Date().toISOString();
			return {
				workspaceId: LOCAL_WORKSPACE_ID,
				primaryOperatorRole: 'owner_founder',
				industry: '',
				created_at: now,
				updated_at: now
			};
		}
		await this.init();
		try {
			const raw = await this.db!.select<unknown[]>(
				`SELECT * FROM workspace_onboarding_profile ORDER BY created_at ASC LIMIT 1`
			);
			const row = raw[0];
			return row ? this.mapWorkspaceOnboardingProfileRow(row) : null;
		} catch (err) {
			log.error(`Failed to fetch workspace onboarding profile: ${err}`);
			return null;
		}
	}

	async getPrimaryWorkspaceMember(): Promise<WorkspaceMember | null> {
		if (!isTauri()) {
			const now = new Date().toISOString();
			return {
				id: LOCAL_PRIMARY_MEMBER_ID,
				workspaceId: LOCAL_WORKSPACE_ID,
				role: 'owner',
				displayName: '',
				firstName: '',
				lastName: '',
				email: '',
				avatarPath: '',
				isPrimary: true,
				joinedAt: now,
				created_at: now,
				updated_at: now
			};
		}
		await this.init();
		try {
			const raw = await this.db!.select<unknown[]>(
				`SELECT * FROM workspace_members WHERE is_primary = 1 ORDER BY created_at ASC LIMIT 1`
			);
			const row = raw[0];
			return row ? this.mapWorkspaceMemberRow(row) : null;
		} catch (err) {
			log.error(`Failed to fetch workspace member: ${err}`);
			return null;
		}
	}

	buildBootstrapFoundationCommandInput(input: {
		workspaceId: string;
		displayName: string;
		countryCode: string;
		businessName: string;
		logoFilePath: string;
		businessContactFirstName: string;
		businessContactLastName: string;
		primaryMemberFirstName?: string;
		primaryMemberLastName?: string;
		businessContactEmail: string;
		businessContactPhone: string;
		businessIdValue: string;
		primaryOperatorRole: WorkspaceOnboardingProfile['primaryOperatorRole'];
		industry: string;
	}): Record<string, unknown> {
		const now = new Date().toISOString();
		const workspaceId = input.workspaceId.trim() || LOCAL_WORKSPACE_ID;
		const displayName = input.displayName.trim() || DEFAULT_WORKSPACE_NAME;
		const businessName = input.businessName.trim();
		const countryCode = normaliseCountryCode(input.countryCode);
		const regionalDefaults = buildWorkspaceRegionalDefaults(countryCode);
		const businessPhone = normalisePhoneForWorkspace(input.businessContactPhone, countryCode);
		const businessContactEmail = normaliseEmailValue(input.businessContactEmail);
		const businessIdValue = normaliseOptionalText(input.businessIdValue);
		const businessContactName = resolvePersonNameParts({
			firstName: input.businessContactFirstName,
			lastName: input.businessContactLastName
		});

		const primaryOperatorRole = ONBOARDING_OPERATOR_ROLES.includes(input.primaryOperatorRole)
			? input.primaryOperatorRole
			: 'owner_founder';

		return {
			now,
			workspaceId,
			primaryMemberId: LOCAL_PRIMARY_MEMBER_ID,
			onboardingVersion: LOCAL_ONBOARDING_VERSION,
			memberEmail: businessContactEmail,
			avatarPath: '',
			workspaceRole: 'owner',
			onboardingCompletedAt: null,
			displayName,
			countryCode: regionalDefaults.countryCode,
			businessName,
			logoFilePath: input.logoFilePath,
			businessIdLabel: regionalDefaults.businessIdLabel,
			businessIdValue,
			taxIdLabel: regionalDefaults.taxIdLabel,
			taxIdValue: '',
			taxDisplayLabel: regionalDefaults.taxDisplayLabel,
			taxRatePercentage: regionalDefaults.taxRatePercentage,
			businessContactName: businessContactName.displayName,
			businessContactFirstName: businessContactName.firstName,
			businessContactLastName: businessContactName.lastName,
			businessContactEmail,
			businessContactPhone: businessPhone.displayPhone,
			businessContactPhoneE164: businessPhone.e164,
			businessContactPhoneCountryCode: businessPhone.phoneCountryCode,
			currencyCode: regionalDefaults.currencyCode,
			currencySymbol: regionalDefaults.currencySymbol,
			measurementUnit: regionalDefaults.measurementUnit,
			dateFormat: regionalDefaults.dateFormat,
			languageLocale: regionalDefaults.languageLocale,
			numberLocale: regionalDefaults.numberLocale,
			primaryOperatorRole,
			industry: normaliseOptionalText(input.industry)
		};
	}

	async bootstrapWorkspaceFoundation(input: {
		workspaceId: string;
		displayName: string;
		countryCode: string;
		businessName: string;
		logoFilePath: string;
		businessContactFirstName: string;
		businessContactLastName: string;
		primaryMemberFirstName?: string;
		primaryMemberLastName?: string;
		businessContactEmail: string;
		businessContactPhone: string;
		businessIdValue: string;
		primaryOperatorRole: WorkspaceOnboardingProfile['primaryOperatorRole'];
		industry: string;
	}): Promise<{
		workspaceIdentity: WorkspaceIdentity;
		workspaceProfile: WorkspaceProfile;
		workspaceMember: WorkspaceMember;
	}> {
		const now = new Date().toISOString();
		const workspaceId = input.workspaceId.trim() || LOCAL_WORKSPACE_ID;
		const displayName = input.displayName.trim() || DEFAULT_WORKSPACE_NAME;
		const businessName = input.businessName.trim();
		const countryCode = normaliseCountryCode(input.countryCode);
		const regionalDefaults = buildWorkspaceRegionalDefaults(countryCode);
		const businessPhone = normalisePhoneForWorkspace(input.businessContactPhone, countryCode);
		const businessContactEmail = normaliseEmailValue(input.businessContactEmail);
		const businessIdValue = normaliseOptionalText(input.businessIdValue);
		const businessContactName = resolvePersonNameParts({
			firstName: input.businessContactFirstName,
			lastName: input.businessContactLastName
		});
		const primaryMemberName = resolvePersonNameParts({
			firstName: input.primaryMemberFirstName,
			lastName: input.primaryMemberLastName,
			displayName: businessContactName.displayName
		});

		if (!isTauri()) {
			return {
				workspaceIdentity: {
					id: workspaceId,
					bootstrapCompletedAt: now,
					onboardingCompletedAt: null,
					onboardingVersion: LOCAL_ONBOARDING_VERSION,
					workspaceRole: 'owner',
					created_at: now,
					updated_at: now
				},
				workspaceProfile: {
					workspaceId,
					displayName,
					countryCode: regionalDefaults.countryCode,
					businessName,
					logoFilePath: input.logoFilePath,
					aiPlaybookText: '',
					businessIdLabel: regionalDefaults.businessIdLabel,
					businessIdValue,
					taxIdLabel: regionalDefaults.taxIdLabel,
					taxIdValue: '',
					taxDisplayLabel: regionalDefaults.taxDisplayLabel,
					taxRatePercentage: regionalDefaults.taxRatePercentage,
					businessAddress: '',
					businessContactName: businessContactName.displayName,
					businessContactFirstName: businessContactName.firstName,
					businessContactLastName: businessContactName.lastName,
					businessContactEmail,
					businessContactPhone: businessPhone.displayPhone,
					businessContactPhoneE164: businessPhone.e164,
					businessContactPhoneCountryCode: businessPhone.phoneCountryCode,
					currencyCode: regionalDefaults.currencyCode,
					currencySymbol: regionalDefaults.currencySymbol,
					measurementUnit: regionalDefaults.measurementUnit,
					dateFormat: regionalDefaults.dateFormat,
					languageLocale: regionalDefaults.languageLocale,
					numberLocale: regionalDefaults.numberLocale,
					quotePaymentTerms: DEFAULT_QUOTE_PAYMENT_TERMS,
					quoteValidityDays: DEFAULT_QUOTE_VALIDITY_DAYS,
					quoteDefaultInclusions: '',
					quoteDefaultExclusions: '',
					quoteDefaultTerms: '',
					quoteNumberPrefix: DEFAULT_QUOTE_NUMBER_PREFIX,
					quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
					emailSignature: '',
					created_at: now,
					updated_at: now
				},
				workspaceMember: {
					id: LOCAL_PRIMARY_MEMBER_ID,
					workspaceId,
					role: 'owner',
					displayName: primaryMemberName.displayName,
					firstName: primaryMemberName.firstName,
					lastName: primaryMemberName.lastName,
					email: businessContactEmail,
					avatarPath: '',
					isPrimary: true,
					joinedAt: now,
					created_at: now,
					updated_at: now
				}
			};
		}

		await this.init();
		const foundationInput = this.buildBootstrapFoundationCommandInput(input);
		await this.withWriteLock(async () => {
			await invoke('upsert_local_bootstrap_foundation', {
				input: foundationInput
			});
		});

		await this.ensureDefaultClassificationSystem();

		const [workspaceIdentity, workspaceProfile, workspaceMember] = await Promise.all([
			this.getWorkspaceIdentity(),
			this.getWorkspaceProfile(),
			this.getPrimaryWorkspaceMember()
		]);

		if (!workspaceIdentity || !workspaceProfile || !workspaceMember) {
			throw new Error('Workspace foundation records were missing after bootstrap.');
		}

		return {
			workspaceIdentity,
			workspaceProfile,
			workspaceMember
		};
	}

	private async getWorkspaceIdForWrite(): Promise<string> {
		const workspace = await this.getWorkspaceIdentity();
		if (!workspace) throw new Error('Workspace is not initialised');
		return workspace.id;
	}

	async ensureDefaultClassificationSystem(): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			const existing = await this.kysely!.selectFrom('classification_systems')
				.select('id')
				.where('workspace_id', '=', workspaceId)
				.limit(1)
				.executeTakeFirst();
			if (existing) return;
			await this.kysely!.insertInto('classification_systems')
				.values({
					id: 'cls-custom',
					workspace_id: workspaceId,
					name: 'Custom',
					code: 'CUSTOM',
					classification_type: 'custom',
					aliases_json: '[]',
					is_default: 1
				})
				.execute();
		});
	}

	async markWorkspaceOnboardingCompleted(completedAt = new Date().toISOString()): Promise<string> {
		if (!isTauri()) return completedAt;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			await this.kysely!.updateTable('workspace_identity')
				.set({
					onboarding_completed_at: completedAt,
					updated_at: new Date().toISOString()
				})
				.where('id', '=', workspaceId)
				.execute();
		});
		return completedAt;
	}

	async updateWorkspaceProfile(
		updates: Partial<
			Pick<
				WorkspaceProfile,
				| 'displayName'
				| 'countryCode'
				| 'businessName'
				| 'logoFilePath'
				| 'aiPlaybookText'
				| 'emailSignature'
				| 'businessIdValue'
				| 'taxIdValue'
				| 'businessAddress'
				| 'businessContactName'
				| 'businessContactFirstName'
				| 'businessContactLastName'
				| 'businessContactEmail'
				| 'businessContactPhone'
				| 'currencyCode'
				| 'currencySymbol'
				| 'measurementUnit'
				| 'dateFormat'
				| 'languageLocale'
				| 'numberLocale'
				| 'taxRatePercentage'
				| 'quotePaymentTerms'
				| 'quoteValidityDays'
				| 'quoteDefaultInclusions'
				| 'quoteDefaultExclusions'
				| 'quoteDefaultTerms'
				| 'quoteNumberPrefix'
				| 'quoteNumberFormat'
			>
		>
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const currentProfile = await this.getWorkspaceProfile();
		const workspaceId = currentProfile?.workspaceId ?? (await this.getWorkspaceIdForWrite());
		const countryCode = normaliseCountryCode(updates.countryCode ?? currentProfile?.countryCode);
		const regionalDefaults = buildWorkspaceRegionalDefaults(countryCode);
		const currencyCode = this.sanitizeCurrencyCode(
			updates.currencyCode ?? currentProfile?.currencyCode ?? regionalDefaults.currencyCode
		);
		const languageLocale = this.sanitizeLanguageLocale(
			updates.languageLocale ?? currentProfile?.languageLocale ?? regionalDefaults.languageLocale
		);
		const numberLocale = this.sanitizeNumberLocale(
			updates.numberLocale ?? currentProfile?.numberLocale ?? regionalDefaults.numberLocale
		);
		const taxRatePercentage = this.sanitizeTaxRatePercentage(
			updates.taxRatePercentage,
			currentProfile?.taxRatePercentage ?? regionalDefaults.taxRatePercentage
		);
		const businessPhone = normalisePhoneForWorkspace(
			updates.businessContactPhone ?? currentProfile?.businessContactPhone,
			countryCode
		);
		const quoteValidityDays = Math.max(
			1,
			Math.trunc(
				updates.quoteValidityDays ??
					currentProfile?.quoteValidityDays ??
					DEFAULT_QUOTE_VALIDITY_DAYS
			)
		);
		const businessContactName = resolvePersonNameParts({
			firstName: updates.businessContactFirstName ?? currentProfile?.businessContactFirstName,
			lastName: updates.businessContactLastName ?? currentProfile?.businessContactLastName,
			displayName: updates.businessContactName ?? currentProfile?.businessContactName
		});
		await this.withWriteLock(async () => {
			await this.kysely!.updateTable('workspace_profile')
				.set({
					display_name: updates.displayName ?? undefined,
					country_code: updates.countryCode !== undefined ? countryCode : undefined,
					business_name: updates.businessName ?? undefined,
					logo_file_path: updates.logoFilePath ?? undefined,
					ai_playbook_text: updates.aiPlaybookText ?? undefined,
					email_signature: updates.emailSignature ?? undefined,
					business_id_label:
						updates.countryCode !== undefined ? regionalDefaults.businessIdLabel : undefined,
					business_id_value: updates.businessIdValue ?? undefined,
					tax_id_label: updates.countryCode !== undefined ? regionalDefaults.taxIdLabel : undefined,
					tax_id_value: updates.taxIdValue ?? undefined,
					tax_display_label:
						updates.countryCode !== undefined ? regionalDefaults.taxDisplayLabel : undefined,
					tax_rate_percentage:
						updates.taxRatePercentage !== undefined || updates.countryCode !== undefined
							? taxRatePercentage
							: undefined,
					abn:
						updates.countryCode !== undefined || updates.businessIdValue !== undefined
							? regionalDefaults.businessIdLabel === 'ABN'
								? (updates.businessIdValue ?? currentProfile?.businessIdValue ?? '')
								: ''
							: undefined,
					business_address: updates.businessAddress ?? undefined,
					business_contact_name:
						updates.businessContactName !== undefined ||
						updates.businessContactFirstName !== undefined ||
						updates.businessContactLastName !== undefined
							? businessContactName.displayName
							: undefined,
					business_contact_first_name:
						updates.businessContactName !== undefined ||
						updates.businessContactFirstName !== undefined ||
						updates.businessContactLastName !== undefined
							? businessContactName.firstName
							: undefined,
					business_contact_last_name:
						updates.businessContactName !== undefined ||
						updates.businessContactFirstName !== undefined ||
						updates.businessContactLastName !== undefined
							? businessContactName.lastName
							: undefined,
					business_contact_email:
						updates.businessContactEmail !== undefined
							? normaliseEmailValue(updates.businessContactEmail)
							: undefined,
					business_contact_phone:
						updates.businessContactPhone !== undefined ? businessPhone.displayPhone : undefined,
					business_contact_phone_e164:
						updates.businessContactPhone !== undefined ? businessPhone.e164 : undefined,
					business_contact_phone_country_code:
						updates.businessContactPhone !== undefined || updates.countryCode !== undefined
							? businessPhone.phoneCountryCode
							: undefined,
					currency_symbol:
						updates.currencyCode !== undefined ||
						updates.currencySymbol !== undefined ||
						updates.countryCode !== undefined
							? getCurrencySymbol(currencyCode)
							: undefined,
					currency_code:
						updates.currencyCode !== undefined || updates.countryCode !== undefined
							? currencyCode
							: undefined,
					measurement_unit:
						updates.measurementUnit !== undefined || updates.countryCode !== undefined
							? this.sanitizeMeasurementUnit(
									updates.measurementUnit ?? regionalDefaults.measurementUnit
								)
							: undefined,
					date_format:
						updates.dateFormat !== undefined || updates.countryCode !== undefined
							? this.sanitizeDateFormat(updates.dateFormat ?? regionalDefaults.dateFormat)
							: undefined,
					language_locale:
						updates.languageLocale !== undefined || updates.countryCode !== undefined
							? languageLocale
							: undefined,
					number_locale:
						updates.numberLocale !== undefined || updates.countryCode !== undefined
							? numberLocale
							: undefined,
					quote_payment_terms: updates.quotePaymentTerms ?? undefined,
					quote_validity_days:
						updates.quoteValidityDays !== undefined ? quoteValidityDays : undefined,
					quote_default_inclusions: updates.quoteDefaultInclusions ?? undefined,
					quote_default_exclusions: updates.quoteDefaultExclusions ?? undefined,
					quote_default_terms: updates.quoteDefaultTerms ?? undefined,
					quote_number_prefix: updates.quoteNumberPrefix ?? undefined,
					quote_number_format: updates.quoteNumberFormat ?? undefined,
					updated_at: new Date().toISOString()
				})
				.where('workspace_id', '=', workspaceId)
				.execute();
		});
	}

	async getWorkspaceAiKnowledgeFiles(): Promise<WorkspaceAiKnowledgeFile[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const rows = await this.kysely!.selectFrom('workspace_ai_knowledge_files')
				.selectAll()
				.where('workspace_id', '=', LOCAL_WORKSPACE_ID)
				.orderBy('created_at', 'asc')
				.execute();
			return rows.map((row) => this.mapWorkspaceAiKnowledgeFileRow(row));
		} catch (err) {
			log.error(`Failed to fetch workspace AI knowledge files: ${err}`);
			return [];
		}
	}

	async getWorkspaceAiFeedbackEntries(): Promise<WorkspaceAiFeedbackEntry[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const rows = await this.kysely!.selectFrom('workspace_ai_feedback_entries')
				.innerJoin('ai_runs', 'ai_runs.id', 'workspace_ai_feedback_entries.run_id')
				.innerJoin('assets', 'assets.id', 'ai_runs.asset_id')
				.innerJoin('projects', 'projects.id', 'assets.project_id')
				.selectAll('workspace_ai_feedback_entries')
				.where('workspace_ai_feedback_entries.workspace_id', '=', LOCAL_WORKSPACE_ID)
				.where('projects.workspace_id', '=', LOCAL_WORKSPACE_ID)
				.orderBy('workspace_ai_feedback_entries.created_at', 'desc')
				.execute();
			return rows.map((row) => this.mapWorkspaceAiFeedbackEntryRow(row));
		} catch (err) {
			log.error(`Failed to fetch workspace AI feedback entries: ${err}`);
			return [];
		}
	}

	async addWorkspaceAiKnowledgeFile(file: {
		id: string;
		filePath: string;
		originalName: string;
		mimeType: string | null;
		byteSize: number;
		extractedText: string;
	}): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			await this.kysely!.insertInto('workspace_ai_knowledge_files')
				.values({
					id: file.id,
					workspace_id: LOCAL_WORKSPACE_ID,
					file_path: file.filePath,
					original_name: file.originalName,
					mime_type: file.mimeType,
					byte_size: file.byteSize,
					extracted_text: file.extractedText
				})
				.execute();
		});
	}

	async addWorkspaceAiFeedbackEntry(entry: {
		id: string;
		runId: string;
		assetId: string | null;
		estimateId: string | null;
		feedbackText: string;
		createdAt: string;
	}): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			await this.kysely!.insertInto('workspace_ai_feedback_entries')
				.values({
					id: entry.id,
					workspace_id: LOCAL_WORKSPACE_ID,
					run_id: entry.runId,
					asset_id: entry.assetId,
					estimate_id: entry.estimateId,
					feedback_text: entry.feedbackText,
					created_at: entry.createdAt
				})
				.execute();
		});
	}

	async removeWorkspaceAiKnowledgeFile(id: string): Promise<WorkspaceAiKnowledgeFile | null> {
		if (!isTauri()) return null;
		await this.init();
		const existing = await this.kysely!.selectFrom('workspace_ai_knowledge_files')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', LOCAL_WORKSPACE_ID)
			.executeTakeFirst();
		if (!existing) return null;

		await this.withWriteLock(async () => {
			await this.kysely!.deleteFrom('workspace_ai_knowledge_files')
				.where('id', '=', id)
				.where('workspace_id', '=', LOCAL_WORKSPACE_ID)
				.execute();
		});

		return this.mapWorkspaceAiKnowledgeFileRow(existing);
	}

	async removeWorkspaceAiFeedbackEntry(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			await this.kysely!.deleteFrom('workspace_ai_feedback_entries')
				.where('id', '=', id)
				.where('workspace_id', '=', LOCAL_WORKSPACE_ID)
				.execute();
		});
	}

	async clearWorkspaceAiFeedbackEntries(): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			await this.kysely!.deleteFrom('workspace_ai_feedback_entries')
				.where('workspace_id', '=', LOCAL_WORKSPACE_ID)
				.execute();
		});
	}

	async persistPageChunks(
		fileId: string,
		chunks: Array<{ pageNumber: number; textContent: string; chunkIndex?: number }>
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.deleteFrom('project_file_page_chunks')
					.where('file_id', '=', fileId)
					.execute();

				if (chunks.length === 0) return;

				const values = chunks.map((chunk, idx) => {
					const wordCount = chunk.textContent.split(/\s+/).filter(Boolean).length;
					return {
						id: crypto.randomUUID(),
						file_id: fileId,
						page_number: chunk.pageNumber,
						chunk_index: chunk.chunkIndex ?? idx,
						text_content: chunk.textContent,
						word_count: wordCount
					};
				});

				await this.kysely!.insertInto('project_file_page_chunks').values(values).execute();
			} catch (err) {
				log.error(`Failed to persist page chunks for file ${fileId}: ${err}`);
				throw err;
			}
		});
	}

	async searchPageChunks(
		fileId: string,
		query: string,
		limit: number
	): Promise<Array<{ page_number: number; text_content: string }>> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const rows = await sql<{ page_number: number; text_content: string }>`
				SELECT c.page_number, c.text_content
				FROM project_file_page_chunks_fts f
				JOIN project_file_page_chunks c ON c.rowid = f.rowid
				WHERE c.file_id = ${fileId} AND project_file_page_chunks_fts MATCH ${query}
				ORDER BY f.rank ASC
				LIMIT ${limit}
			`.execute(this.kysely!);
			return rows.rows;
		} catch (err) {
			log.error(`Failed to search page chunks for file ${fileId}: ${err}`);
			return [];
		}
	}

	async searchProjectPageChunks(
		projectId: string,
		query: string,
		limit: number
	): Promise<
		Array<{ file_id: string; file_name: string; page_number: number; text_content: string }>
	> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const rows = await sql<{
				file_id: string;
				file_name: string;
				page_number: number;
				text_content: string;
			}>`
				SELECT c.file_id, f_orig.original_name as file_name, c.page_number, c.text_content
				FROM project_file_page_chunks_fts f
				JOIN project_file_page_chunks c ON c.rowid = f.rowid
				JOIN files f_orig ON f_orig.id = c.file_id
				WHERE f_orig.project_id = ${projectId} AND project_file_page_chunks_fts MATCH ${query}
				ORDER BY f.rank ASC
				LIMIT ${limit}
			`.execute(this.kysely!);
			return rows.rows;
		} catch (err) {
			log.error(`Failed to search project page chunks for project ${projectId}: ${err}`);
			return [];
		}
	}

	async updateWorkspaceOnboardingProfile(
		updates: Partial<Pick<WorkspaceOnboardingProfile, 'primaryOperatorRole' | 'industry'>>
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId =
			(await this.getWorkspaceIdentity())?.id ?? (await this.getWorkspaceIdForWrite());
		const current = await this.getWorkspaceOnboardingProfile();
		const primaryOperatorRole =
			updates.primaryOperatorRole ?? current?.primaryOperatorRole ?? 'owner_founder';
		await this.withWriteLock(async () => {
			await this.kysely!.insertInto('workspace_onboarding_profile')
				.values({
					workspace_id: workspaceId,
					primary_operator_role: ONBOARDING_OPERATOR_ROLES.includes(primaryOperatorRole)
						? primaryOperatorRole
						: 'owner_founder',
					industry: normaliseOptionalText(updates.industry)
				})
				.onConflict((oc) =>
					oc.column('workspace_id').doUpdateSet({
						primary_operator_role: ONBOARDING_OPERATOR_ROLES.includes(primaryOperatorRole)
							? primaryOperatorRole
							: 'owner_founder',
						industry: updates.industry ?? undefined,
						updated_at: new Date().toISOString()
					})
				)
				.execute();
		});
	}

	async updatePrimaryWorkspaceMember(
		updates: Partial<Pick<WorkspaceMember, 'displayName' | 'email' | 'avatarPath' | 'role'>>
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const memberId = (await this.getPrimaryWorkspaceMember())?.id ?? LOCAL_PRIMARY_MEMBER_ID;
		await this.withWriteLock(async () => {
			await this.kysely!.updateTable('workspace_members')
				.set({
					display_name: updates.displayName ?? undefined,
					email: updates.email !== undefined ? normaliseEmailValue(updates.email) : undefined,
					avatar_path: updates.avatarPath ?? undefined,
					role: updates.role ?? undefined,
					updated_at: new Date().toISOString()
				})
				.where('id', '=', memberId)
				.execute();
		});
	}

	async resetWorkspace(): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await storeService.withManagedFileMutation(() => invoke('reset_active_workspace_command'));
			} catch (err) {
				log.error(`Failed to reset workspace: ${err}`);
				throw err;
			}
		});
	}

	// --- Projects ---

	async getProjects(): Promise<Project[]> {
		if (!isTauri()) return MOCK_PROJECTS;
		await this.init();
		try {
			if (!this.db) throw new Error('The workspace database is not available.');
			const workspaceId = await this.getWorkspaceIdForWrite();
			const raw = await this.db.select<unknown[]>(
				`SELECT
					p.*,
					COALESCE(c.display_name, c.name, p.contact_name_snapshot) AS contact_name,
					COALESCE(rc.display_name, rc.name, p.requester_name_snapshot) AS requester_contact_name,
					(SELECT COUNT(*) FROM files WHERE project_id = p.id) AS asset_count
				FROM projects p
				LEFT JOIN contacts c ON c.id = p.contact_id
				LEFT JOIN contacts rc ON rc.id = p.requester_contact_id
				WHERE p.workspace_id = $1
				ORDER BY p.sort_order ASC, p.created_at DESC`,
				[workspaceId]
			);
			const parsed = ProjectArraySchema.safeParse(raw);
			if (!parsed.success) {
				log.error(`ProjectArraySchema validation failed: ${JSON.stringify(parsed.error.format())}`);
				return [];
			}
			return parsed.data.map((project) => ({
				...project,
				contact_name: project.contact_name ?? getProjectContactDisplayName(project),
				requester_contact_name:
					project.requester_contact_name ?? project.requester_name_snapshot ?? null
			})) as Project[];
		} catch (err) {
			log.error(`Failed to fetch projects: ${err}`);
			return [];
		}
	}

	async getProjectById(id: string): Promise<Project | null> {
		if (!isTauri()) return mockProjectsMap.get(id) ?? null;
		await this.init();
		try {
			const workspaceId = await this.getWorkspaceIdForWrite();
			const raw = await this.db!.select<unknown[]>(
				`SELECT
					p.*,
					COALESCE(c.display_name, c.name, p.contact_name_snapshot) AS contact_name,
					COALESCE(rc.display_name, rc.name, p.requester_name_snapshot) AS requester_contact_name,
					(SELECT COUNT(*) FROM files WHERE project_id = p.id) AS asset_count
				FROM projects p
				LEFT JOIN contacts c ON c.id = p.contact_id
				LEFT JOIN contacts rc ON rc.id = p.requester_contact_id
				WHERE p.id = $1 AND p.workspace_id = $2`,
				[id, workspaceId]
			);
			const parsed = ProjectArraySchema.safeParse(raw);
			if (!parsed.success) {
				log.error(`getProjectById schema mismatch: ${JSON.stringify(parsed.error.format())}`);
				return null;
			}
			const project = parsed.data[0];
			return project
				? ({
						...project,
						contact_name: project.contact_name ?? getProjectContactDisplayName(project),
						requester_contact_name:
							project.requester_contact_name ?? project.requester_name_snapshot ?? null
					} as Project)
				: null;
		} catch (err) {
			log.error(`Failed to fetch project by id: ${err}`);
			return null;
		}
	}

	async getRecentProjects(limit: number = 5): Promise<Project[]> {
		if (!isTauri()) return MOCK_PROJECTS.slice(0, limit);
		await this.init();
		try {
			if (!this.db) throw new Error('The workspace database is not available.');
			const workspaceId = await this.getWorkspaceIdForWrite();
			const raw = await this.db.select<unknown[]>(
				`SELECT
					p.*,
					COALESCE(c.display_name, c.name, p.contact_name_snapshot) AS contact_name,
					COALESCE(rc.display_name, rc.name, p.requester_name_snapshot) AS requester_contact_name,
					(SELECT COUNT(*) FROM files WHERE project_id = p.id) AS asset_count
				FROM projects p
				LEFT JOIN contacts c ON c.id = p.contact_id
				LEFT JOIN contacts rc ON rc.id = p.requester_contact_id
				WHERE p.workspace_id = $1
				ORDER BY p.created_at DESC
				LIMIT $2`,
				[workspaceId, limit]
			);
			const parsed = ProjectArraySchema.safeParse(raw);
			if (!parsed.success) {
				log.error(`ProjectArraySchema validation failed: ${JSON.stringify(parsed.error.format())}`);
				return [];
			}
			return parsed.data.map((project) => ({
				...project,
				contact_name: project.contact_name ?? getProjectContactDisplayName(project),
				requester_contact_name:
					project.requester_contact_name ?? project.requester_name_snapshot ?? null
			})) as Project[];
		} catch (err) {
			log.error(`Failed to fetch recent projects: ${err}`);
			return [];
		}
	}

	async addProject(
		id: string,
		rfqNumber: string,
		contactId?: string | null,
		contactNameSnapshot?: string,
		projectName?: string,
		dueDate?: string,
		priority?: PriorityLevel,
		status?: ProjectStatus,
		content?: string,
		note?: string,
		requesterContactId?: string | null,
		requesterNameSnapshot?: string,
		sourceChannel: Project['source_channel'] = 'manual',
		sourceReference?: string,
		receivedDate?: string,
		submissionDeadlineAt?: string,
		estimatorName?: string,
		customerTenderReference?: string,
		addendumLabel?: string,
		addendumDate?: string,
		addendumNotes?: string,
		siteAddress?: string,
		deliveryAddress?: string
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				const sortOrder = await this.getNextProjectSortOrder(workspaceId);
				const now = new Date().toISOString();
				await invoke('add_project_command', {
					input: {
						id,
						workspaceId,
						sortOrder,
						rfqNumber,
						contactId: contactId ?? null,
						contactNameSnapshot: contactNameSnapshot ?? null,
						requesterContactId: requesterContactId ?? null,
						requesterNameSnapshot: requesterNameSnapshot ?? null,
						projectName: projectName ?? null,
						dueDate: dueDate ?? null,
						receivedDate: receivedDate ?? null,
						submissionDeadlineAt: submissionDeadlineAt ?? null,
						estimatorName: estimatorName ?? '',
						customerTenderReference: customerTenderReference ?? '',
						addendumLabel: addendumLabel ?? '',
						addendumDate: addendumDate ?? null,
						addendumNotes: addendumNotes ?? '',
						siteAddress: siteAddress ?? '',
						deliveryAddress: deliveryAddress ?? '',
						sourceChannel: sourceChannel ?? 'manual',
						sourceReference: sourceReference ?? null,
						priority: priority ?? PriorityLevel.Medium,
						status: status ?? ProjectStatus.Draft,
						content: content ?? null,
						note: note ?? null,
						updatedAt: now
					}
				});
			} catch (err) {
				log.error(`Failed to add project: ${err}`);
				throw err;
			}
		});
	}

	async getLocalBootstrapDataCounts(): Promise<{ projectCount: number; customerCount: number }> {
		if (!isTauri()) {
			return {
				projectCount: MOCK_PROJECTS.length,
				customerCount: 0
			};
		}
		await this.init();
		try {
			const workspaceId = await this.getWorkspaceIdForWrite();
			const raw = await this.db!.select<
				Array<{
					project_count: number | string;
					contact_count: number | string;
				}>
			>(
				`SELECT
					(SELECT COUNT(*) FROM projects WHERE workspace_id = $1) AS project_count,
					(SELECT COUNT(*) FROM contacts WHERE workspace_id = $1) AS contact_count`,
				[workspaceId]
			);
			const counts = raw[0];
			return {
				projectCount: Number(counts?.project_count ?? 0),
				customerCount: Number(counts?.contact_count ?? 0)
			};
		} catch (err) {
			log.error(`Failed to inspect local bootstrap counts: ${err}`);
			throw err;
		}
	}

	async getOptionalSetupPageRecordCounts(): Promise<Record<OptionalSetupPageId, number>> {
		const emptyCounts: Record<OptionalSetupPageId, number> = {
			materials: 0,
			'labour-rates': 0,
			'equipment-rates': 0,
			'subcontract-rates': 0,
			'cost-presets': 0,
			'estimate-templates': 0
		};

		if (!isTauri()) {
			return emptyCounts;
		}
		await this.init();
		try {
			const workspaceId = await this.getWorkspaceIdForWrite();
			const raw = await this.db!.select<
				Array<{
					materials_count: number | string;
					labour_rates_count: number | string;
					equipment_rates_count: number | string;
					subcontract_rates_count: number | string;
					cost_presets_count: number | string;
					estimate_templates_count: number | string;
				}>
			>(
				`SELECT
					(SELECT COUNT(*) FROM material_catalog_items WHERE workspace_id = $1) AS materials_count,
					(SELECT COUNT(*) FROM labour_rate_cards WHERE workspace_id = $2) AS labour_rates_count,
					(SELECT COUNT(*) FROM equipment_rate_cards WHERE workspace_id = $3) AS equipment_rates_count,
					(SELECT COUNT(*) FROM subcontract_rate_cards WHERE workspace_id = $4) AS subcontract_rates_count,
					(SELECT COUNT(*) FROM cost_component_presets WHERE workspace_id = $5) AS cost_presets_count,
					(SELECT COUNT(*) FROM estimate_templates WHERE workspace_id = $6) AS estimate_templates_count`,
				[workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId]
			);
			const counts = raw[0];
			return {
				materials: Number(counts?.materials_count ?? 0),
				'labour-rates': Number(counts?.labour_rates_count ?? 0),
				'equipment-rates': Number(counts?.equipment_rates_count ?? 0),
				'subcontract-rates': Number(counts?.subcontract_rates_count ?? 0),
				'cost-presets': Number(counts?.cost_presets_count ?? 0),
				'estimate-templates': Number(counts?.estimate_templates_count ?? 0)
			};
		} catch (err) {
			log.error(`Failed to inspect optional setup page record counts: ${err}`);
			throw err;
		}
	}

	async getWorkspaceOverviewCounts(): Promise<{
		projectCount: number;
		activeProjectCount: number;
		contactCount: number;
		materialsCount: number;
		labourRateCount: number;
		equipmentRateCount: number;
		subcontractRateCount: number;
		costPresetCount: number;
		estimateTemplateCount: number;
		classificationCount: number;
		projectStructureTemplateCount: number;
	}> {
		if (!isTauri()) {
			const [
				projects,
				contacts,
				materials,
				labourRates,
				equipmentRates,
				subcontractRates,
				costPresets,
				estimateTemplates,
				classificationSystems,
				projectStructureTemplates
			] = await Promise.all([
				this.getProjects(),
				this.getContacts(),
				this.getMaterialCatalogueItems(),
				this.getLabourRateCards(),
				this.getEquipmentRateCards(),
				this.getSubcontractRateCards(),
				this.getCostComponentPresets(),
				this.getEstimateTemplates(),
				this.getClassificationSystems(),
				this.getProjectStructureTemplates()
			]);
			return {
				projectCount: projects.length,
				activeProjectCount: projects.filter((project) => project.status !== ProjectStatus.Archived)
					.length,
				contactCount: contacts.length,
				materialsCount: materials.length,
				labourRateCount: labourRates.length,
				equipmentRateCount: equipmentRates.length,
				subcontractRateCount: subcontractRates.length,
				costPresetCount: costPresets.length,
				estimateTemplateCount: estimateTemplates.length,
				classificationCount: classificationSystems.length,
				projectStructureTemplateCount: projectStructureTemplates.length
			};
		}

		await this.init();
		try {
			const workspaceId = await this.getWorkspaceIdForWrite();
			const raw = await this.db!.select<
				Array<{
					project_count: number | string;
					active_project_count: number | string;
					contact_count: number | string;
					materials_count: number | string;
					labour_rates_count: number | string;
					equipment_rates_count: number | string;
					subcontract_rates_count: number | string;
					cost_presets_count: number | string;
					estimate_templates_count: number | string;
					classification_count: number | string;
					project_structure_templates_count: number | string;
				}>
			>(
				`SELECT
					(SELECT COUNT(*) FROM projects WHERE workspace_id = $1) AS project_count,
					(SELECT COUNT(*) FROM projects WHERE workspace_id = $2 AND status != 'archived') AS active_project_count,
					(SELECT COUNT(*) FROM contacts WHERE workspace_id = $3) AS contact_count,
					(SELECT COUNT(*) FROM material_catalog_items WHERE workspace_id = $4) AS materials_count,
					(SELECT COUNT(*) FROM labour_rate_cards WHERE workspace_id = $5) AS labour_rates_count,
					(SELECT COUNT(*) FROM equipment_rate_cards WHERE workspace_id = $6) AS equipment_rates_count,
					(SELECT COUNT(*) FROM subcontract_rate_cards WHERE workspace_id = $7) AS subcontract_rates_count,
					(SELECT COUNT(*) FROM cost_component_presets WHERE workspace_id = $8) AS cost_presets_count,
					(SELECT COUNT(*) FROM estimate_templates WHERE workspace_id = $9) AS estimate_templates_count,
					(SELECT COUNT(*) FROM classification_systems WHERE workspace_id = $10) AS classification_count,
					(SELECT COUNT(*) FROM project_structure_templates WHERE workspace_id = $11) AS project_structure_templates_count`,
				[
					workspaceId,
					workspaceId,
					workspaceId,
					workspaceId,
					workspaceId,
					workspaceId,
					workspaceId,
					workspaceId,
					workspaceId,
					workspaceId,
					workspaceId
				]
			);
			const counts = raw[0];
			return {
				projectCount: Number(counts?.project_count ?? 0),
				activeProjectCount: Number(counts?.active_project_count ?? 0),
				contactCount: Number(counts?.contact_count ?? 0),
				materialsCount: Number(counts?.materials_count ?? 0),
				labourRateCount: Number(counts?.labour_rates_count ?? 0),
				equipmentRateCount: Number(counts?.equipment_rates_count ?? 0),
				subcontractRateCount: Number(counts?.subcontract_rates_count ?? 0),
				costPresetCount: Number(counts?.cost_presets_count ?? 0),
				estimateTemplateCount: Number(counts?.estimate_templates_count ?? 0),
				classificationCount: Number(counts?.classification_count ?? 0),
				projectStructureTemplateCount: Number(counts?.project_structure_templates_count ?? 0)
			};
		} catch (err) {
			log.error(`Failed to inspect workspace overview counts: ${err}`);
			throw err;
		}
	}

	async createProjectWorkspace(input: {
		id: string;
		rfqNumber: string;
		contactId?: string | null;
		contactNameSnapshot?: string;
		projectName?: string;
		dueDate?: string;
		receivedDate?: string;
		submissionDeadlineAt?: string;
		estimatorName?: string;
		customerTenderReference?: string;
		addendumLabel?: string;
		addendumDate?: string;
		addendumNotes?: string;
		siteAddress?: string;
		deliveryAddress?: string;
		priority?: PriorityLevel;
		status?: ProjectStatus;
		content?: string;
		note?: string;
		requesterContactId?: string | null;
		requesterNameSnapshot?: string;
		quoteRecipientContactId?: string | null;
		sourceChannel?: Project['source_channel'];
		sourceReference?: string;
		sourceEmailMessageId?: string;
		sourceEmailIntegrationId?: string;
		files?: ProjectWorkspaceFileSeed[];
	}): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				const sortOrder = await this.getNextProjectSortOrder(workspaceId);
				const now = new Date().toISOString();
				await invoke('create_project_workspace_command', {
					input: {
						project: {
							id: input.id,
							workspaceId,
							sortOrder,
							rfqNumber: input.rfqNumber,
							contactId: input.contactId ?? null,
							contactNameSnapshot: input.contactNameSnapshot ?? null,
							requesterContactId: input.requesterContactId ?? null,
							requesterNameSnapshot: input.requesterNameSnapshot ?? null,
							quoteRecipientContactId:
								input.quoteRecipientContactId ?? input.requesterContactId ?? null,
							projectName: input.projectName ?? null,
							dueDate: input.dueDate ?? null,
							receivedDate: input.receivedDate ?? null,
							submissionDeadlineAt: input.submissionDeadlineAt ?? null,
							estimatorName: input.estimatorName ?? '',
							customerTenderReference: input.customerTenderReference ?? '',
							addendumLabel: input.addendumLabel ?? '',
							addendumDate: input.addendumDate ?? null,
							addendumNotes: input.addendumNotes ?? '',
							siteAddress: input.siteAddress ?? '',
							deliveryAddress: input.deliveryAddress ?? '',
							sourceChannel: input.sourceChannel ?? 'manual',
							sourceReference: input.sourceReference ?? null,
							sourceEmailMessageId: input.sourceEmailMessageId ?? null,
							sourceEmailIntegrationId: input.sourceEmailIntegrationId ?? null,
							priority: input.priority ?? PriorityLevel.Medium,
							status: input.status ?? ProjectStatus.Draft,
							content: input.content ?? null,
							note: input.note ?? null,
							updatedAt: now
						},
						files: (input.files ?? []).map((file) => ({
							id: file.id,
							filePath: file.file_path,
							originalName: file.original_name,
							mimeType: inferGeneralFileMimeType(file.original_name),
							byteSize: file.byte_size ?? 0,
							contentHash: file.content_hash ?? null,
							documentType: file.document_type ?? '',
							revisionLabel: file.revision_label ?? '',
							receivedAt: file.received_at ?? new Date().toISOString(),
							sourceLabel: file.source_label ?? 'manual_upload',
							sourceMetadataJson: stringifyJson(file.source_metadata ?? {})
						}))
					}
				});
			} catch (err) {
				log.error(`Failed to create project workspace: ${err}`);
				throw err;
			}
		});
	}

	async updateProjectWorkspace(input: {
		id: string;
		rfqNumber?: string;
		contactId?: string | null;
		contactNameSnapshot?: string;
		projectName?: string;
		dueDate?: string;
		receivedDate?: string;
		submissionDeadlineAt?: string;
		estimatorName?: string;
		customerTenderReference?: string;
		addendumLabel?: string;
		addendumDate?: string;
		addendumNotes?: string;
		siteAddress?: string;
		deliveryAddress?: string;
		priority?: PriorityLevel;
		status?: ProjectStatus;
		content?: string;
		note?: string;
		requesterContactId?: string | null;
		requesterNameSnapshot?: string;
		quoteRecipientContactId?: string | null;
		sourceChannel?: Project['source_channel'];
		sourceReference?: string;
		sourceEmailMessageId?: string;
		sourceEmailIntegrationId?: string;
		keepFileIds?: string[];
		newFiles?: ProjectWorkspaceFileSeed[];
	}): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const existingProject = await this.kysely!.selectFrom('projects')
					.select([
						'quote_recipient_contact_id',
						'source_email_message_id',
						'source_email_integration_id'
					])
					.where('id', '=', input.id)
					.executeTakeFirst();
				const quoteRecipientContactId = Object.prototype.hasOwnProperty.call(
					input,
					'quoteRecipientContactId'
				)
					? (input.quoteRecipientContactId ?? null)
					: (existingProject?.quote_recipient_contact_id ?? null);
				const existingFiles = await this.kysely!.selectFrom('files')
					.select(['id', 'asset_id', 'file_path'])
					.where('project_id', '=', input.id)
					.execute();
				const keepFileIdSet = new Set(input.keepFileIds ?? existingFiles.map((file) => file.id));
				const removedFiles = existingFiles.filter((file) => !keepFileIdSet.has(file.id));
				const removedAssetIds = Array.from(
					new Set(
						removedFiles
							.map((file) => file.asset_id)
							.filter((assetId): assetId is string => Boolean(assetId))
					)
				);

				await invoke('update_project_workspace_command', {
					input: {
						id: input.id,
						rfqNumber: input.rfqNumber ?? '',
						contactId: input.contactId ?? null,
						contactNameSnapshot: input.contactNameSnapshot ?? null,
						requesterContactId: input.requesterContactId ?? null,
						requesterNameSnapshot: input.requesterNameSnapshot ?? null,
						quoteRecipientContactId,
						projectName: input.projectName ?? null,
						dueDate: input.dueDate ?? null,
						receivedDate: input.receivedDate ?? null,
						submissionDeadlineAt: input.submissionDeadlineAt ?? null,
						estimatorName: input.estimatorName ?? '',
						customerTenderReference: input.customerTenderReference ?? '',
						addendumLabel: input.addendumLabel ?? '',
						addendumDate: input.addendumDate ?? null,
						addendumNotes: input.addendumNotes ?? '',
						siteAddress: input.siteAddress ?? '',
						deliveryAddress: input.deliveryAddress ?? '',
						sourceChannel: input.sourceChannel ?? 'manual',
						sourceReference: input.sourceReference ?? null,
						sourceEmailMessageId:
							input.sourceEmailMessageId ?? existingProject?.source_email_message_id ?? null,
						sourceEmailIntegrationId:
							input.sourceEmailIntegrationId ??
							existingProject?.source_email_integration_id ??
							null,
						priority: input.priority ?? PriorityLevel.Medium,
						status: input.status ?? ProjectStatus.Draft,
						content: input.content ?? null,
						note: input.note ?? null,
						updatedAt: new Date().toISOString(),
						newFiles: (input.newFiles ?? []).map((file) => ({
							id: file.id,
							filePath: file.file_path,
							originalName: file.original_name,
							mimeType: inferGeneralFileMimeType(file.original_name),
							byteSize: file.byte_size ?? 0,
							contentHash: file.content_hash ?? null,
							documentType: file.document_type ?? '',
							revisionLabel: file.revision_label ?? '',
							receivedAt: file.received_at ?? new Date().toISOString(),
							sourceLabel: file.source_label ?? 'manual_upload',
							sourceMetadataJson: stringifyJson(file.source_metadata ?? {})
						})),
						removedFileIds: removedFiles.map((file) => file.id),
						removedAssetIds
					}
				});

				await Promise.all(
					removedFiles.map((file) =>
						removeDerivedPreviewCacheForSource(file.file_path).catch((cleanupErr) => {
							log.warn(`Derived preview cache cleanup failed for ${file.file_path}: ${cleanupErr}`);
						})
					)
				);
			} catch (err) {
				log.error(`Failed to update project workspace: ${err}`);
				throw err;
			}
		});
	}

	async updateProjectStatuses(ids: string[], status: ProjectStatus): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('projects')
					.set({ status, updated_at: new Date().toISOString() })
					.where('id', 'in', ids)
					.execute();
			} catch (err) {
				log.error(`Failed to update project statuses: ${err}`);
				throw err;
			}
		});
	}

	async updateProject(
		id: string,
		rfqNumber?: string,
		contactId?: string | null,
		contactNameSnapshot?: string,
		projectName?: string,
		dueDate?: string,
		priority?: PriorityLevel,
		status?: ProjectStatus,
		content?: string,
		note?: string,
		requesterContactId?: string | null,
		requesterNameSnapshot?: string,
		sourceChannel: Project['source_channel'] = 'manual',
		sourceReference?: string,
		receivedDate?: string,
		submissionDeadlineAt?: string,
		estimatorName?: string,
		customerTenderReference?: string,
		addendumLabel?: string,
		addendumDate?: string,
		addendumNotes?: string,
		siteAddress?: string,
		deliveryAddress?: string
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('projects')
					.set({
						rfq_number: rfqNumber ?? undefined,
						contact_id: contactId ?? null,
						contact_name_snapshot: contactNameSnapshot ?? null,
						requester_contact_id: requesterContactId ?? null,
						requester_name_snapshot: requesterNameSnapshot ?? null,
						quote_recipient_contact_id: undefined,
						project_name: projectName ?? null,
						due_date: dueDate ?? null,
						received_date: receivedDate ?? null,
						submission_deadline_at: submissionDeadlineAt ?? null,
						estimator_name: estimatorName ?? '',
						customer_tender_reference: customerTenderReference ?? '',
						addendum_label: addendumLabel ?? '',
						addendum_date: addendumDate ?? null,
						addendum_notes: addendumNotes ?? '',
						site_address: siteAddress ?? '',
						delivery_address: deliveryAddress ?? '',
						source_channel: sourceChannel ?? 'manual',
						source_reference: sourceReference ?? null,
						priority: priority ?? PriorityLevel.Medium,
						status: status ?? ProjectStatus.Draft,
						content: content ?? null,
						note: note ?? null,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update project: ${err}`);
				throw err;
			}
		});
	}

	async setProjectFavourite(id: string, isFavourite: boolean): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('projects')
					.set({
						is_favourite: isFavourite ? 1 : 0,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update project favourite: ${err}`);
				throw err;
			}
		});
	}

	async deleteProject(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = (await this.getWorkspaceProfile())?.workspaceId;
		if (!workspaceId) throw new Error('No active workspace profile');
		let sourceFiles: Array<{ id: string; file_path: string }> = [];
		await this.withWriteLock(async () => {
			try {
				sourceFiles = await this.kysely!.selectFrom('files')
					.select(['id', 'file_path'])
					.where('project_id', '=', id)
					.execute();
				await this.kysely!.deleteFrom('workspace_ai_feedback_entries')
					.where((eb) =>
						eb.or([
							eb(
								'asset_id',
								'in',
								eb.selectFrom('assets').select('id').where('project_id', '=', id)
							),
							eb(
								'run_id',
								'in',
								eb
									.selectFrom('ai_runs')
									.innerJoin('assets', 'assets.id', 'ai_runs.asset_id')
									.select('ai_runs.id')
									.where('assets.project_id', '=', id)
							)
						])
					)
					.execute();
				await this.kysely!.deleteFrom('projects').where('id', '=', id).execute();
			} catch (err) {
				log.error(`Failed to delete project: ${err}`);
				throw err;
			}
		});
		try {
			await storeService.withManagedFileMutation(async () =>
				remove(await resolveLocalDocumentPath(projectWorkspacePath(workspaceId, id)), {
					recursive: true
				})
			);
		} catch (fsErr) {
			if (!isMissingPathError(fsErr)) {
				log.warn(`Workspace folder removal failed: ${fsErr}`);
			}
		}
		await Promise.all(
			sourceFiles.flatMap((file) => [
				removeDerivedPreviewCacheForSource(file.file_path).catch((cleanupErr) => {
					log.warn(`Derived preview cache cleanup failed for ${file.file_path}: ${cleanupErr}`);
				}),
				removePreparedEvidenceCacheForSource(file.file_path, file.id).catch((cleanupErr) => {
					log.warn(
						`Prepared AI evidence cache cleanup failed for ${file.file_path}: ${cleanupErr}`
					);
				})
			])
		);
	}

	async duplicateProject(sourceProjectId: string, rfqNumber: string): Promise<string> {
		if (!isTauri()) throw new Error('Project duplication is only available in the desktop app');
		await this.init();

		const sourceProject = await this.getProjectById(sourceProjectId);
		if (!sourceProject) {
			throw new Error('Selected RFQ could not be found');
		}
		const workspaceId = (await this.getWorkspaceProfile())?.workspaceId;
		if (!workspaceId) throw new Error('No active workspace profile');
		const workspaceFileRoot = `${workspaceVaultRelativePath(workspaceId)}/workspace`;

		const sourceFiles = await this.getProjectFiles(sourceProjectId);
		const sourceAssets = await this.getAssetsForProject(sourceProjectId);
		const sourceWbsNodes = await this.getWbsNodes(sourceProjectId);
		const sourceQuoteOptions = await this.getQuoteOptions(sourceProjectId);
		const sourceEstimatesList = await Promise.all(
			sourceAssets.map(async (asset) => ({
				id: asset.id,
				estimate: await this.getEstimate(asset.id)
			}))
		);
		const sourceEstimates = new Map<string, Estimate | null>(
			sourceEstimatesList.map((item) => [item.id, item.estimate])
		);

		const nextProjectId = crypto.randomUUID();
		const copiedWorkspaceRelativePaths: string[] = [];
		const wbsIdMap = new Map<string, string>();
		const assetIdMap = new Map<string, string>();
		const fileIdMap = new Map<string, string>();
		const takeoffIdMaps = new Map<string, Map<string, string>>();

		const cleanupDuplicatedWorkspace = async () => {
			try {
				await storeService.withManagedFileMutation(async () =>
					remove(await resolveLocalDocumentPath(projectWorkspacePath(workspaceId, nextProjectId)), {
						recursive: true
					})
				);
			} catch (cleanupErr) {
				if (!isMissingPathError(cleanupErr)) {
					log.warn(`Failed to clean up duplicated workspace ${nextProjectId}: ${cleanupErr}`);
				}
			}
			await Promise.all(
				copiedWorkspaceRelativePaths.flatMap((copiedRelativePath) => [
					removeDerivedPreviewCacheForSource(copiedRelativePath).catch((cleanupErr) => {
						log.warn(
							`Derived preview cleanup failed for duplicated file ${copiedRelativePath}: ${cleanupErr}`
						);
					}),
					removePreparedEvidenceCacheForSource(copiedRelativePath).catch((cleanupErr) => {
						log.warn(
							`Prepared AI evidence cleanup failed for duplicated file ${copiedRelativePath}: ${cleanupErr}`
						);
					})
				])
			);
		};

		for (const node of sourceWbsNodes) {
			wbsIdMap.set(node.id, crypto.randomUUID());
		}

		for (const asset of sourceAssets) {
			const nextId = crypto.randomUUID();
			assetIdMap.set(asset.id, nextId);
			const sourceEstimate = sourceEstimates.get(asset.id);
			if (sourceEstimate) {
				const takeoffIdMap = new Map<string, string>();
				for (const item of sourceEstimate.takeoff_items) {
					takeoffIdMap.set(item.id, crypto.randomUUID());
				}
				takeoffIdMaps.set(asset.id, takeoffIdMap);
			}
		}

		try {
			await storeService.withManagedFileMutation(async () =>
				mkdir(await resolveLocalDocumentPath(projectWorkspacePath(workspaceId, nextProjectId)), {
					recursive: true
				})
			);

			for (const file of sourceFiles) {
				const nextId = crypto.randomUUID();
				fileIdMap.set(file.id, nextId);

				const sourcePath = file.file_path.startsWith('workspaces\\')
					? file.file_path.replace(/\\/g, '/')
					: file.file_path;
				const nextRelativePath = sourcePath.startsWith(`${workspaceFileRoot}/${sourceProjectId}/`)
					? sourcePath.replace(
							`${workspaceFileRoot}/${sourceProjectId}/`,
							`${workspaceFileRoot}/${nextProjectId}/`
						)
					: `${workspaceFileRoot}/${nextProjectId}/${file.original_name}`;

				await storeService.withManagedFileMutation(async () =>
					copyFile(
						await resolveLocalDocumentPath(`${VAULT_ROOT}/${file.file_path}`),
						await resolveLocalDocumentPath(`${VAULT_ROOT}/${nextRelativePath}`)
					)
				);
				copiedWorkspaceRelativePaths.push(nextRelativePath);
			}
		} catch (err) {
			await cleanupDuplicatedWorkspace();
			log.error(`Failed to duplicate project: ${err}`);
			throw err;
		}

		const quoteOptionRows =
			sourceQuoteOptions.length > 0
				? sourceQuoteOptions.map((option) => ({
						id: crypto.randomUUID(),
						project_id: nextProjectId,
						label: option.label,
						lead_time: option.lead_time,
						markup_percentage: option.markup_percentage,
						notes: option.notes,
						sort_order: option.sort_order,
						is_default: option.is_default
					}))
				: [
						{
							id: crypto.randomUUID(),
							project_id: nextProjectId,
							label: 'Standard',
							lead_time: '2 weeks',
							markup_percentage: 0,
							notes: '',
							sort_order: 0,
							is_default: true
						}
					];

		const wbsRows = sourceWbsNodes.map((node) => ({
			id: wbsIdMap.get(node.id)!,
			project_id: nextProjectId,
			parent_id: node.parent_id ? (wbsIdMap.get(node.parent_id) ?? null) : null,
			code: node.code ?? null,
			name: node.name,
			type: node.type,
			sort_order: node.sort_order
		}));

		const assetRows = sourceAssets.map((asset) => ({
			id: assetIdMap.get(asset.id)!,
			project_id: nextProjectId,
			display_name: asset.display_name,
			thumbnail_file_id: null,
			is_selected: asset.is_selected,
			quote_quantity: asset.quote_quantity ?? 1,
			is_pdf_included: asset.is_pdf_included !== false
		}));

		const fileRows = sourceFiles.map((file) => {
			const sourcePath = file.file_path.startsWith('workspaces\\')
				? file.file_path.replace(/\\/g, '/')
				: file.file_path;
			const nextRelativePath = sourcePath.startsWith(`${workspaceFileRoot}/${sourceProjectId}/`)
				? sourcePath.replace(
						`${workspaceFileRoot}/${sourceProjectId}/`,
						`${workspaceFileRoot}/${nextProjectId}/`
					)
				: `${workspaceFileRoot}/${nextProjectId}/${file.original_name}`;
			return {
				id: fileIdMap.get(file.id)!,
				project_id: nextProjectId,
				asset_id: file.asset_id ? (assetIdMap.get(file.asset_id) ?? null) : null,
				file_path: nextRelativePath,
				original_name: file.original_name,
				mime_type: file.mime_type ?? null
			};
		});

		const assetThumbnailUpdates = sourceAssets
			.map((asset) => {
				const assetId = assetIdMap.get(asset.id);
				if (!assetId) return null;
				const thumbnailFileId = asset.thumbnail_file_id
					? (fileIdMap.get(asset.thumbnail_file_id) ?? null)
					: null;
				if (!thumbnailFileId) return null;
				return { asset_id: assetId, thumbnail_file_id: thumbnailFileId };
			})
			.filter((entry): entry is { asset_id: string; thumbnail_file_id: string } => Boolean(entry));

		const estimateRows = sourceAssets.flatMap((asset) => {
			const sourceEstimate = sourceEstimates.get(asset.id);
			const nextAssetId = assetIdMap.get(asset.id);
			if (!sourceEstimate || !nextAssetId) return [];

			const takeoffIdMap = takeoffIdMaps.get(asset.id);
			if (!takeoffIdMap) {
				throw new Error(`Estimate duplication map missing for asset ${asset.id}`);
			}

			return [
				{
					asset_id: nextAssetId,
					scope_summary: sourceEstimate.scope_summary,
					notes: sourceEstimate.notes,
					classification_system_id: sourceEstimate.classification_system_id ?? null,
					wbs_root_node_id: sourceEstimate.wbs_root_node_id
						? (wbsIdMap.get(sourceEstimate.wbs_root_node_id) ?? null)
						: null,
					applied_template_id: sourceEstimate.applied_template_id ?? null,
					applied_template_name: sourceEstimate.applied_template_name ?? null,
					takeoff_items: sourceEstimate.takeoff_items.map((item) => ({
						id: takeoffIdMap.get(item.id)!,
						parent_id: item.parent_id ? (takeoffIdMap.get(item.parent_id) ?? null) : null,
						wbs_node_id: item.wbs_node_id ? (wbsIdMap.get(item.wbs_node_id) ?? null) : null,
						cost_code_id: item.cost_code_id ?? null,
						applied_preset_id: item.applied_preset_id ?? null,
						applied_preset_name: item.applied_preset_name ?? null,
						name: item.name,
						description: item.description,
						quantity: item.quantity,
						unit: item.unit,
						properties: item.properties,
						sort_order: item.sort_order,
						cost_components: item.cost_components.map((component) => ({
							id: crypto.randomUUID(),
							category: component.category,
							source_type: component.source_type,
							source_id: component.source_id ?? null,
							name: component.name,
							description: component.description,
							quantity: component.quantity,
							unit: component.unit,
							unit_rate: component.unit_rate,
							formula: component.formula,
							metadata: component.metadata,
							sort_order: component.sort_order ?? 0
						}))
					}))
				}
			];
		});

		try {
			await this.withWriteLock(async () => {
				const sortOrder = await this.getNextProjectSortOrder(sourceProject.workspace_id);
				const projectRow = {
					id: nextProjectId,
					workspace_id: sourceProject.workspace_id,
					sort_order: sortOrder,
					is_favourite: false,
					quote_round_prices: sourceProject.quote_round_prices,
					rfq_number: rfqNumber,
					contact_id: sourceProject.contact_id ?? null,
					contact_name_snapshot: sourceProject.contact_name_snapshot ?? null,
					requester_contact_id: sourceProject.requester_contact_id ?? null,
					quote_recipient_contact_id: sourceProject.quote_recipient_contact_id ?? null,
					requester_name_snapshot: sourceProject.requester_name_snapshot ?? null,
					project_name: sourceProject.project_name ?? null,
					due_date: sourceProject.due_date ?? null,
					received_date: sourceProject.received_date ?? null,
					submission_deadline_at: sourceProject.submission_deadline_at ?? null,
					estimator_name: sourceProject.estimator_name ?? null,
					customer_tender_reference: sourceProject.customer_tender_reference ?? null,
					addendum_label: sourceProject.addendum_label ?? null,
					addendum_date: sourceProject.addendum_date ?? null,
					addendum_notes: sourceProject.addendum_notes ?? null,
					site_address: sourceProject.site_address ?? null,
					delivery_address: sourceProject.delivery_address ?? null,
					source_channel: sourceProject.source_channel ?? 'manual',
					source_reference: sourceProject.source_reference ?? null,
					priority: sourceProject.priority ?? PriorityLevel.Medium,
					status: ProjectStatus.Draft,
					content: sourceProject.content ?? null,
					note: sourceProject.note ?? null,
					updated_at: new Date().toISOString()
				};

				await invoke('duplicate_project_records_command', {
					input: {
						project: projectRow,
						quoteOptions: quoteOptionRows,
						wbsNodes: wbsRows,
						assets: assetRows,
						files: fileRows,
						assetThumbnailUpdates,
						estimates: estimateRows
					}
				});
			});
		} catch (err) {
			await cleanupDuplicatedWorkspace();
			log.error(`Failed to duplicate project: ${err}`);
			throw err;
		}

		return nextProjectId;
	}

	// --- Assets & Files ---

	async getAssetsForProject(projectId: string): Promise<Asset[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const rawAssets = await this.db!.select<unknown[]>(
				'SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at ASC',
				[projectId]
			);
			const assets = AssetArraySchema.parse(rawAssets) as Asset[];

			// Fetch all files currently assigned to project assets
			const files = await this.db!.select<unknown[]>(
				'SELECT * FROM files WHERE project_id = $1 AND asset_id IS NOT NULL ORDER BY created_at ASC',
				[projectId]
			);
			const parsedFiles = AssetFileArraySchema.parse(files) as AssetFile[];

			const fileMap = new Map<string, AssetFile[]>();
			for (const f of parsedFiles) {
				if (!f.asset_id) continue;
				const list = fileMap.get(f.asset_id) ?? [];
				list.push(f);
				fileMap.set(f.asset_id, list);
			}

			return assets.map((asset) => ({
				...asset,
				files: fileMap.get(asset.id) ?? []
			})) as Asset[];
		} catch (err) {
			log.error(`Failed to fetch assets: ${err}`);
			return [];
		}
	}

	async getProjectFiles(projectId: string): Promise<AssetFile[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const raw = await this.db!.select<unknown[]>(
				'SELECT * FROM files WHERE project_id = $1 ORDER BY created_at ASC',
				[projectId]
			);
			return AssetFileArraySchema.parse(raw) as AssetFile[];
		} catch (err) {
			log.error(`Failed to fetch project files: ${err}`);
			return [];
		}
	}

	async getExplorerProjectSummaries(): Promise<Project[]> {
		return this.getProjects();
	}

	async getExplorerProjectBranch(projectId: string): Promise<{
		loaded: boolean;
		assets: Asset[];
		unassignedFiles: AssetFile[];
	}> {
		const [assets, files] = await Promise.all([
			this.getAssetsForProject(projectId),
			this.getProjectFiles(projectId)
		]);

		return {
			loaded: true,
			assets,
			unassignedFiles: files.filter((file) => !file.asset_id)
		};
	}

	async getExplorerPreviewFile(fileId: string): Promise<ExplorerPreviewFile | null> {
		if (!isTauri()) return null;
		await this.init();

		try {
			const raw = await this.db!.select<unknown[]>('SELECT * FROM files WHERE id = $1 LIMIT 1', [
				fileId
			]);
			const file = (AssetFileArraySchema.parse(raw) as AssetFile[])[0] ?? null;
			if (!file) return null;

			return {
				file,
				project: await this.getProjectById(file.project_id)
			};
		} catch (err) {
			log.error(`Failed to fetch explorer preview file: ${err}`);
			return null;
		}
	}

	async getDetachedPreviewAsset(projectId: string, assetId: string): Promise<Asset | null> {
		if (!isTauri()) return null;

		try {
			return await this.withReadOnlyDatabase(async (db) => {
				const rawAsset = await db.select<unknown[]>(
					'SELECT * FROM assets WHERE id = $1 AND project_id = $2 LIMIT 1',
					[assetId, projectId]
				);
				const asset = (AssetArraySchema.parse(rawAsset) as Asset[])[0] ?? null;
				if (!asset) return null;

				const rawFiles = await db.select<unknown[]>(
					'SELECT * FROM files WHERE project_id = $1 AND asset_id = $2 ORDER BY created_at ASC',
					[projectId, assetId]
				);
				const files = AssetFileArraySchema.parse(rawFiles) as AssetFile[];

				return {
					...asset,
					files
				} satisfies Asset;
			});
		} catch (err) {
			log.error(`Failed to fetch detached preview asset: ${err}`);
			return null;
		}
	}

	async getDetachedPreviewProject(projectId: string): Promise<Project | null> {
		if (!isTauri()) return null;

		try {
			return await this.withReadOnlyDatabase(async (db) => {
				const rawProject = await db.select<unknown[]>(
					'SELECT * FROM projects WHERE id = $1 LIMIT 1',
					[projectId]
				);
				return (ProjectArraySchema.parse(rawProject) as Project[])[0] ?? null;
			});
		} catch (err) {
			log.error(`Failed to fetch detached preview project: ${err}`);
			return null;
		}
	}

	async getWorkspaceShell(projectId: string): Promise<{
		project: Project | null;
		assets: Asset[];
		unassignedFiles: AssetFile[];
	}> {
		const [project, assets, files] = await Promise.all([
			this.getProjectById(projectId),
			this.getAssetsForProject(projectId),
			this.getProjectFiles(projectId)
		]);

		return {
			project,
			assets,
			unassignedFiles: files.filter((file) => !file.asset_id)
		};
	}

	// --- AI Runs ---

	async createAiRun(run: AiRun): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			await this.kysely!.insertInto('ai_runs')
				.values({
					id: run.id,
					asset_id: run.asset_id,
					provider: run.provider,
					model_id: run.model_id,
					status: run.status,
					trigger_source: run.trigger_source,
					started_at: run.started_at,
					completed_at: run.completed_at ?? null,
					failed_at: run.failed_at ?? null,
					cancelled_at: run.cancelled_at ?? null,
					error_message: run.error_message ?? null,
					usage_json: JSON.stringify(run.usage ?? {}),
					prompt_contract_version: run.prompt_contract_version ?? '',
					context_fingerprint: run.context_fingerprint ?? '',
					failure_kind: run.failure_kind ?? '',
					failure_stage: run.failure_stage ?? '',
					created_at: run.created_at,
					updated_at: run.updated_at
				})
				.execute();
		});
	}

	async updateAiRun(
		runId: string,
		updates: Partial<
			Pick<
				AiRun,
				| 'status'
				| 'completed_at'
				| 'failed_at'
				| 'cancelled_at'
				| 'error_message'
				| 'usage'
				| 'prompt_contract_version'
				| 'context_fingerprint'
				| 'failure_kind'
				| 'failure_stage'
			>
		>
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			await this.kysely!.updateTable('ai_runs')
				.set({
					status: updates.status ?? undefined,
					completed_at: updates.completed_at ?? undefined,
					failed_at: updates.failed_at ?? undefined,
					cancelled_at: updates.cancelled_at ?? undefined,
					error_message: updates.error_message ?? undefined,
					usage_json: updates.usage ? JSON.stringify(updates.usage) : undefined,
					prompt_contract_version: updates.prompt_contract_version ?? undefined,
					context_fingerprint: updates.context_fingerprint ?? undefined,
					failure_kind: updates.failure_kind ?? undefined,
					failure_stage: updates.failure_stage ?? undefined,
					updated_at: new Date().toISOString()
				})
				.where('id', '=', runId)
				.execute();
		});
	}

	async getAssetById(id: string): Promise<Record<string, unknown> | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('assets')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row ?? null;
	}

	async getLatestAiRunForAsset(assetId: string): Promise<AiRun | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('ai_runs')
			.selectAll()
			.where('asset_id', '=', assetId)
			.orderBy('started_at', 'desc')
			.limit(1)
			.executeTakeFirst();
		return row ? this.mapAiRunRow(row) : null;
	}

	async addAiRunInput(
		id: string,
		runId: string,
		inputKind: string,
		payload: Record<string, unknown>,
		metadata: { contractVersion?: string; stageName?: string } = {}
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const payloadJson = JSON.stringify(payload);
		const payload_hash = await sha256Text(stableStringify(payload));
		await this.withWriteLock(async () => {
			await this.kysely!.insertInto('ai_run_inputs')
				.values({
					id,
					run_id: runId,
					input_kind: inputKind,
					payload_json: payloadJson,
					payload_hash,
					contract_version: metadata.contractVersion ?? inferPayloadContractVersion(payload),
					stage_name: metadata.stageName ?? inputKind
				})
				.execute();
		});
	}

	async addAiRunOutput(
		id: string,
		runId: string,
		outputKind: string,
		payload: Record<string, unknown>,
		metadata: { contractVersion?: string; stageName?: string } = {}
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const payloadJson = JSON.stringify(payload);
		const payload_hash = await sha256Text(stableStringify(payload));
		await this.withWriteLock(async () => {
			await this.kysely!.insertInto('ai_run_outputs')
				.values({
					id,
					run_id: runId,
					output_kind: outputKind,
					payload_json: payloadJson,
					payload_hash,
					contract_version: metadata.contractVersion ?? inferPayloadContractVersion(payload),
					stage_name: metadata.stageName ?? outputKind
				})
				.execute();
		});
	}

	async getAiRunOutput(runId: string, outputKind: string): Promise<AiRunOutput | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('ai_run_outputs')
			.selectAll()
			.where('run_id', '=', runId)
			.where('output_kind', '=', outputKind)
			.orderBy('created_at', 'desc')
			.limit(1)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = AiRunOutputRowSchema.parse(row);
		return {
			id: parsed.id,
			run_id: parsed.run_id,
			output_kind: parsed.output_kind,
			payload: parsed.payload_json,
			payload_hash: parsed.payload_hash,
			contract_version: parsed.contract_version,
			stage_name: parsed.stage_name,
			created_at: parsed.created_at
		};
	}

	async getAiRunInput(runId: string, inputKind: string): Promise<AiRunInput | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('ai_run_inputs')
			.selectAll()
			.where('run_id', '=', runId)
			.where('input_kind', '=', inputKind)
			.orderBy('created_at', 'desc')
			.limit(1)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = AiRunInputRowSchema.parse(row);
		return {
			id: parsed.id,
			run_id: parsed.run_id,
			input_kind: parsed.input_kind,
			payload: parsed.payload_json,
			payload_hash: parsed.payload_hash,
			contract_version: parsed.contract_version,
			stage_name: parsed.stage_name,
			created_at: parsed.created_at
		};
	}

	async listLatestAiTaskSummaries(): Promise<AiTaskSummary[]> {
		if (!isTauri()) return [];
		await this.init();
		const raw = await this.db!.select<unknown[]>(
			`SELECT
				r.id AS run_id,
				r.asset_id,
				a.display_name AS asset_name,
				a.project_id,
				p.rfq_number AS project_rfq_number,
				r.status,
				r.started_at,
				r.completed_at,
				r.failed_at,
				r.cancelled_at,
				r.error_message
			FROM ai_runs r
			JOIN assets a ON a.id = r.asset_id
			JOIN projects p ON p.id = a.project_id
			ORDER BY r.started_at DESC`
		);
		const parsed = AiTaskSummaryRowArraySchema.parse(raw);
		const seenAssetIds = new Set<string>();
		const latestPerAsset: AiTaskSummary[] = [];
		for (const row of parsed) {
			if (seenAssetIds.has(row.asset_id)) continue;
			seenAssetIds.add(row.asset_id);
			latestPerAsset.push({
				run_id: row.run_id,
				asset_id: row.asset_id,
				asset_name: row.asset_name,
				project_id: row.project_id,
				project_rfq_number: row.project_rfq_number ?? null,
				status: row.status,
				started_at: row.started_at,
				completed_at: row.completed_at ?? null,
				failed_at: row.failed_at ?? null,
				cancelled_at: row.cancelled_at ?? null,
				error_message: row.error_message ?? null
			});
		}
		return latestPerAsset;
	}

	async listRecentIncidentAiRunFailures(
		sinceIso: string,
		limit = 20
	): Promise<IncidentAiRunFailure[]> {
		if (!isTauri()) return [];
		await this.init();
		const rows = await this.kysely!.selectFrom('ai_runs')
			.select([
				'provider',
				'model_id',
				'trigger_source',
				'failed_at',
				'failure_kind',
				'failure_stage',
				'prompt_contract_version',
				'context_fingerprint'
			])
			.where('status', '=', 'failed')
			.where('failed_at', 'is not', null)
			.where('failed_at', '>=', sinceIso)
			.orderBy('failed_at', 'desc')
			.limit(limit)
			.execute();
		return rows
			.filter((row): row is typeof row & { failed_at: string } => Boolean(row.failed_at))
			.map((row) => ({
				provider: row.provider as IncidentAiRunFailure['provider'],
				model_id: row.model_id,
				trigger_source: row.trigger_source as IncidentAiRunFailure['trigger_source'],
				failed_at: row.failed_at,
				failure_kind: row.failure_kind ?? '',
				failure_stage: row.failure_stage ?? '',
				prompt_contract_version: row.prompt_contract_version ?? '',
				context_fingerprint: row.context_fingerprint ?? ''
			}));
	}

	async getProductUsageSnapshotAggregate(sinceIso: string): Promise<ProductUsageSnapshotAggregate> {
		const empty: ProductUsageSnapshotAggregate = {
			projectCount: 0,
			activeProjectCount: 0,
			projectsCreated: 0,
			projectsUpdated: 0,
			projectsArchived: 0,
			fileCount: 0,
			filesAdded: 0,
			fileTypeBuckets: {},
			assetCount: 0,
			assetsCreated: 0,
			quoteRevisionCount: 0,
			quoteRevisionsCreated: 0,
			aiRunsStarted: 0,
			aiRunsSucceeded: 0,
			aiRunsFailed: 0,
			aiRunsCancelled: 0,
			aiPromptTokenCount: 0,
			aiCandidateTokenCount: 0,
			aiThoughtsTokenCount: 0,
			aiTotalTokenCount: 0,
			aiCachedContentTokenCount: 0,
			assistantActionsProposed: 0,
			assistantActionsApproved: 0,
			assistantActionsExecuted: 0,
			assistantActionsFailed: 0,
			assistantActionIssueCount: 0,
			assistantActionErrorCount: 0
		};
		if (!isTauri()) return empty;
		await this.init();

		const readCount = async (query: {
			executeTakeFirst: () => Promise<{ count: number | string | bigint | null } | undefined>;
		}) => Number((await query.executeTakeFirst())?.count ?? 0);
		const bucketFileType = (mimeType: string | null | undefined): string => {
			const value = (mimeType ?? '').toLowerCase();
			if (value.includes('pdf')) return 'pdf';
			if (value.startsWith('image/')) return 'image';
			if (value.includes('spreadsheet') || value.includes('excel')) return 'spreadsheet';
			if (value.includes('word') || value.includes('document')) return 'document';
			if (value.includes('dwg') || value.includes('dxf') || value.includes('step')) return 'cad';
			return 'other';
		};
		const readUsageNumber = (value: unknown): number => {
			const number = typeof value === 'number' ? value : Number(value ?? 0);
			return Number.isFinite(number) && number > 0 ? number : 0;
		};

		const [
			projectCount,
			activeProjectCount,
			projectsCreated,
			projectsUpdated,
			projectsArchived,
			fileCount,
			filesAdded,
			assetCount,
			assetsCreated,
			quoteRevisionCount,
			quoteRevisionsCreated,
			aiRuns,
			assistantActions,
			recentFiles
		] = await Promise.all([
			readCount(this.kysely!.selectFrom('projects').select(sql<number>`COUNT(*)`.as('count'))),
			readCount(
				this.kysely!.selectFrom('projects')
					.where('status', '!=', ProjectStatus.Archived)
					.select(sql<number>`COUNT(*)`.as('count'))
			),
			readCount(
				this.kysely!.selectFrom('projects')
					.where('created_at', '>=', sinceIso)
					.select(sql<number>`COUNT(*)`.as('count'))
			),
			readCount(
				this.kysely!.selectFrom('projects')
					.where('updated_at', '>=', sinceIso)
					.where('created_at', '<', sinceIso)
					.select(sql<number>`COUNT(*)`.as('count'))
			),
			readCount(
				this.kysely!.selectFrom('projects')
					.where('status', '=', ProjectStatus.Archived)
					.where('updated_at', '>=', sinceIso)
					.select(sql<number>`COUNT(*)`.as('count'))
			),
			readCount(this.kysely!.selectFrom('files').select(sql<number>`COUNT(*)`.as('count'))),
			readCount(
				this.kysely!.selectFrom('files')
					.where('created_at', '>=', sinceIso)
					.select(sql<number>`COUNT(*)`.as('count'))
			),
			readCount(this.kysely!.selectFrom('assets').select(sql<number>`COUNT(*)`.as('count'))),
			readCount(
				this.kysely!.selectFrom('assets')
					.where('created_at', '>=', sinceIso)
					.select(sql<number>`COUNT(*)`.as('count'))
			),
			readCount(
				this.kysely!.selectFrom('quote_revisions').select(sql<number>`COUNT(*)`.as('count'))
			),
			readCount(
				this.kysely!.selectFrom('quote_revisions')
					.where('created_at', '>=', sinceIso)
					.select(sql<number>`COUNT(*)`.as('count'))
			),
			this.kysely!.selectFrom('ai_runs')
				.select(['status', 'usage_json', 'started_at', 'completed_at', 'failed_at', 'cancelled_at'])
				.where('started_at', '>=', sinceIso)
				.execute(),
			this.kysely!.selectFrom('assistant_action_audit')
				.select(['status', 'issue_count', 'error_count'])
				.where('created_at', '>=', sinceIso)
				.execute(),
			this.kysely!.selectFrom('files')
				.select(['mime_type'])
				.where('created_at', '>=', sinceIso)
				.execute()
		]);

		const aggregate: ProductUsageSnapshotAggregate = {
			...empty,
			projectCount,
			activeProjectCount,
			projectsCreated,
			projectsUpdated,
			projectsArchived,
			fileCount,
			filesAdded,
			assetCount,
			assetsCreated,
			quoteRevisionCount,
			quoteRevisionsCreated
		};

		for (const file of recentFiles) {
			const bucket = bucketFileType(file.mime_type);
			aggregate.fileTypeBuckets[bucket] = (aggregate.fileTypeBuckets[bucket] ?? 0) + 1;
		}

		for (const run of aiRuns) {
			aggregate.aiRunsStarted += 1;
			if (run.status === 'drafted' || run.status === 'applied') aggregate.aiRunsSucceeded += 1;
			if (run.status === 'failed') aggregate.aiRunsFailed += 1;
			if (run.status === 'cancelled') aggregate.aiRunsCancelled += 1;
			let usage: Record<string, unknown>;
			try {
				usage = JSON.parse(run.usage_json || '{}') as Record<string, unknown>;
			} catch {
				usage = {};
			}
			aggregate.aiPromptTokenCount += readUsageNumber(usage.promptTokenCount);
			aggregate.aiCandidateTokenCount += readUsageNumber(usage.candidatesTokenCount);
			aggregate.aiThoughtsTokenCount += readUsageNumber(usage.thoughtsTokenCount);
			aggregate.aiTotalTokenCount += readUsageNumber(usage.totalTokenCount);
			aggregate.aiCachedContentTokenCount += readUsageNumber(usage.cachedContentTokenCount);
		}

		for (const action of assistantActions) {
			if (action.status === 'proposed') aggregate.assistantActionsProposed += 1;
			if (action.status === 'approved') aggregate.assistantActionsApproved += 1;
			if (action.status === 'executed') aggregate.assistantActionsExecuted += 1;
			if (action.status === 'failed') aggregate.assistantActionsFailed += 1;
			aggregate.assistantActionIssueCount += Number(action.issue_count ?? 0);
			aggregate.assistantActionErrorCount += Number(action.error_count ?? 0);
		}

		return aggregate;
	}

	async listRecentIncidentAssistantActionFailures(
		sinceIso: string,
		limit = 20
	): Promise<IncidentAssistantActionFailure[]> {
		if (!isTauri()) return [];
		await this.init();
		const rows = await this.kysely!.selectFrom('assistant_action_audit')
			.select(['tool_name', 'status', 'issue_count', 'error_count', 'error_message', 'created_at'])
			.where((eb) => eb.or([eb('status', '=', 'failed'), eb('error_count', '>', 0)]))
			.where('created_at', '>=', sinceIso)
			.orderBy('created_at', 'desc')
			.limit(limit)
			.execute();
		return rows.map((row) => ({
			tool_name: row.tool_name,
			status: 'failed',
			issue_count: Number(row.issue_count ?? 0),
			error_count: Number(row.error_count ?? 0),
			created_at: row.created_at,
			error_message: row.error_message
		}));
	}

	async replaceAiEvidenceRefs(
		runId: string,
		assetId: string,
		refs: AiEvidenceRef[]
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			await invoke('replace_ai_evidence_refs_command', {
				input: {
					runId,
					assetId,
					refs: refs.map((ref) => ({
						fileId: ref.file_id,
						fileName: ref.file_name,
						artifactKind: ref.artifact_kind ?? null,
						pageNumber: ref.page_number ?? null,
						viewLabel: ref.view_label ?? null,
						evidenceIdentifier: ref.evidence_identifier ?? '',
						locatorJson: ref.locator ?? {},
						draftEntityKind: ref.draft_entity_kind ?? '',
						draftEntityKey: ref.draft_entity_key ?? '',
						confidenceJson: ref.confidence ?? {},
						quotePath: ref.quote_path,
						summary: ref.summary
					}))
				}
			});
		});
	}

	async lookupCachedExtraction(
		payloadHash: string,
		fileId: string,
		contractVersion: string,
		modelRuntimeId = '',
		preparationVersion = '',
		evidenceUnitSetHash = '',
		synthesisVersion = ''
	): Promise<string | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('ai_evidence_cache')
			.select(['id', 'payload_json', 'last_accessed_at'])
			.where('file_id', '=', fileId)
			.where('cache_kind', '=', 'file_synthesis')
			.where('source_content_hash', '=', payloadHash)
			.where('extraction_version', '=', contractVersion)
			.where('synthesis_version', '=', synthesisVersion)
			.where('model_runtime_id', '=', modelRuntimeId)
			.where('preparation_version', '=', preparationVersion)
			.where('evidence_unit_hash', '=', evidenceUnitSetHash)
			.orderBy('created_at', 'desc')
			.limit(1)
			.executeTakeFirst();
		if (!row) return null;
		const lastAccessed = Date.parse(row.last_accessed_at);
		if (!Number.isFinite(lastAccessed) || Date.now() - lastAccessed > 86_400_000) {
			await this.kysely!.updateTable('ai_evidence_cache')
				.set({ last_accessed_at: new Date().toISOString() })
				.where('id', '=', row.id)
				.execute();
		}
		return row.payload_json;
	}

	async putCachedExtraction(input: {
		id: string;
		fileId: string;
		sourceContentHash: string;
		evidenceUnitKey: string;
		evidenceUnitHash: string;
		preparationVersion: string;
		extractionVersion: string;
		modelRuntimeId: string;
		payload: Record<string, unknown>;
		cacheKind?: 'unit_extraction' | 'file_synthesis';
		synthesisVersion?: string;
	}): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const now = new Date().toISOString();
		await this.withWriteLock(async () => {
			await this.kysely!.deleteFrom('ai_evidence_cache')
				.where('file_id', '=', input.fileId)
				.where('cache_kind', '=', input.cacheKind ?? 'unit_extraction')
				.where('evidence_unit_key', '=', input.evidenceUnitKey)
				.execute();
			await this.kysely!.insertInto('ai_evidence_cache')
				.values({
					id: input.id,
					file_id: input.fileId,
					cache_kind: input.cacheKind ?? 'unit_extraction',
					source_content_hash: input.sourceContentHash,
					evidence_unit_key: input.evidenceUnitKey,
					evidence_unit_hash: input.evidenceUnitHash,
					preparation_version: input.preparationVersion,
					extraction_version: input.extractionVersion,
					synthesis_version: input.synthesisVersion ?? '',
					model_runtime_id: input.modelRuntimeId,
					payload_json: JSON.stringify(input.payload),
					artifact_path: null,
					byte_size: 0,
					created_at: now,
					last_accessed_at: now
				})
				.execute();
		});
	}

	async getCachedEvidenceUnit(input: {
		fileId: string;
		sourceContentHash: string;
		evidenceUnitKey: string;
		evidenceUnitHash: string;
		preparationVersion: string;
		extractionVersion: string;
		modelRuntimeId: string;
	}): Promise<string | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('ai_evidence_cache')
			.select(['id', 'payload_json', 'last_accessed_at'])
			.where('file_id', '=', input.fileId)
			.where('cache_kind', '=', 'unit_extraction')
			.where('source_content_hash', '=', input.sourceContentHash)
			.where('evidence_unit_key', '=', input.evidenceUnitKey)
			.where('evidence_unit_hash', '=', input.evidenceUnitHash)
			.where('preparation_version', '=', input.preparationVersion)
			.where('extraction_version', '=', input.extractionVersion)
			.where('model_runtime_id', '=', input.modelRuntimeId)
			.limit(1)
			.executeTakeFirst();
		if (!row) return null;
		const lastAccessed = Date.parse(row.last_accessed_at);
		if (!Number.isFinite(lastAccessed) || Date.now() - lastAccessed > 86_400_000) {
			await this.kysely!.updateTable('ai_evidence_cache')
				.set({ last_accessed_at: new Date().toISOString() })
				.where('id', '=', row.id)
				.execute();
		}
		return row.payload_json;
	}

	async getAiEvidenceRefs(runId: string): Promise<AiEvidenceRef[]> {
		if (!isTauri()) return [];
		await this.init();
		const rows = await this.kysely!.selectFrom('ai_evidence_refs')
			.selectAll()
			.where('run_id', '=', runId)
			.orderBy('created_at', 'asc')
			.execute();
		return AiEvidenceRefRowArraySchema.parse(rows).map((row) => ({
			file_id: row.file_id,
			file_name: row.file_name,
			artifact_kind: row.artifact_kind,
			page_number: row.page_number,
			view_label: row.view_label,
			evidence_identifier: row.evidence_identifier,
			locator: row.locator_json,
			draft_entity_kind: row.draft_entity_kind,
			draft_entity_key: row.draft_entity_key,
			confidence: row.confidence_json,
			quote_path: row.quote_path,
			summary: row.summary
		}));
	}

	async addAiReviewEvent(event: AiReviewEvent): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			await this.kysely!.insertInto('ai_review_events')
				.values({
					id: event.id,
					run_id: event.run_id,
					asset_id: event.asset_id,
					event_type: event.event_type,
					event_payload_json: JSON.stringify(event.event_payload),
					created_at: event.created_at
				})
				.execute();
		});
	}

	async getAiReviewEvents(runId: string): Promise<AiReviewEvent[]> {
		if (!isTauri()) return [];
		await this.init();
		const rows = await this.kysely!.selectFrom('ai_review_events')
			.selectAll()
			.where('run_id', '=', runId)
			.orderBy('created_at', 'asc')
			.execute();
		return AiReviewEventRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			run_id: row.run_id,
			asset_id: row.asset_id,
			event_type: row.event_type,
			event_payload: row.event_payload_json,
			created_at: row.created_at
		}));
	}

	async addAiOverrideEvents(events: AiOverrideEvent[]): Promise<void> {
		if (!isTauri() || events.length === 0) return;
		await this.init();
		await this.withWriteLock(async () => {
			await this.kysely!.insertInto('ai_override_events')
				.values(
					events.map((event) => ({
						id: event.id,
						run_id: event.run_id,
						asset_id: event.asset_id,
						field_path: event.field_path,
						original_value_json: event.original_value_json,
						final_value_json: event.final_value_json,
						created_at: event.created_at
					}))
				)
				.execute();
		});
	}

	async getAiOverrideEvents(runId: string): Promise<AiOverrideEvent[]> {
		if (!isTauri()) return [];
		await this.init();
		const rows = await this.kysely!.selectFrom('ai_override_events')
			.selectAll()
			.where('run_id', '=', runId)
			.orderBy('created_at', 'asc')
			.execute();
		return AiOverrideEventRowArraySchema.parse(rows);
	}

	async getWorkspaceAiOverrideEvents(limit = 200): Promise<AiOverrideEvent[]> {
		if (!isTauri()) return [];
		await this.init();
		const rows = await this.kysely!.selectFrom('ai_override_events')
			.innerJoin('ai_runs', 'ai_runs.id', 'ai_override_events.run_id')
			.innerJoin('assets', 'assets.id', 'ai_runs.asset_id')
			.innerJoin('projects', 'projects.id', 'assets.project_id')
			.select([
				'ai_override_events.id',
				'ai_override_events.run_id',
				'ai_override_events.asset_id',
				'ai_override_events.field_path',
				'ai_override_events.original_value_json',
				'ai_override_events.final_value_json',
				'ai_override_events.created_at'
			])
			.where('projects.workspace_id', '=', LOCAL_WORKSPACE_ID)
			.orderBy('ai_override_events.created_at', 'desc')
			.limit(limit)
			.execute();
		return AiOverrideEventRowArraySchema.parse(rows);
	}

	async addProjectFile(
		fileId: string,
		projectId: string,
		filePath: string,
		originalName: string,
		assetId: string | null = null
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await invoke('add_project_file_command', {
					input: {
						fileId,
						projectId,
						assetId,
						filePath,
						originalName,
						mimeType: inferGeneralFileMimeType(originalName) ?? inferGeneralFileMimeType(filePath)
					}
				});
			} catch (err) {
				log.error(`Failed to add project file: ${err}`);
				throw err;
			}
		});
	}

	async createAssetFromFiles(
		assetId: string,
		projectId: string,
		displayName: string,
		fileIds: string[]
	): Promise<void> {
		if (!isTauri() || fileIds.length === 0) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await invoke('create_asset_from_files_command', {
					input: {
						assetId,
						projectId,
						displayName,
						fileIds
					}
				});
			} catch (err) {
				log.error(`Failed to create asset from files: ${err}`);
				throw err;
			}
		});
	}

	async addAsset(
		assetId: string,
		projectId: string,
		displayName: string,
		isSelected = true
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.insertInto('assets')
					.values({
						id: assetId,
						project_id: projectId,
						display_name: displayName,
						thumbnail_file_id: null,
						is_selected: isSelected ? 1 : 0,
						quote_quantity: 1,
						is_pdf_included: 1
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add asset: ${err}`);
				throw err;
			}
		});
	}

	async assignFilesToAsset(assetId: string, projectId: string, fileIds: string[]): Promise<void> {
		if (!isTauri() || fileIds.length === 0) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await invoke('assign_files_to_asset_command', {
					input: {
						assetId,
						projectId,
						fileIds
					}
				});
			} catch (err) {
				log.error(`Failed to assign files to asset: ${err}`);
				throw err;
			}
		});
	}

	async updateAsset(assetId: string, updates: Partial<Asset>): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const set: Record<string, string | number | null> = {};
				let projectId: string | null = null;
				if (updates.display_name !== undefined) set.display_name = updates.display_name;
				if (updates.thumbnail_file_id !== undefined) {
					const asset = await this.kysely!.selectFrom('assets')
						.select('project_id')
						.where('id', '=', assetId)
						.executeTakeFirst();
					if (!asset) {
						throw new Error('Asset could not be found');
					}
					projectId = asset.project_id;
					if (updates.thumbnail_file_id) {
						await this.ensureThumbnailBelongsToAsset(assetId, projectId, updates.thumbnail_file_id);
					}
					set.thumbnail_file_id = updates.thumbnail_file_id ?? null;
				}
				if (updates.is_selected !== undefined) set.is_selected = updates.is_selected ? 1 : 0;
				if (updates.quote_quantity !== undefined) {
					set.quote_quantity = Math.max(1, Math.trunc(updates.quote_quantity));
				}
				if (updates.is_pdf_included !== undefined) {
					set.is_pdf_included = updates.is_pdf_included ? 1 : 0;
				}

				await this.kysely!.updateTable('assets').set(set).where('id', '=', assetId).execute();
			} catch (err) {
				log.error(`Failed to update asset: ${err}`);
				throw err;
			}
		});
	}

	async updateAssetSelection(assetId: string, isSelected: boolean): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('assets')
					.set({ is_selected: isSelected ? 1 : 0 })
					.where('id', '=', assetId)
					.execute();
			} catch (err) {
				log.error(`Failed to update selection: ${err}`);
				throw err;
			}
		});
	}

	async updateBulkSelection(projectId: string, isSelected: boolean): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('assets')
					.set({ is_selected: isSelected ? 1 : 0 })
					.where('project_id', '=', projectId)
					.execute();
			} catch (err) {
				log.error(`Failed to bulk update selection: ${err}`);
				throw err;
			}
		});
	}

	async updateProjectQuotePreferences(
		projectId: string,
		updates: { quote_round_prices?: boolean }
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const set: Record<string, string | number> = {
					updated_at: new Date().toISOString()
				};
				if (updates.quote_round_prices !== undefined) {
					set.quote_round_prices = updates.quote_round_prices ? 1 : 0;
				}
				await this.kysely!.updateTable('projects').set(set).where('id', '=', projectId).execute();
			} catch (err) {
				log.error(`Failed to update project quote preferences: ${err}`);
				throw err;
			}
		});
	}

	async mergeAssets(
		targetAssetId: string,
		sourceAssetIds: string[],
		newName?: string
	): Promise<{ estimatesDiscarded: boolean }> {
		if (!isTauri() || sourceAssetIds.length === 0) return { estimatesDiscarded: false };
		await this.init();
		return await this.withWriteLock(async () => {
			try {
				const result = (await invoke('merge_assets_command', {
					input: {
						targetAssetId,
						sourceAssetIds,
						newName: newName ?? null
					}
				})) as { estimatesDiscarded?: boolean };
				return { estimatesDiscarded: result.estimatesDiscarded ?? false };
			} catch (err) {
				log.error(`Failed to merge assets: ${err}`);
				throw err;
			}
		});
	}

	async ungroupAsset(assetId: string): Promise<{ hadEstimate: boolean }> {
		if (!isTauri()) return { hadEstimate: false };
		await this.init();
		return await this.withWriteLock(async () => {
			try {
				const result = (await invoke('ungroup_asset_command', {
					input: { assetId }
				})) as { hadEstimate?: boolean };
				return { hadEstimate: result.hadEstimate ?? false };
			} catch (err) {
				log.error(`Failed to ungroup asset: ${err}`);
				throw err;
			}
		});
	}

	async removeFileFromAsset(fileId: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await invoke('remove_file_from_asset_command', {
					input: { fileId }
				});
			} catch (err) {
				log.error(`Failed to remove file from asset: ${err}`);
				throw err;
			}
		});
	}

	async deleteFile(fileId: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const result = (await invoke('delete_file_command', {
					input: { fileId }
				})) as { filePath?: string | null };
				if (result.filePath) {
					const filePath = result.filePath;
					await removeDerivedPreviewCacheForSource(filePath).catch((cleanupErr) => {
						log.warn(`Derived preview cache cleanup failed for ${filePath}: ${cleanupErr}`);
					});
				}
			} catch (err) {
				log.error(`Failed to delete file: ${err}`);
				throw err;
			}
		});
	}

	// --- Estimates ---

	async saveEstimate(asset_id: string, estimate: Estimate): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await this.validateEstimateReferenceLinks(estimate, workspaceId);
				await this.validateEstimateWbsLinks(asset_id, estimate);
				const takeoffItems = resolvePersistableTakeoffItems(estimate.takeoff_items);
				const now = new Date().toISOString();

				// Resolve estimate currency for this save operation.
				// On create with omitted currency, use the active workspace default.
				// On update with omitted currency, preserve the persisted value.
				// On persisted NULL (orphan estimate), fail visibly — never silently repair.
				const currencyCode = await this.resolveEstimateCurrencyForSave(
					asset_id,
					estimate.currency_code
				);

				// Normalize explicit source_unit_rate_decimal through exact-decimal helper.
				// Omitted values (null) are filled by the Rust path from unit_rate.
				// Invalid, zero and negative values reject.
				for (const { item } of takeoffItems) {
					for (const component of item.cost_components) {
						if (component.source_unit_rate_decimal != null) {
							try {
								component.source_unit_rate_decimal = normalizePositiveDecimalString(
									component.source_unit_rate_decimal
								);
							} catch {
								throw new Error(
									`Cost component ${component.id}: invalid source_unit_rate_decimal ` +
										`"${component.source_unit_rate_decimal}". Value must be a positive ` +
										'decimal number string.'
								);
							}
						}
					}
				}

				// Validate cost-component currency safety (M3C.1 policy).
				// Foreign-component writes and snapshot references are blocked until
				// M4 validates conversion math.
				await this.validateCostComponentSnapshots(
					takeoffItems.flatMap(({ item }) => item.cost_components),
					currencyCode
				);

				await invoke('save_estimate_command', {
					input: {
						assetId: asset_id,
						updatedAt: now,
						estimate: {
							scope_summary: estimate.scope_summary,
							notes: estimate.notes,
							classification_system_id: estimate.classification_system_id ?? null,
							wbs_root_node_id: estimate.wbs_root_node_id ?? null,
							applied_template_id: estimate.applied_template_id ?? null,
							applied_template_name: estimate.applied_template_name ?? null,
							currency_code: currencyCode,
							takeoff_items: takeoffItems.map(({ item, sortOrder }) => ({
								...item,
								sort_order: sortOrder,
								cost_components: item.cost_components.map((component, index) => ({
									...component,
									sort_order: index
								}))
							}))
						}
					}
				});
			} catch (err) {
				const surfacedError = unwrapRollbackFollowupError(err);
				if (surfacedError !== err) {
					log.error(`Estimate save rollback follow-up error: ${err}`);
				}
				log.error(`Failed to save estimate: ${surfacedError}`);
				throw surfacedError;
			}
		});
	}

	async getEstimate(assetId: string): Promise<Estimate | null> {
		if (!isTauri()) return null;
		await this.init();
		try {
			const workspaceId = await this.getWorkspaceIdForWrite();
			const projectId = await this.getAssetProjectId(assetId);
			const row = await this.kysely!.selectFrom('estimates')
				.selectAll()
				.where('asset_id', '=', assetId)
				.executeTakeFirst();

			if (!row) return null;

			const estimateRow = EstimateRowSchema.parse(row);
			const takeoffRows = TakeoffItemRowArraySchema.parse(
				await this.kysely!.selectFrom('takeoff_items')
					.selectAll()
					.where('estimate_asset_id', '=', assetId)
					.orderBy('sort_order', 'asc')
					.execute()
			);
			const componentRows = CostComponentRowArraySchema.parse(
				await this.kysely!.selectFrom('cost_components')
					.innerJoin('takeoff_items', 'cost_components.takeoff_item_id', 'takeoff_items.id')
					.selectAll('cost_components')
					.where('takeoff_items.estimate_asset_id', '=', assetId)
					.orderBy('cost_components.sort_order', 'asc')
					.execute()
			);

			const componentMap = new Map<string, CostComponent[]>();
			for (let i = 0, len = componentRows.length; i < len; i++) {
				const component = componentRows[i];
				const tid = component.takeoff_item_id;
				let list = componentMap.get(tid);
				if (list === undefined) {
					list = [];
					componentMap.set(tid, list);
				}
				list.push({
					id: component.id,
					takeoff_item_id: tid,
					category: component.category,
					source_type: component.source_type,
					source_id: component.source_id,
					name: component.name,
					description: component.description,
					quantity: component.quantity,
					unit: component.unit,
					unit_rate: component.unit_rate,
					source_unit_rate_decimal: component.source_unit_rate_decimal,
					source_currency_code: component.source_currency_code,
					fx_rate_snapshot_id: component.fx_rate_snapshot_id,
					formula: component.formula_json,
					metadata: component.metadata_json,
					sort_order: component.sort_order
				});
			}

			return this.sanitisePersistedEstimatePayload(
				{
					asset_id: estimateRow.asset_id,
					scope_summary: estimateRow.scope_summary,
					notes: estimateRow.notes,
					classification_system_id: estimateRow.classification_system_id,
					wbs_root_node_id: estimateRow.wbs_root_node_id,
					applied_template_id: estimateRow.applied_template_id,
					applied_template_name: estimateRow.applied_template_name,
					currency_code: estimateRow.currency_code,
					takeoff_items: takeoffRows.map((item) => ({
						id: item.id,
						estimate_asset_id: item.estimate_asset_id,
						parent_id: item.parent_id,
						wbs_node_id: item.wbs_node_id,
						cost_code_id: item.cost_code_id,
						applied_preset_id: item.applied_preset_id,
						applied_preset_name: item.applied_preset_name,
						name: item.name,
						description: item.description,
						quantity: item.quantity,
						unit: item.unit,
						properties: item.properties_json,
						sort_order: item.sort_order,
						cost_components: componentMap.get(item.id) ?? []
					}))
				},
				await this.buildEstimateReferenceIndex(workspaceId),
				await this.buildProjectWbsNodeIndex(projectId)
			);
		} catch (err) {
			log.error(`Failed to get estimate: ${err}`);
			return null;
		}
	}

	async getEstimateSummariesForProject(projectId: string): Promise<EstimateSummary[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const raw = await this.db!.select<unknown[]>(
				`SELECT
					e.asset_id,
					CASE
						WHEN TRIM(COALESCE(e.scope_summary, '')) <> '' THEN 1
						WHEN TRIM(COALESCE(e.notes, '')) <> '' THEN 1
						WHEN EXISTS (
							SELECT 1
							FROM takeoff_items t
							LEFT JOIN cost_components c ON c.takeoff_item_id = t.id
							WHERE t.estimate_asset_id = e.asset_id
								AND (
									TRIM(COALESCE(t.name, '')) <> ''
									OR TRIM(COALESCE(t.description, '')) <> ''
									OR TRIM(COALESCE(c.name, '')) <> ''
									OR TRIM(COALESCE(c.description, '')) <> ''
									OR COALESCE(c.quantity, 0) > 0
									OR COALESCE(c.unit_rate, 0) > 0
								)
						) THEN 1
						ELSE 0
					END AS has_quote_content
				FROM estimates e
				INNER JOIN assets a ON a.id = e.asset_id
				WHERE a.project_id = $1`,
				[projectId]
			);

			return EstimateSummaryArraySchema.parse(raw);
		} catch (err) {
			log.error(`Failed to fetch estimate summaries: ${err}`);
			return [];
		}
	}

	async getEstimatesForProject(projectId: string): Promise<Map<string, Estimate>> {
		const result = new Map<string, Estimate>();
		if (!isTauri()) return result;
		await this.init();
		try {
			const workspaceId = await this.getWorkspaceIdForWrite();
			const references = await this.buildEstimateReferenceIndex(workspaceId);
			const wbsNodeIds = await this.buildProjectWbsNodeIndex(projectId);
			const estimates = EstimateRowArraySchema.parse(
				await this.kysely!.selectFrom('estimates as e')
					.innerJoin('assets as a', 'e.asset_id', 'a.id')
					.selectAll('e')
					.where('a.project_id', '=', projectId)
					.execute()
			);

			if (estimates.length === 0) return result;

			const takeoffItems = TakeoffItemRowArraySchema.parse(
				await this.kysely!.selectFrom('takeoff_items as t')
					.innerJoin('assets as a', 't.estimate_asset_id', 'a.id')
					.selectAll('t')
					.where('a.project_id', '=', projectId)
					.orderBy('t.sort_order', 'asc')
					.execute()
			);

			const components = CostComponentRowArraySchema.parse(
				await this.kysely!.selectFrom('cost_components as c')
					.innerJoin('takeoff_items as t', 'c.takeoff_item_id', 't.id')
					.innerJoin('assets as a', 't.estimate_asset_id', 'a.id')
					.selectAll('c')
					.where('a.project_id', '=', projectId)
					.orderBy('c.sort_order', 'asc')
					.execute()
			);

			const componentMap = new Map<string, CostComponent[]>();
			for (let i = 0, len = components.length; i < len; i++) {
				const component = components[i];
				const tid = component.takeoff_item_id;
				let list = componentMap.get(tid);
				if (list === undefined) {
					list = [];
					componentMap.set(tid, list);
				}
				list.push({
					id: component.id,
					takeoff_item_id: tid,
					category: component.category,
					source_type: component.source_type,
					source_id: component.source_id,
					name: component.name,
					description: component.description,
					quantity: component.quantity,
					unit: component.unit,
					unit_rate: component.unit_rate,
					formula: component.formula_json,
					metadata: component.metadata_json,
					sort_order: component.sort_order
				});
			}

			const takeoffMap = new Map<string, TakeoffItem[]>();
			for (let i = 0, len = takeoffItems.length; i < len; i++) {
				const item = takeoffItems[i];
				const eid = item.estimate_asset_id;
				let list = takeoffMap.get(eid);
				if (list === undefined) {
					list = [];
					takeoffMap.set(eid, list);
				}
				list.push({
					id: item.id,
					estimate_asset_id: eid,
					parent_id: item.parent_id,
					wbs_node_id: item.wbs_node_id,
					cost_code_id: item.cost_code_id,
					applied_preset_id: item.applied_preset_id,
					applied_preset_name: item.applied_preset_name,
					name: item.name,
					description: item.description,
					quantity: item.quantity,
					unit: item.unit,
					properties: item.properties_json,
					sort_order: item.sort_order,
					cost_components: componentMap.get(item.id) ?? []
				});
			}

			for (const row of estimates) {
				result.set(
					row.asset_id,
					this.sanitisePersistedEstimatePayload(
						{
							asset_id: row.asset_id,
							scope_summary: row.scope_summary,
							notes: row.notes,
							classification_system_id: row.classification_system_id,
							wbs_root_node_id: row.wbs_root_node_id,
							applied_template_id: row.applied_template_id,
							applied_template_name: row.applied_template_name,
							takeoff_items: takeoffMap.get(row.asset_id) ?? []
						},
						references,
						wbsNodeIds
					)
				);
			}
			return result;
		} catch (err) {
			log.error(`Failed to hydrate estimates: ${err}`);
			return result;
		}
	}

	async deleteEstimate(assetId: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.deleteFrom('estimates').where('asset_id', '=', assetId).execute();
			} catch (err) {
				log.error(`Failed to delete estimate: ${err}`);
				throw err;
			}
		});
	}

	async getQuoteOptions(projectId: string): Promise<QuoteOption[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const rows = QuoteOptionRowArraySchema.parse(
				await this.kysely!.selectFrom('quote_options')
					.selectAll()
					.where('project_id', '=', projectId)
					.orderBy('sort_order', 'asc')
					.orderBy('created_at', 'asc')
					.execute()
			);

			return rows.map((row) => ({
				id: row.id,
				project_id: row.project_id,
				label: row.label,
				lead_time: row.lead_time,
				markup_percentage: row.markup_percentage,
				material_markup_percentage: row.material_markup_percentage ?? null,
				labour_markup_percentage: row.labour_markup_percentage ?? null,
				equipment_markup_percentage: row.equipment_markup_percentage ?? null,
				subcontract_markup_percentage: row.subcontract_markup_percentage ?? null,
				notes: row.notes,
				sort_order: row.sort_order,
				is_default: row.is_default,
				created_at: row.created_at,
				updated_at: row.updated_at
			}));
		} catch (err) {
			log.error(`Failed to get quote options: ${err}`);
			return [];
		}
	}

	async saveQuoteOptions(projectId: string, options: QuoteOption[]): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const normalizedOptions =
					options.length > 0
						? options
								.map((option) =>
									this.normalizeQuoteOptionFormData({
										label: option.label,
										lead_time: option.lead_time,
										markup_percentage: option.markup_percentage,
										material_markup_percentage: option.material_markup_percentage,
										labour_markup_percentage: option.labour_markup_percentage,
										equipment_markup_percentage: option.equipment_markup_percentage,
										subcontract_markup_percentage: option.subcontract_markup_percentage,
										notes: option.notes,
										is_default: option.is_default
									})
								)
								.map((option, index) => ({
									...option,
									id: options[index].id,
									project_id: projectId,
									sort_order: index
								}))
						: [
								{
									id: crypto.randomUUID(),
									project_id: projectId,
									label: 'Standard',
									lead_time: '2 weeks',
									markup_percentage: 0,
									notes: '',
									is_default: true,
									sort_order: 0
								}
							];

				const hasDefault = normalizedOptions.some((option) => option.is_default);
				const persistedOptions = normalizedOptions.map((option, index) => ({
					...option,
					is_default: option.is_default || (!hasDefault && index === 0)
				}));

				await this.kysely!.deleteFrom('quote_options')
					.where('project_id', '=', projectId)
					.execute();

				if (persistedOptions.length > 0) {
					await this.kysely!.insertInto('quote_options')
						.values(
							persistedOptions.map((option) => ({
								id: option.id,
								project_id: projectId,
								label: option.label ?? 'Standard',
								lead_time: option.lead_time ?? '2 weeks',
								markup_percentage: option.markup_percentage,
								material_markup_percentage: option.material_markup_percentage ?? null,
								labour_markup_percentage: option.labour_markup_percentage ?? null,
								equipment_markup_percentage: option.equipment_markup_percentage ?? null,
								subcontract_markup_percentage: option.subcontract_markup_percentage ?? null,
								notes: option.notes ?? '',
								sort_order: option.sort_order,
								is_default: option.is_default ? 1 : 0
							}))
						)
						.execute();
				}
			} catch (err) {
				log.error(`Failed to save quote options: ${err}`);
				throw err;
			}
		});
	}

	async resetQuoteWorkspace(projectId: string, options: QuoteOption[]): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const normalizedOptions =
					options.length > 0
						? options
								.map((option) =>
									this.normalizeQuoteOptionFormData({
										label: option.label,
										lead_time: option.lead_time,
										markup_percentage: option.markup_percentage,
										material_markup_percentage: option.material_markup_percentage,
										labour_markup_percentage: option.labour_markup_percentage,
										equipment_markup_percentage: option.equipment_markup_percentage,
										subcontract_markup_percentage: option.subcontract_markup_percentage,
										notes: option.notes,
										is_default: option.is_default
									})
								)
								.map((option, index) => ({
									...option,
									id: options[index].id,
									project_id: projectId,
									sort_order: index
								}))
						: [
								{
									id: crypto.randomUUID(),
									project_id: projectId,
									label: 'Standard',
									lead_time: '2 weeks',
									markup_percentage: 0,
									notes: '',
									is_default: true,
									sort_order: 0
								}
							];
				const hasDefault = normalizedOptions.some((option) => option.is_default);
				const persistedOptions = normalizedOptions.map((option, index) => ({
					...option,
					is_default: option.is_default || (!hasDefault && index === 0)
				}));
				const assetIds = await this.kysely!.selectFrom('assets')
					.select('id')
					.where('project_id', '=', projectId)
					.execute();

				await invoke('reset_quote_workspace_command', {
					input: {
						projectId,
						assetIds: assetIds.map((asset) => asset.id),
						quoteOptions: persistedOptions.map((option) => ({
							id: option.id,
							label: option.label ?? 'Standard',
							leadTime: option.lead_time ?? '2 weeks',
							markupPercentage: option.markup_percentage,
							materialMarkupPercentage: option.material_markup_percentage ?? null,
							labourMarkupPercentage: option.labour_markup_percentage ?? null,
							equipmentMarkupPercentage: option.equipment_markup_percentage ?? null,
							subcontractMarkupPercentage: option.subcontract_markup_percentage ?? null,
							notes: option.notes ?? '',
							sortOrder: option.sort_order,
							isDefault: option.is_default
						})),
						updatedAt: new Date().toISOString()
					}
				});
			} catch (err) {
				log.error(`Failed to reset quote workspace: ${err}`);
				throw err;
			}
		});
	}

	async createQuoteOption(option: QuoteOption): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const normalizedData = this.normalizeQuoteOptionFormData({
					label: option.label,
					lead_time: option.lead_time,
					markup_percentage: option.markup_percentage,
					material_markup_percentage: option.material_markup_percentage,
					labour_markup_percentage: option.labour_markup_percentage,
					equipment_markup_percentage: option.equipment_markup_percentage,
					subcontract_markup_percentage: option.subcontract_markup_percentage,
					notes: option.notes,
					is_default: option.is_default
				});
				const existingOptions = await this.kysely!.selectFrom('quote_options')
					.select(['id', 'is_default'])
					.where('project_id', '=', option.project_id)
					.orderBy('sort_order', 'asc')
					.execute();
				const shouldBeDefault = normalizedData.is_default || existingOptions.length === 0;

				if (shouldBeDefault) {
					await this.kysely!.updateTable('quote_options')
						.set({ is_default: 0 })
						.where('project_id', '=', option.project_id)
						.execute();
				}

				await this.kysely!.insertInto('quote_options')
					.values({
						id: option.id,
						project_id: option.project_id,
						label: normalizedData.label,
						lead_time: normalizedData.lead_time,
						markup_percentage: normalizedData.markup_percentage,
						material_markup_percentage: normalizedData.material_markup_percentage,
						labour_markup_percentage: normalizedData.labour_markup_percentage,
						equipment_markup_percentage: normalizedData.equipment_markup_percentage,
						subcontract_markup_percentage: normalizedData.subcontract_markup_percentage,
						notes: normalizedData.notes ?? '',
						sort_order: existingOptions.length,
						is_default: shouldBeDefault ? 1 : 0,
						created_at: option.created_at,
						updated_at: option.updated_at
					})
					.execute();
			} catch (err) {
				log.error(`Failed to create quote option: ${err}`);
				throw err;
			}
		});
	}

	async updateQuoteOption(optionId: string, data: QuoteOptionFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const existingRow = await this.kysely!.selectFrom('quote_options')
					.select(['id', 'project_id'])
					.where('id', '=', optionId)
					.executeTakeFirst();
				if (!existingRow) return;

				const normalizedData = this.normalizeQuoteOptionFormData(data);

				if (normalizedData.is_default) {
					await this.kysely!.updateTable('quote_options')
						.set({ is_default: 0 })
						.where('project_id', '=', existingRow.project_id)
						.execute();
				}

				await this.kysely!.updateTable('quote_options')
					.set({
						label: normalizedData.label,
						lead_time: normalizedData.lead_time,
						markup_percentage: normalizedData.markup_percentage,
						material_markup_percentage: normalizedData.material_markup_percentage,
						labour_markup_percentage: normalizedData.labour_markup_percentage,
						equipment_markup_percentage: normalizedData.equipment_markup_percentage,
						subcontract_markup_percentage: normalizedData.subcontract_markup_percentage,
						notes: normalizedData.notes ?? '',
						is_default: normalizedData.is_default ? 1 : 0,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', optionId)
					.execute();
			} catch (err) {
				log.error(`Failed to update quote option: ${err}`);
				throw err;
			}
		});
	}

	async addContactRelationship(
		id: string,
		workspaceId: string,
		data: Record<string, unknown>
	): Promise<string> {
		if (!isTauri()) return id;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.insertInto('contact_relationships')
					.values({
						id,
						workspace_id: workspaceId,
						from_contact_id: data.from_contact_id as string,
						to_contact_id: data.to_contact_id as string,
						relationship_type: data.relationship_type as string,
						is_primary: data.is_primary ? 1 : 0,
						notes: (data.notes as string) || null
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add contact relationship: ${err}`);
				throw err;
			}
		});
		return id;
	}

	async updateContactRelationship(id: string, data: Record<string, unknown>): Promise<string> {
		if (!isTauri()) return id;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('contact_relationships')
					.set({
						from_contact_id: data.from_contact_id as string,
						to_contact_id: data.to_contact_id as string,
						relationship_type: data.relationship_type as string,
						is_primary: data.is_primary ? 1 : 0,
						notes: (data.notes as string) || null
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update contact relationship: ${err}`);
				throw err;
			}
		});
		return id;
	}

	async deleteQuoteOption(optionId: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_quote_option_command', {
					input: { optionId }
				});
			} catch (err) {
				log.error(`Failed to delete quote option: ${err}`);
				throw err;
			}
		});
	}

	async setDefaultQuoteOption(optionId: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await invoke('set_default_quote_option_command', {
					input: { optionId }
				});
			} catch (err) {
				log.error(`Failed to set default quote option: ${err}`);
				throw err;
			}
		});
	}

	async getQuoteRevisions(projectId: string): Promise<QuoteRevision[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const revisionRows = QuoteRevisionRowArraySchema.parse(
				await this.kysely!.selectFrom('quote_revisions')
					.selectAll()
					.where('project_id', '=', projectId)
					.orderBy('revision_number', 'desc')
					.orderBy('created_at', 'desc')
					.execute()
			);

			if (revisionRows.length === 0) {
				return [];
			}

			const revisionIds = revisionRows.map((row) => row.id);
			const optionRows = QuoteRevisionOptionRowArraySchema.parse(
				await this.kysely!.selectFrom('quote_revision_options')
					.selectAll()
					.where('revision_id', 'in', revisionIds)
					.orderBy('sort_order', 'asc')
					.orderBy('created_at', 'asc')
					.execute()
			);

			const optionsByRevision = new Map<string, QuoteRevision['options']>();
			for (const row of optionRows) {
				const current = optionsByRevision.get(row.revision_id) ?? [];
				current.push({
					id: row.id,
					revision_id: row.revision_id,
					source_quote_option_id: row.source_quote_option_id,
					label: row.label,
					lead_time: row.lead_time,
					markup_percentage: row.markup_percentage,
					notes: row.notes,
					sort_order: row.sort_order,
					is_default: row.is_default,
					is_selected: row.is_selected,
					line_items: row.line_items_json,
					subtotal_amount: row.subtotal_amount,
					gst_amount: row.gst_amount,
					total_amount: row.total_amount,
					created_at: row.created_at,
					updated_at: row.updated_at
				});
				optionsByRevision.set(row.revision_id, current);
			}

			return revisionRows.map((row) => ({
				id: row.id,
				project_id: row.project_id,
				revision_number: row.revision_number,
				revision_label: row.revision_label,
				rfq_number_snapshot: row.rfq_number_snapshot,
				quote_number_snapshot: row.quote_number_snapshot,
				revision_reason: row.revision_reason,
				contact_name_snapshot: row.contact_name_snapshot,
				contact_country_code_snapshot: row.contact_country_code_snapshot,
				contact_business_id_label_snapshot: row.contact_business_id_label_snapshot,
				contact_business_id_value_snapshot: row.contact_business_id_value_snapshot,
				contact_tax_id_label_snapshot: row.contact_tax_id_label_snapshot,
				contact_tax_id_value_snapshot: row.contact_tax_id_value_snapshot,
				project_name_snapshot: row.project_name_snapshot,
				business_name_snapshot: row.business_name_snapshot,
				business_id_label_snapshot:
					row.business_id_label_snapshot ?? (row.business_abn_snapshot ? 'ABN' : null),
				business_id_value_snapshot: row.business_id_value_snapshot ?? row.business_abn_snapshot,
				tax_id_label_snapshot: row.tax_id_label_snapshot,
				tax_id_value_snapshot: row.tax_id_value_snapshot,
				tax_display_label_snapshot: row.tax_display_label_snapshot,
				tax_rate_percentage_snapshot: row.tax_rate_percentage_snapshot,
				business_abn_snapshot: row.business_abn_snapshot,
				business_address_snapshot: row.business_address_snapshot,
				business_email_snapshot: row.business_email_snapshot,
				business_contact_name_snapshot: row.business_contact_name_snapshot,
				business_contact_phone_snapshot: row.business_contact_phone_snapshot,
				currency_code_snapshot: row.currency_code_snapshot,
				currency_symbol_snapshot: row.currency_symbol_snapshot,
				issued_date: row.issued_date,
				valid_until_date: row.valid_until_date,
				sent_status: row.sent_status,
				sent_date: row.sent_date ?? null,
				sent_method: row.sent_method,
				recipient_snapshot: row.recipient_snapshot_json,
				terms_snapshot: row.terms_snapshot_json,
				package_attachments: row.package_attachments_json,
				options: optionsByRevision.get(row.id) ?? [],
				created_at: row.created_at,
				updated_at: row.updated_at
			}));
		} catch (err) {
			log.error(`Failed to get quote revisions: ${err}`);
			return [];
		}
	}

	async createQuoteRevision(input: CreateQuoteRevisionInput): Promise<QuoteRevision> {
		if (!isTauri()) {
			throw new Error('Quote revisions require Tauri');
		}
		await this.init();
		return await this.withWriteLock(async () => {
			try {
				const normalizedOptions = [...input.options]
					.sort((left, right) => left.sort_order - right.sort_order)
					.map((option, index) => ({
						...option,
						label: option.label.trim(),
						lead_time: option.lead_time.trim().replace(/\s+/g, ' '),
						notes: option.notes ?? '',
						sort_order: index,
						line_items: option.line_items.map((item) => ({
							file_name: item.file_name,
							description: item.description ?? '',
							quantity: item.quantity,
							lead_time: item.lead_time.trim().replace(/\s+/g, ' '),
							unit_price: item.unit_price,
							line_total: item.line_total
						}))
					}));
				const hasDefault = normalizedOptions.some((option) => option.is_default);
				const hasSelected = normalizedOptions.some((option) => option.is_selected);
				const persistedOptions = normalizedOptions.map((option, index) => ({
					...option,
					is_default: option.is_default || (!hasDefault && index === 0),
					is_selected: option.is_selected || (!hasSelected && index === 0)
				}));
				const result = (await invoke('create_quote_revision_command', {
					input: {
						projectId: input.project_id,
						rfqNumber: input.rfq_number,
						quoteNumber: input.quote_number ?? null,
						revisionReason: input.revision_reason ?? '',
						contactName: input.contact_name ?? null,
						contact: input.contact
							? {
									countryCode: input.contact.countryCode ?? null,
									businessIdLabel: input.contact.businessIdLabel ?? null,
									businessIdValue: input.contact.businessIdValue ?? null,
									taxIdLabel: input.contact.taxIdLabel ?? null,
									taxIdValue: input.contact.taxIdValue ?? null
								}
							: null,
						projectName: input.project_name ?? null,
						business: {
							name: input.business.name,
							countryCode: input.business.countryCode ?? null,
							abn: input.business.abn ?? null,
							businessIdLabel: input.business.businessIdLabel ?? null,
							businessIdValue: input.business.businessIdValue ?? null,
							taxIdLabel: input.business.taxIdLabel ?? null,
							taxIdValue: input.business.taxIdValue ?? null,
							taxDisplayLabel: input.business.taxDisplayLabel ?? null,
							taxRatePercentage:
								typeof input.business.taxRatePercentage === 'number'
									? input.business.taxRatePercentage
									: null,
							address: input.business.address ?? null,
							contactName: input.business.contactName ?? null,
							contactEmail: input.business.contactEmail ?? null,
							contactPhone: input.business.contactPhone ?? null,
							currencyCode: input.business.currency_code,
							currencySymbol: input.business.currency_symbol
						},
						issuedDate: input.issued_date,
						validUntilDate: input.valid_until_date,
						packageAttachmentsJson: stringifyJsonArray(input.package_attachments ?? []),
						sent: input.sent ?? {
							status: 'exported',
							date: input.issued_date,
							method: 'download'
						},
						recipientSnapshot: input.recipientSnapshot ?? null,
						termsSnapshot: input.termsSnapshot ?? null,
						options: persistedOptions.map((option) => ({
							sourceQuoteOptionId: option.source_quote_option_id ?? null,
							label: option.label,
							leadTime: option.lead_time,
							markupPercentage: Math.max(-100, option.markup_percentage),
							notes: option.notes,
							sortOrder: option.sort_order,
							isDefault: option.is_default,
							isSelected: option.is_selected,
							lineItemsJson: stringifyJsonArray(option.line_items),
							subtotalAmount: option.subtotal_amount,
							gstAmount: option.gst_amount,
							totalAmount: option.total_amount
						}))
					}
				})) as { revisionId?: string };
				const revisionId = result.revisionId;
				if (!revisionId) {
					throw new Error('Created quote revision id was not returned');
				}

				const revisions = await this.getQuoteRevisions(input.project_id);
				const createdRevision = revisions.find((revision) => revision.id === revisionId);
				if (!createdRevision) {
					throw new Error('Created quote revision could not be reloaded');
				}
				return createdRevision;
			} catch (err) {
				log.error(`Failed to create quote revision: ${err}`);
				throw err;
			}
		});
	}

	async getClassificationSystems(): Promise<ClassificationSystem[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const rows = await this.kysely!.selectFrom('classification_systems')
			.selectAll()
			.where('workspace_id', '=', workspaceId)
			.orderBy('is_default', 'desc')
			.orderBy('name', 'asc')
			.execute();
		return ClassificationSystemRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			name: row.name,
			code: row.code,
			classification_type: row.classification_type,
			aliases: row.aliases_json,
			is_default: row.is_default,
			created_at: row.created_at
		}));
	}

	async getClassificationSystemById(
		id: string,
		workspaceId?: string
	): Promise<ClassificationSystem | null> {
		if (!isTauri()) return null;
		await this.init();
		const wsId = workspaceId ?? (await this.getWorkspaceIdForWrite());
		const row = await this.kysely!.selectFrom('classification_systems')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', wsId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = ClassificationSystemRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`ClassificationSystemRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`
			);
			return null;
		}
		return {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			name: parsed.data.name,
			code: parsed.data.code,
			classification_type: parsed.data.classification_type,
			aliases: parsed.data.aliases_json,
			is_default: parsed.data.is_default,
			created_at: parsed.data.created_at
		};
	}

	async getCostCodes(
		classificationSystemId: string | null,
		includeInactive = false
	): Promise<CostCode[]> {
		if (!isTauri() || !classificationSystemId) return [];
		await this.init();
		let query = this.kysely!.selectFrom('cost_codes')
			.selectAll()
			.where('classification_system_id', '=', classificationSystemId)
			.orderBy('sort_order', 'asc')
			.orderBy('code', 'asc');
		if (!includeInactive) {
			query = query.where('is_active', '=', 1);
		}
		const rows = await query.execute();
		return CostCodeRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			classification_system_id: row.classification_system_id,
			parent_id: row.parent_id,
			code: row.code,
			name: row.name,
			description: row.description,
			is_active: row.is_active,
			sort_order: row.sort_order,
			created_at: row.created_at
		}));
	}

	async getCostCodeById(id: string): Promise<CostCode | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('cost_codes')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = CostCodeRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(`CostCodeRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`);
			return null;
		}
		return {
			id: parsed.data.id,
			classification_system_id: parsed.data.classification_system_id,
			parent_id: parsed.data.parent_id,
			code: parsed.data.code,
			name: parsed.data.name,
			description: parsed.data.description,
			is_active: parsed.data.is_active,
			sort_order: parsed.data.sort_order,
			created_at: parsed.data.created_at
		};
	}

	async getWbsNodes(projectId: string): Promise<WbsNode[]> {
		if (!isTauri()) return [];
		await this.init();
		const rows = await this.kysely!.selectFrom('wbs_nodes')
			.selectAll()
			.where('project_id', '=', projectId)
			.orderBy('sort_order', 'asc')
			.orderBy('name', 'asc')
			.execute();
		return WbsNodeRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			project_id: row.project_id,
			parent_id: row.parent_id,
			code: row.code,
			name: row.name,
			type: row.type,
			sort_order: row.sort_order,
			created_at: row.created_at
		}));
	}

	async getWbsNodeById(id: string): Promise<WbsNode | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('wbs_nodes')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = WbsNodeRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(`WbsNodeRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`);
			return null;
		}
		return {
			id: parsed.data.id,
			project_id: parsed.data.project_id,
			parent_id: parsed.data.parent_id,
			code: parsed.data.code,
			name: parsed.data.name,
			type: parsed.data.type,
			sort_order: parsed.data.sort_order,
			created_at: parsed.data.created_at
		};
	}

	private async getLinkedCompaniesForCatalogueRecord(
		scope: CatalogueRecordCompanyLinksResult['scope'],
		recordId: string
	): Promise<LinkedCompanySummary[]> {
		if (!isTauri()) return [];
		await this.init();
		const queryForScope = () => {
			switch (scope) {
				case 'materials':
					return this.kysely!.selectFrom('company_material_links as link')
						.innerJoin('contacts as c', 'c.id', 'link.company_id')
						.select(['c.id as id', 'c.display_name as displayName'])
						.where('link.material_id', '=', recordId)
						.orderBy('c.display_name', 'asc');
				case 'labour_rates':
					return this.kysely!.selectFrom('company_labour_rate_links as link')
						.innerJoin('contacts as c', 'c.id', 'link.company_id')
						.select(['c.id as id', 'c.display_name as displayName'])
						.where('link.labour_rate_id', '=', recordId)
						.orderBy('c.display_name', 'asc');
				case 'equipment_rates':
					return this.kysely!.selectFrom('company_equipment_rate_links as link')
						.innerJoin('contacts as c', 'c.id', 'link.company_id')
						.select(['c.id as id', 'c.display_name as displayName'])
						.where('link.equipment_rate_id', '=', recordId)
						.orderBy('c.display_name', 'asc');
				case 'subcontract_rates':
					return this.kysely!.selectFrom('company_subcontract_rate_links as link')
						.innerJoin('contacts as c', 'c.id', 'link.company_id')
						.select(['c.id as id', 'c.display_name as displayName'])
						.where('link.subcontract_rate_id', '=', recordId)
						.orderBy('c.display_name', 'asc');
			}
		};
		const rows = await queryForScope().execute();
		return rows.map((row) => ({
			id: row.id,
			displayName: row.displayName?.trim() || 'Unnamed company'
		}));
	}

	private async getLinkedCompaniesForCatalogueRecordsBulk(
		scope: CatalogueRecordCompanyLinksResult['scope'],
		recordIds: string[]
	): Promise<Record<string, LinkedCompanySummary[]>> {
		if (!isTauri() || recordIds.length === 0) return {};
		await this.init();
		const queryForScope = () => {
			switch (scope) {
				case 'materials':
					return this.kysely!.selectFrom('company_material_links as link')
						.innerJoin('contacts as c', 'c.id', 'link.company_id')
						.select(['link.material_id as recordId', 'c.id as id', 'c.display_name as displayName'])
						.where('link.material_id', 'in', recordIds)
						.orderBy('c.display_name', 'asc');
				case 'labour_rates':
					return this.kysely!.selectFrom('company_labour_rate_links as link')
						.innerJoin('contacts as c', 'c.id', 'link.company_id')
						.select([
							'link.labour_rate_id as recordId',
							'c.id as id',
							'c.display_name as displayName'
						])
						.where('link.labour_rate_id', 'in', recordIds)
						.orderBy('c.display_name', 'asc');
				case 'equipment_rates':
					return this.kysely!.selectFrom('company_equipment_rate_links as link')
						.innerJoin('contacts as c', 'c.id', 'link.company_id')
						.select([
							'link.equipment_rate_id as recordId',
							'c.id as id',
							'c.display_name as displayName'
						])
						.where('link.equipment_rate_id', 'in', recordIds)
						.orderBy('c.display_name', 'asc');
				case 'subcontract_rates':
					return this.kysely!.selectFrom('company_subcontract_rate_links as link')
						.innerJoin('contacts as c', 'c.id', 'link.company_id')
						.select([
							'link.subcontract_rate_id as recordId',
							'c.id as id',
							'c.display_name as displayName'
						])
						.where('link.subcontract_rate_id', 'in', recordIds)
						.orderBy('c.display_name', 'asc');
			}
		};
		const rows = await queryForScope().execute();
		const result: Record<string, LinkedCompanySummary[]> = {};
		for (const id of recordIds) {
			result[id] = [];
		}
		for (const row of rows) {
			const recordId = row.recordId as string;
			result[recordId].push({
				id: row.id as string,
				displayName: (row.displayName as string | null)?.trim() || 'Unnamed company'
			});
		}
		return result;
	}

	async getMaterialCatalogueItems(includeInactive = false): Promise<MaterialCatalogueItem[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		let query = this.kysely!.selectFrom('material_catalog_items')
			.selectAll()
			.where('workspace_id', '=', workspaceId)
			.orderBy('name', 'asc');
		if (!includeInactive) {
			query = query.where('is_active', '=', 1);
		}
		const rows = await query.execute();
		const items = MaterialCatalogueItemRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			code: row.code,
			name: row.name,
			category: row.category,
			specification: row.specification,
			unit: normaliseMaterialUnitCode(row.unit) ?? 'ea',
			default_rate: row.default_rate,
			currency_code: row.currency_code ?? undefined,
			aliases: row.aliases_json,
			metadata: row.metadata_json,
			effective_date: row.effective_date ?? null,
			verified_date: row.verified_date ?? null,
			rate_basis: row.rate_basis,
			lead_time: row.lead_time,
			availability: row.availability,
			reference: row.reference,
			is_active: row.is_active,
			created_at: row.created_at,
			updated_at: row.updated_at
		}));
		const itemIds = items.map((i) => i.id);
		const bulkLinks = await this.getLinkedCompaniesForCatalogueRecordsBulk('materials', itemIds);
		return items.map((item) => ({
			...item,
			linkedCompanies: bulkLinks[item.id] || []
		}));
	}

	async getMaterialCatalogueItemById(id: string): Promise<MaterialCatalogueItem | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const row = await this.kysely!.selectFrom('material_catalog_items')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = MaterialCatalogueItemRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`MaterialCatalogueItemRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`
			);
			return null;
		}
		const item: MaterialCatalogueItem = {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			code: parsed.data.code,
			name: parsed.data.name,
			category: parsed.data.category,
			specification: parsed.data.specification,
			unit: normaliseMaterialUnitCode(parsed.data.unit) ?? 'ea',
			default_rate: parsed.data.default_rate,
			currency_code: parsed.data.currency_code ?? undefined,
			aliases: parsed.data.aliases_json,
			metadata: parsed.data.metadata_json,
			effective_date: parsed.data.effective_date ?? null,
			verified_date: parsed.data.verified_date ?? null,
			rate_basis: parsed.data.rate_basis,
			lead_time: parsed.data.lead_time,
			availability: parsed.data.availability,
			reference: parsed.data.reference,
			is_active: parsed.data.is_active,
			created_at: parsed.data.created_at,
			updated_at: parsed.data.updated_at
		};
		item.linkedCompanies = await this.getLinkedCompaniesForCatalogueRecord('materials', item.id);
		return item;
	}

	async getLabourRateCards(includeInactive = false): Promise<LabourRateCard[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		let query = this.kysely!.selectFrom('labour_rate_cards')
			.selectAll()
			.where('workspace_id', '=', workspaceId)
			.orderBy('name', 'asc');
		if (!includeInactive) {
			query = query.where('is_active', '=', 1);
		}
		const rows = await query.execute();
		const items = LabourRateCardRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			code: row.code,
			name: row.name,
			category: row.category,
			work_center: row.work_center,
			unit: normaliseLabourRateUnitCode(row.unit) ?? 'hr',
			default_rate: row.default_rate,
			currency_code: row.currency_code ?? undefined,
			aliases: row.aliases_json,
			metadata: row.metadata_json,
			effective_date: row.effective_date ?? null,
			verified_date: row.verified_date ?? null,
			rate_basis: row.rate_basis,
			lead_time: row.lead_time,
			availability: row.availability,
			reference: row.reference,
			is_active: row.is_active,
			created_at: row.created_at,
			updated_at: row.updated_at
		}));
		const itemIds = items.map((i) => i.id);
		const bulkLinks = await this.getLinkedCompaniesForCatalogueRecordsBulk('labour_rates', itemIds);
		return items.map((item) => ({
			...item,
			linkedCompanies: bulkLinks[item.id] || []
		}));
	}

	async getLabourRateCardById(id: string): Promise<LabourRateCard | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const row = await this.kysely!.selectFrom('labour_rate_cards')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = LabourRateCardRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`LabourRateCardRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`
			);
			return null;
		}
		const item: LabourRateCard = {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			code: parsed.data.code,
			name: parsed.data.name,
			category: parsed.data.category,
			work_center: parsed.data.work_center,
			unit: normaliseLabourRateUnitCode(parsed.data.unit) ?? 'hr',
			default_rate: parsed.data.default_rate,
			currency_code: parsed.data.currency_code ?? undefined,
			aliases: parsed.data.aliases_json,
			metadata: parsed.data.metadata_json,
			effective_date: parsed.data.effective_date ?? null,
			verified_date: parsed.data.verified_date ?? null,
			rate_basis: parsed.data.rate_basis,
			lead_time: parsed.data.lead_time,
			availability: parsed.data.availability,
			reference: parsed.data.reference,
			is_active: parsed.data.is_active,
			created_at: parsed.data.created_at,
			updated_at: parsed.data.updated_at
		};
		item.linkedCompanies = await this.getLinkedCompaniesForCatalogueRecord('labour_rates', item.id);
		return item;
	}

	async getEquipmentRateCards(includeInactive = false): Promise<EquipmentRateCard[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		let query = this.kysely!.selectFrom('equipment_rate_cards')
			.selectAll()
			.where('workspace_id', '=', workspaceId)
			.orderBy('name', 'asc');
		if (!includeInactive) {
			query = query.where('is_active', '=', 1);
		}
		const rows = await query.execute();
		const items = EquipmentRateCardRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			code: row.code,
			name: row.name,
			category: row.category,
			work_center: row.work_center,
			unit: normaliseEquipmentRateUnitCode(row.unit) ?? 'hr',
			default_rate: row.default_rate,
			currency_code: row.currency_code ?? undefined,
			aliases: row.aliases_json,
			metadata: row.metadata_json,
			effective_date: row.effective_date ?? null,
			verified_date: row.verified_date ?? null,
			rate_basis: row.rate_basis,
			lead_time: row.lead_time,
			availability: row.availability,
			reference: row.reference,
			is_active: row.is_active,
			created_at: row.created_at,
			updated_at: row.updated_at
		}));
		const itemIds = items.map((i) => i.id);
		const bulkLinks = await this.getLinkedCompaniesForCatalogueRecordsBulk(
			'equipment_rates',
			itemIds
		);
		return items.map((item) => ({
			...item,
			linkedCompanies: bulkLinks[item.id] || []
		}));
	}

	async getEquipmentRateCardById(id: string): Promise<EquipmentRateCard | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const row = await this.kysely!.selectFrom('equipment_rate_cards')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = EquipmentRateCardRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`EquipmentRateCardRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`
			);
			return null;
		}
		const item: EquipmentRateCard = {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			code: parsed.data.code,
			name: parsed.data.name,
			category: parsed.data.category,
			work_center: parsed.data.work_center,
			unit: normaliseEquipmentRateUnitCode(parsed.data.unit) ?? 'hr',
			default_rate: parsed.data.default_rate,
			currency_code: parsed.data.currency_code ?? undefined,
			aliases: parsed.data.aliases_json,
			metadata: parsed.data.metadata_json,
			effective_date: parsed.data.effective_date ?? null,
			verified_date: parsed.data.verified_date ?? null,
			rate_basis: parsed.data.rate_basis,
			lead_time: parsed.data.lead_time,
			availability: parsed.data.availability,
			reference: parsed.data.reference,
			is_active: parsed.data.is_active,
			created_at: parsed.data.created_at,
			updated_at: parsed.data.updated_at
		};
		item.linkedCompanies = await this.getLinkedCompaniesForCatalogueRecord(
			'equipment_rates',
			item.id
		);
		return item;
	}

	async getSubcontractRateCards(includeInactive = false): Promise<SubcontractRateCard[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		let query = this.kysely!.selectFrom('subcontract_rate_cards')
			.selectAll()
			.where('workspace_id', '=', workspaceId)
			.orderBy('name', 'asc');
		if (!includeInactive) {
			query = query.where('is_active', '=', 1);
		}
		const rows = await query.execute();
		const items = SubcontractRateCardRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			code: row.code,
			name: row.name,
			category: row.category,
			unit: normaliseSubcontractRateUnitCode(row.unit) ?? 'lot',
			default_rate: row.default_rate,
			currency_code: row.currency_code ?? undefined,
			aliases: row.aliases_json,
			metadata: row.metadata_json,
			effective_date: row.effective_date ?? null,
			verified_date: row.verified_date ?? null,
			rate_basis: row.rate_basis,
			lead_time: row.lead_time,
			availability: row.availability,
			reference: row.reference,
			is_active: row.is_active,
			created_at: row.created_at,
			updated_at: row.updated_at
		}));
		const itemIds = items.map((i) => i.id);
		const bulkLinks = await this.getLinkedCompaniesForCatalogueRecordsBulk(
			'subcontract_rates',
			itemIds
		);
		return items.map((item) => ({
			...item,
			linkedCompanies: bulkLinks[item.id] || []
		}));
	}

	async getSubcontractRateCardById(id: string): Promise<SubcontractRateCard | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const row = await this.kysely!.selectFrom('subcontract_rate_cards')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = SubcontractRateCardRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`SubcontractRateCardRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`
			);
			return null;
		}
		const item: SubcontractRateCard = {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			code: parsed.data.code,
			name: parsed.data.name,
			category: parsed.data.category,
			unit: normaliseSubcontractRateUnitCode(parsed.data.unit) ?? 'lot',
			default_rate: parsed.data.default_rate,
			currency_code: parsed.data.currency_code ?? undefined,
			aliases: parsed.data.aliases_json,
			metadata: parsed.data.metadata_json,
			effective_date: parsed.data.effective_date ?? null,
			verified_date: parsed.data.verified_date ?? null,
			rate_basis: parsed.data.rate_basis,
			lead_time: parsed.data.lead_time,
			availability: parsed.data.availability,
			reference: parsed.data.reference,
			is_active: parsed.data.is_active,
			created_at: parsed.data.created_at,
			updated_at: parsed.data.updated_at
		};
		item.linkedCompanies = await this.getLinkedCompaniesForCatalogueRecord(
			'subcontract_rates',
			item.id
		);
		return item;
	}

	async getCostComponentPresets(includeInactive = false): Promise<CostComponentPreset[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		let query = this.kysely!.selectFrom('cost_component_presets')
			.selectAll()
			.where('workspace_id', '=', workspaceId)
			.orderBy('name', 'asc');
		if (!includeInactive) {
			query = query.where('is_active', '=', 1);
		}
		const rows = await query.execute();
		return CostComponentPresetRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			code: row.code,
			name: row.name,
			description: row.description,
			aliases: row.aliases_json,
			components: this.sanitiseCostComponentPresetComponents(row.components_json, references),
			is_active: row.is_active,
			created_at: row.created_at,
			updated_at: row.updated_at
		}));
	}

	async getCostComponentPresetById(id: string): Promise<CostComponentPreset | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		const row = await this.kysely!.selectFrom('cost_component_presets')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = CostComponentPresetRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`CostComponentPresetRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`
			);
			return null;
		}
		return {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			code: parsed.data.code,
			name: parsed.data.name,
			description: parsed.data.description,
			aliases: parsed.data.aliases_json,
			components: this.sanitiseCostComponentPresetComponents(
				parsed.data.components_json,
				references
			),
			is_active: parsed.data.is_active,
			created_at: parsed.data.created_at,
			updated_at: parsed.data.updated_at
		};
	}

	async getEstimateTemplates(includeInactive = false): Promise<EstimateTemplate[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		let query = this.kysely!.selectFrom('estimate_templates')
			.selectAll()
			.where('workspace_id', '=', workspaceId)
			.orderBy('name', 'asc');
		if (!includeInactive) {
			query = query.where('is_active', '=', 1);
		}
		const rows = await query.execute();
		return EstimateTemplateRowArraySchema.parse(rows).map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			code: row.code,
			name: row.name,
			description: row.description,
			aliases: row.aliases_json,
			estimate: this.sanitiseEstimateTemplatePayload(row.estimate_json, references),
			is_active: row.is_active,
			created_at: row.created_at,
			updated_at: row.updated_at
		}));
	}

	async getEstimateTemplateById(id: string): Promise<EstimateTemplate | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		const row = await this.kysely!.selectFrom('estimate_templates')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = EstimateTemplateRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`EstimateTemplateRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`
			);
			return null;
		}
		return {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			code: parsed.data.code,
			name: parsed.data.name,
			description: parsed.data.description,
			aliases: parsed.data.aliases_json,
			estimate: this.sanitiseEstimateTemplatePayload(parsed.data.estimate_json, references),
			is_active: parsed.data.is_active,
			created_at: parsed.data.created_at,
			updated_at: parsed.data.updated_at
		};
	}

	async getQuoteOptionPresets(): Promise<QuoteOptionPreset[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const rows = QuoteOptionPresetRowArraySchema.parse(
			await this.kysely!.selectFrom('quote_option_presets')
				.selectAll()
				.where('workspace_id', '=', workspaceId)
				.orderBy('label', 'asc')
				.execute()
		);
		return rows.map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			label: row.label,
			lead_time: row.lead_time,
			markup_percentage: row.markup_percentage,
			material_markup_percentage: row.material_markup_percentage ?? null,
			labour_markup_percentage: row.labour_markup_percentage ?? null,
			equipment_markup_percentage: row.equipment_markup_percentage ?? null,
			subcontract_markup_percentage: row.subcontract_markup_percentage ?? null,
			notes: row.notes,
			created_at: row.created_at,
			updated_at: row.updated_at
		}));
	}

	async getQuoteOptionPresetById(id: string): Promise<QuoteOptionPreset | null> {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const row = await this.kysely!.selectFrom('quote_option_presets')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', workspaceId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = QuoteOptionPresetRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`QuoteOptionPresetRowSchema validation failed: ${JSON.stringify(parsed.error.format())}`
			);
			return null;
		}
		return {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			label: parsed.data.label,
			lead_time: parsed.data.lead_time,
			markup_percentage: parsed.data.markup_percentage,
			material_markup_percentage: parsed.data.material_markup_percentage ?? null,
			labour_markup_percentage: parsed.data.labour_markup_percentage ?? null,
			equipment_markup_percentage: parsed.data.equipment_markup_percentage ?? null,
			subcontract_markup_percentage: parsed.data.subcontract_markup_percentage ?? null,
			notes: parsed.data.notes,
			created_at: parsed.data.created_at,
			updated_at: parsed.data.updated_at
		};
	}

	async getProjectStructureTemplates(includeInactive = false): Promise<ProjectStructureTemplate[]> {
		if (!isTauri()) return [];
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		let query = this.kysely!.selectFrom('project_structure_templates')
			.selectAll()
			.where('workspace_id', '=', workspaceId)
			.orderBy('name', 'asc');
		if (!includeInactive) {
			query = query.where('is_active', '=', 1);
		}
		const rows = ProjectStructureTemplateRowArraySchema.parse(await query.execute());
		if (rows.length === 0) return [];
		const templateIds = rows.map((row) => row.id);
		const nodeRows = ProjectStructureTemplateNodeRowArraySchema.parse(
			await this.kysely!.selectFrom('project_structure_template_nodes')
				.selectAll()
				.where('template_id', 'in', templateIds)
				.orderBy('sort_order', 'asc')
				.orderBy('name', 'asc')
				.execute()
		);
		const nodesByTemplate = new Map<string, ProjectStructureTemplateNode[]>();
		for (const node of nodeRows) {
			const current = nodesByTemplate.get(node.template_id) ?? [];
			current.push({
				id: node.id,
				template_id: node.template_id,
				parent_id: node.parent_id,
				code: node.code,
				name: node.name,
				type: node.type,
				sort_order: node.sort_order,
				created_at: node.created_at
			});
			nodesByTemplate.set(node.template_id, current);
		}
		return rows.map((row) => ({
			id: row.id,
			workspace_id: row.workspace_id,
			code: row.code,
			name: row.name,
			description: row.description,
			nodes: nodesByTemplate.get(row.id) ?? [],
			is_active: row.is_active,
			created_at: row.created_at,
			updated_at: row.updated_at
		}));
	}

	async getProjectStructureTemplateById(
		id: string,
		workspaceId?: string
	): Promise<ProjectStructureTemplate | null> {
		if (!isTauri()) return null;
		await this.init();
		const wsId = workspaceId ?? (await this.getWorkspaceIdForWrite());
		const row = await this.kysely!.selectFrom('project_structure_templates')
			.selectAll()
			.where('id', '=', id)
			.where('workspace_id', '=', wsId)
			.executeTakeFirst();
		if (!row) return null;
		const parsed = ProjectStructureTemplateRowSchema.safeParse(row);
		if (!parsed.success) {
			log.error(
				`ProjectStructureTemplateRowSchema validation failed: ${JSON.stringify(
					parsed.error.format()
				)}`
			);
			return null;
		}
		const nodes = ProjectStructureTemplateNodeRowArraySchema.parse(
			await this.kysely!.selectFrom('project_structure_template_nodes')
				.selectAll()
				.where('template_id', '=', id)
				.orderBy('sort_order', 'asc')
				.orderBy('name', 'asc')
				.execute()
		).map((node) => ({
			id: node.id,
			template_id: node.template_id,
			parent_id: node.parent_id,
			code: node.code,
			name: node.name,
			type: node.type,
			sort_order: node.sort_order,
			created_at: node.created_at
		}));
		return {
			id: parsed.data.id,
			workspace_id: parsed.data.workspace_id,
			code: parsed.data.code,
			name: parsed.data.name,
			description: parsed.data.description,
			nodes,
			is_active: parsed.data.is_active,
			created_at: parsed.data.created_at,
			updated_at: parsed.data.updated_at
		};
	}

	// --- Contacts ---

	async getContacts(): Promise<Contact[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			if (!this.db) return [];
			const workspaceId = await this.getWorkspaceIdForWrite();
			const raw = await this.db.select<unknown[]>(
				'SELECT * FROM contacts WHERE workspace_id = $1 ORDER BY sort_order ASC, name ASC',
				[workspaceId]
			);
			return this.mapContactRows(raw);
		} catch (err) {
			log.error(`Failed to fetch contacts: ${err}`);
			return [];
		}
	}

	async getProjectStructureTemplateNode(id: string): Promise<Record<string, unknown> | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('project_structure_template_nodes')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row ?? null;
	}

	async getWbsNode(id: string): Promise<Record<string, unknown> | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('wbs_nodes')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row ?? null;
	}

	async getQuoteOption(id: string): Promise<Record<string, unknown> | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('quote_options')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row ?? null;
	}

	async getContactRelationship(id: string): Promise<Record<string, unknown> | null> {
		if (!isTauri()) return null;
		await this.init();
		const row = await this.kysely!.selectFrom('contact_relationships')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row ?? null;
	}

	async getContactById(id: string): Promise<Contact | null> {
		if (!isTauri()) return null;
		await this.init();
		try {
			const workspaceId = await this.getWorkspaceIdForWrite();
			const raw = await this.db!.select<unknown[]>(
				'SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2 LIMIT 1',
				[id, workspaceId]
			);
			return raw[0] ? this.mapContactRow(raw[0]) : null;
		} catch (err) {
			log.error(`Failed to fetch contact by id: ${err}`);
			return null;
		}
	}

	// Workspace-wide lookup kept for compatibility; callers apply company/person scope before writes.
	async findContactByName(name: string): Promise<Contact | null> {
		if (!isTauri()) return null;
		await this.init();
		try {
			const contacts = await this.getContacts();
			const normalizedTarget = normaliseContactName(name);
			return (
				contacts.find((contact) => normaliseContactName(contact.name) === normalizedTarget) ?? null
			);
		} catch (err) {
			log.error(`Failed to find contact by name: ${err}`);
			return null;
		}
	}

	async executeApprovedContactsBundle(
		payload: AssistantApprovedContactsBundlePayload
	): Promise<AssistantApprovedContactsBundleResult> {
		if (!isTauri()) {
			return { status: 'failed', successCount: 0, failureCount: 1, errors: ['Tauri unavailable'] };
		}
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		return await this.withWriteLock(async () => {
			const updatedAt = new Date().toISOString();
			const actions = payload.actions.map((action) => ({
				id: action.id,
				action: action.action,
				recordId: action.recordId,
				data: this.normalizeContactFormData(action.data)
			}));
			return await invoke<AssistantApprovedContactsBundleResult>(
				'execute_approved_contacts_bundle_command',
				{
					input: {
						proposalId: payload.proposalId,
						turnId: payload.turnId,
						toolName: payload.toolName,
						workspaceId,
						updatedAt,
						actions
					}
				}
			);
		});
	}

	async executeApprovedRecordProposalSet(
		payload: AssistantApprovedRecordProposalSetPayload
	): Promise<AssistantApprovedContactsBundleResult> {
		if (!isTauri()) {
			return { status: 'failed', successCount: 0, failureCount: 1, errors: ['Tauri unavailable'] };
		}
		await this.init();
		return await this.withWriteLock(async () => {
			return await invoke<AssistantApprovedContactsBundleResult>(
				'execute_approved_record_proposal_set_command',
				{
					input: {
						proposalSetId: payload.proposalSetId,
						turnId: payload.turnId,
						items: payload.items
					}
				}
			);
		});
	}

	async writeAssistantActionAudit(entry: {
		turnId: string;
		actionId: string;
		toolName: string;
		status: string;
		itemCount?: number;
		issueCount?: number;
		errorCount?: number;
		errorMessage?: string;
		payloadJson?: string;
	}): Promise<void> {
		if (!isTauri()) return;
		try {
			await this.init();
			const workspaceId = await this.getWorkspaceIdForWrite();
			await invoke('write_assistant_action_audit_command', {
				input: {
					workspaceId,
					turnId: entry.turnId,
					actionId: entry.actionId,
					toolName: entry.toolName,
					status: entry.status,
					itemCount: entry.itemCount ?? 0,
					issueCount: entry.issueCount ?? 0,
					errorCount: entry.errorCount ?? 0,
					errorMessage: entry.errorMessage ?? null,
					payloadJson: entry.payloadJson ?? null
				}
			});
		} catch (err) {
			log.warn('Failed to write assistant action audit entry', { err });
		}
	}

	async addContact(id: string, data: ContactFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeContactFormData(data);
		await this.withWriteLock(async () => {
			try {
				const sortOrder = await this.getNextContactSortOrder(workspaceId);
				let dataForInsert = normalizedData;
				const linkedCompanyId = normalizedData.linked_company_id?.trim() ?? '';
				if (
					normalizedData.kind === 'person' &&
					linkedCompanyId.length > 0 &&
					normalizedData.is_primary_company_contact !== true
				) {
					const existingPrimaryOrActivePerson = await this.kysely!.selectFrom('contacts')
						.select('id')
						.where('workspace_id', '=', workspaceId)
						.where('kind', '=', 'person')
						.where('linked_company_id', '=', linkedCompanyId)
						.where('is_active', '=', 1)
						.limit(1)
						.executeTakeFirst();
					if (!existingPrimaryOrActivePerson) {
						dataForInsert = { ...normalizedData, is_primary_company_contact: true };
					}
				}
				await invoke('add_contact_command', {
					input: {
						id,
						workspaceId,
						sortOrder,
						updatedAt: new Date().toISOString(),
						data: dataForInsert
					}
				});
			} catch (err) {
				const surfacedError = unwrapRollbackFollowupError(err);
				if (surfacedError !== err) {
					log.error(`Contact create rollback follow-up error: ${err}`);
				}
				log.error(`Failed to add contact: ${surfacedError}`);
				throw surfacedError;
			}
		});
	}

	async updateContact(id: string, data: ContactFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeContactFormData(data);
		await this.withWriteLock(async () => {
			try {
				await invoke('update_contact_command', {
					input: {
						id,
						workspaceId,
						sortOrder: null,
						updatedAt: new Date().toISOString(),
						data: normalizedData
					}
				});
			} catch (err) {
				const surfacedError = unwrapRollbackFollowupError(err);
				if (surfacedError !== err) {
					log.error(`Contact update rollback follow-up error: ${err}`);
				}
				log.error(`Failed to update contact: ${surfacedError}`);
				throw surfacedError;
			}
		});
	}

	async deleteContact(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.deleteFrom('contacts').where('id', '=', id).execute();
			} catch (err) {
				log.error(`Failed to delete contact: ${err}`);
				throw err;
			}
		});
	}

	async applySetupImportSession(payload: SetupImportSessionPayload): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			const workspaceId = await this.getWorkspaceIdForWrite();
			const estimateReferences = await this.buildEstimateReferenceIndex(workspaceId);

			const normalizedPayload = {
				audit: payload.audit,
				contacts: payload.contacts.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					data: this.normalizeContactFormData(operation.data)
				})),
				materials: payload.materials.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					data: this.normalizeMaterialCatalogueItemFormData(operation.data)
				})),
				labourRates: payload.labourRates.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					data: this.normalizeLabourRateCardFormData(operation.data)
				})),
				equipmentRates: payload.equipmentRates.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					data: this.normalizeEquipmentRateCardFormData(operation.data)
				})),
				subcontractRates: payload.subcontractRates.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					data: this.normalizeSubcontractRateCardFormData(operation.data)
				})),
				costPresets: payload.costPresets.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					data: {
						...this.normalizeCostComponentPresetFormData(operation.data),
						components_json: this.sanitiseCostComponentPresetComponents(
							operation.data.components_json ?? [],
							estimateReferences
						)
					}
				})),
				estimateTemplates: payload.estimateTemplates.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					data: {
						...this.normalizeEstimateTemplateFormData(operation.data),
						estimate_json: this.sanitiseEstimateTemplatePayload(
							operation.data.estimate_json ?? {
								scope_summary: '',
								notes: '',
								takeoff_items: []
							},
							estimateReferences
						)
					}
				})),
				projectStructureTemplates: payload.projectStructureTemplates.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					data: operation.data
				})),
				classificationSystems: payload.classificationSystems.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					clientKey: operation.clientKey,
					data: this.normalizeClassificationSystemFormData(operation.data)
				})),
				costCodes: payload.costCodes.map((operation) => ({
					id: operation.id,
					action: operation.action,
					mappedFields: operation.mappedFields,
					classificationSystemId: operation.classificationSystemId,
					data: this.normalizeCostCodeFormData(operation.data)
				})),
				companyCatalogueLinks: payload.companyCatalogueLinks.map((link) => ({
					scope: link.scope,
					recordId: link.recordId.trim(),
					companyId: link.companyId.trim()
				}))
			};

			await invoke('apply_setup_import_session_command', {
				input: normalizedPayload
			});
		});
	}

	async getLatestSetupImportAudit() {
		if (!isTauri()) return null;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		return (
			(await this.kysely!.selectFrom('setup_import_audit')
				.selectAll()
				.where('workspace_id', '=', workspaceId)
				.orderBy('created_at', 'desc')
				.executeTakeFirst()) ?? null
		);
	}

	async reorderProjects(orderedIds: string[]): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await this.validateOrderedIds('projects', workspaceId, orderedIds);
				await Promise.all(
					orderedIds.map((id, index) =>
						this.kysely!.updateTable('projects')
							.set({ sort_order: index })
							.where('id', '=', id)
							.where('workspace_id', '=', workspaceId)
							.execute()
					)
				);
			} catch (err) {
				log.error(`Failed to reorder projects: ${err}`);
				throw err;
			}
		});
	}

	async reorderContacts(orderedIds: string[]): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await this.validateOrderedIds('contacts', workspaceId, orderedIds);
				await Promise.all(
					orderedIds.map((id, index) =>
						this.kysely!.updateTable('contacts')
							.set({ sort_order: index })
							.where('id', '=', id)
							.where('workspace_id', '=', workspaceId)
							.execute()
					)
				);
			} catch (err) {
				log.error(`Failed to reorder contacts: ${err}`);
				throw err;
			}
		});
	}

	async addMaterialCatalogueItem(id: string, data: MaterialCatalogItemFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeMaterialCatalogueItemFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueMaterialCatalogueItem(null, workspaceId, normalizedData);
				await this.kysely!.insertInto('material_catalog_items')
					.values({
						id,
						workspace_id: workspaceId,
						code: normalizedData.code || null,
						name: normalizedData.name,
						category: normalizedData.category || null,
						specification: normalizedData.specification || null,
						unit: normalizedData.unit,
						default_rate: normalizedData.default_rate,
						currency_code: normalizedData.currency_code,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						metadata_json: stringifyJson({}),
						effective_date: normalizedData.effective_date || null,
						verified_date: normalizedData.verified_date || null,
						rate_basis: normalizedData.rate_basis ?? 'cost',
						lead_time: normalizedData.lead_time ?? '',
						availability: normalizedData.availability ?? '',
						reference: normalizedData.reference ?? '',
						is_active: normalizedData.is_active ? 1 : 0
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add material catalogue item: ${err}`);
				throw err;
			}
		});
	}

	async updateMaterialCatalogueItem(
		id: string,
		data: MaterialCatalogItemFormValues
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeMaterialCatalogueItemFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueMaterialCatalogueItem(id, workspaceId, normalizedData);
				await this.kysely!.updateTable('material_catalog_items')
					.set({
						code: normalizedData.code || null,
						name: normalizedData.name,
						category: normalizedData.category || null,
						specification: normalizedData.specification || null,
						unit: normalizedData.unit,
						default_rate: normalizedData.default_rate,
						currency_code: normalizedData.currency_code,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						effective_date: normalizedData.effective_date || null,
						verified_date: normalizedData.verified_date || null,
						rate_basis: normalizedData.rate_basis ?? 'cost',
						lead_time: normalizedData.lead_time ?? '',
						availability: normalizedData.availability ?? '',
						reference: normalizedData.reference ?? '',
						is_active: normalizedData.is_active ? 1 : 0,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update material catalogue item: ${err}`);
				throw err;
			}
		});
	}

	async deleteMaterialCatalogueItem(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_catalogue_items_command', {
					input: {
						scope: 'materials',
						ids: [id]
					}
				});
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to delete material catalogue item: ${err}`, {
					dbName: this.dbName,
					schemaProfile: this.runtimeSchemaProfile(),
					workspaceId
				});
				throw err;
			}
		});
	}

	async bulkDeleteMaterialCatalogueItems(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_catalogue_items_command', {
					input: {
						scope: 'materials',
						ids
					}
				});
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to bulk delete material catalogue items: ${err}`, {
					dbName: this.dbName,
					schemaProfile: this.runtimeSchemaProfile(),
					workspaceId
				});
				throw err;
			}
		});
	}

	async replaceCatalogueRecordCompanyLinks(
		scope: CatalogueRecordCompanyLinksResult['scope'],
		recordId: string,
		companyIds: string[]
	): Promise<CatalogueRecordCompanyLinksResult> {
		if (!isTauri()) {
			return { scope, recordId, companies: [] };
		}
		await this.init();
		return invoke<CatalogueRecordCompanyLinksResult>(
			'replace_catalogue_record_company_links_command',
			{
				input: {
					scope,
					recordId,
					companyIds
				}
			}
		);
	}

	async replaceCompanyCatalogueLinks(input: {
		companyId: string;
		materialIds: string[];
		labourRateIds: string[];
		equipmentRateIds: string[];
		subcontractRateIds: string[];
	}): Promise<CompanyCatalogueLinksResult> {
		if (!isTauri()) {
			return {
				companyId: input.companyId,
				materials: [],
				labourRates: [],
				equipmentRates: [],
				subcontractRates: []
			};
		}
		await this.init();
		return invoke<CompanyCatalogueLinksResult>('replace_company_catalogue_links_command', {
			input
		});
	}

	async addLabourRateCard(id: string, data: LabourRateCardFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeLabourRateCardFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueLabourRateCard(null, workspaceId, normalizedData);
				await this.kysely!.insertInto('labour_rate_cards')
					.values({
						id,
						workspace_id: workspaceId,
						code: normalizedData.code || null,
						name: normalizedData.name,
						category: normalizedData.category || null,
						work_center: normalizedData.work_center || null,
						unit: normalizedData.unit,
						default_rate: normalizedData.default_rate,
						currency_code: normalizedData.currency_code,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						metadata_json: stringifyJson({}),
						effective_date: normalizedData.effective_date || null,
						verified_date: normalizedData.verified_date || null,
						rate_basis: normalizedData.rate_basis ?? 'cost',
						lead_time: normalizedData.lead_time ?? '',
						availability: normalizedData.availability ?? '',
						reference: normalizedData.reference ?? '',
						is_active: normalizedData.is_active ? 1 : 0
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add labour rate card: ${err}`);
				throw err;
			}
		});
	}

	async updateLabourRateCard(id: string, data: LabourRateCardFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeLabourRateCardFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueLabourRateCard(id, workspaceId, normalizedData);
				await this.kysely!.updateTable('labour_rate_cards')
					.set({
						code: normalizedData.code || null,
						name: normalizedData.name,
						category: normalizedData.category || null,
						work_center: normalizedData.work_center || null,
						unit: normalizedData.unit,
						default_rate: normalizedData.default_rate,
						currency_code: normalizedData.currency_code,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						effective_date: normalizedData.effective_date || null,
						verified_date: normalizedData.verified_date || null,
						rate_basis: normalizedData.rate_basis ?? 'cost',
						lead_time: normalizedData.lead_time ?? '',
						availability: normalizedData.availability ?? '',
						reference: normalizedData.reference ?? '',
						is_active: normalizedData.is_active ? 1 : 0,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update labour rate card: ${err}`);
				throw err;
			}
		});
	}

	async deleteLabourRateCard(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_catalogue_items_command', {
					input: {
						scope: 'labour_rates',
						ids: [id]
					}
				});
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to delete labour rate card: ${err}`);
				throw err;
			}
		});
	}

	async bulkDeleteLabourRateCards(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_catalogue_items_command', {
					input: {
						scope: 'labour_rates',
						ids
					}
				});
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to bulk delete labour rate cards: ${err}`);
				throw err;
			}
		});
	}

	async addEquipmentRateCard(id: string, data: EquipmentRateCardFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeEquipmentRateCardFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueEquipmentRateCard(null, workspaceId, normalizedData);
				await this.kysely!.insertInto('equipment_rate_cards')
					.values({
						id,
						workspace_id: workspaceId,
						code: normalizedData.code || null,
						name: normalizedData.name,
						category: normalizedData.category || null,
						work_center: normalizedData.work_center || null,
						unit: normalizedData.unit,
						default_rate: normalizedData.default_rate,
						currency_code: normalizedData.currency_code,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						metadata_json: stringifyJson({}),
						effective_date: normalizedData.effective_date || null,
						verified_date: normalizedData.verified_date || null,
						rate_basis: normalizedData.rate_basis ?? 'cost',
						lead_time: normalizedData.lead_time ?? '',
						availability: normalizedData.availability ?? '',
						reference: normalizedData.reference ?? '',
						is_active: normalizedData.is_active ? 1 : 0
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add equipment rate card: ${err}`);
				throw err;
			}
		});
	}

	async updateEquipmentRateCard(id: string, data: EquipmentRateCardFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeEquipmentRateCardFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueEquipmentRateCard(id, workspaceId, normalizedData);
				await this.kysely!.updateTable('equipment_rate_cards')
					.set({
						code: normalizedData.code || null,
						name: normalizedData.name,
						category: normalizedData.category || null,
						work_center: normalizedData.work_center || null,
						unit: normalizedData.unit,
						default_rate: normalizedData.default_rate,
						currency_code: normalizedData.currency_code,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						effective_date: normalizedData.effective_date || null,
						verified_date: normalizedData.verified_date || null,
						rate_basis: normalizedData.rate_basis ?? 'cost',
						lead_time: normalizedData.lead_time ?? '',
						availability: normalizedData.availability ?? '',
						reference: normalizedData.reference ?? '',
						is_active: normalizedData.is_active ? 1 : 0,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update equipment rate card: ${err}`);
				throw err;
			}
		});
	}

	async deleteEquipmentRateCard(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_catalogue_items_command', {
					input: {
						scope: 'equipment_rates',
						ids: [id]
					}
				});
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to delete equipment rate card: ${err}`);
				throw err;
			}
		});
	}

	async bulkDeleteEquipmentRateCards(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_catalogue_items_command', {
					input: {
						scope: 'equipment_rates',
						ids
					}
				});
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to bulk delete equipment rate cards: ${err}`);
				throw err;
			}
		});
	}

	async addSubcontractRateCard(id: string, data: SubcontractRateCardFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeSubcontractRateCardFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueSubcontractRateCard(null, workspaceId, normalizedData);
				await this.kysely!.insertInto('subcontract_rate_cards')
					.values({
						id,
						workspace_id: workspaceId,
						code: normalizedData.code || null,
						name: normalizedData.name,
						category: normalizedData.category || null,
						unit: normalizedData.unit,
						default_rate: normalizedData.default_rate,
						currency_code: normalizedData.currency_code,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						metadata_json: stringifyJson({}),
						effective_date: normalizedData.effective_date || null,
						verified_date: normalizedData.verified_date || null,
						rate_basis: normalizedData.rate_basis ?? 'cost',
						lead_time: normalizedData.lead_time ?? '',
						availability: normalizedData.availability ?? '',
						reference: normalizedData.reference ?? '',
						is_active: normalizedData.is_active ? 1 : 0
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add subcontract rate card: ${err}`);
				throw err;
			}
		});
	}

	async updateSubcontractRateCard(id: string, data: SubcontractRateCardFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeSubcontractRateCardFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueSubcontractRateCard(id, workspaceId, normalizedData);
				await this.kysely!.updateTable('subcontract_rate_cards')
					.set({
						code: normalizedData.code || null,
						name: normalizedData.name,
						category: normalizedData.category || null,
						unit: normalizedData.unit,
						default_rate: normalizedData.default_rate,
						currency_code: normalizedData.currency_code,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						effective_date: normalizedData.effective_date || null,
						verified_date: normalizedData.verified_date || null,
						rate_basis: normalizedData.rate_basis ?? 'cost',
						lead_time: normalizedData.lead_time ?? '',
						availability: normalizedData.availability ?? '',
						reference: normalizedData.reference ?? '',
						is_active: normalizedData.is_active ? 1 : 0,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update subcontract rate card: ${err}`);
				throw err;
			}
		});
	}

	async deleteSubcontractRateCard(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_catalogue_items_command', {
					input: {
						scope: 'subcontract_rates',
						ids: [id]
					}
				});
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to delete subcontract rate card: ${err}`);
				throw err;
			}
		});
	}

	async bulkDeleteSubcontractRateCards(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await invoke('delete_catalogue_items_command', {
					input: {
						scope: 'subcontract_rates',
						ids
					}
				});
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to bulk delete subcontract rate cards: ${err}`);
				throw err;
			}
		});
	}

	async addCostComponentPreset(
		id: string,
		data: CostComponentPresetFormValues,
		components: CostComponentPreset['components']
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeCostComponentPresetFormData(data);
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		const sanitisedComponents = this.sanitiseCostComponentPresetComponents(components, references);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueCostComponentPreset(null, workspaceId, normalizedData);
				await this.kysely!.insertInto('cost_component_presets')
					.values({
						id,
						workspace_id: workspaceId,
						code: normalizedData.code || null,
						name: normalizedData.name,
						description: normalizedData.description || '',
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						components_json: JSON.stringify(sanitisedComponents),
						is_active: normalizedData.is_active ? 1 : 0
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add cost component preset: ${err}`);
				throw err;
			}
		});
	}

	async updateCostComponentPreset(
		id: string,
		data: CostComponentPresetFormValues,
		components: CostComponentPreset['components']
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeCostComponentPresetFormData(data);
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		const sanitisedComponents = this.sanitiseCostComponentPresetComponents(components, references);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueCostComponentPreset(id, workspaceId, normalizedData);
				await this.kysely!.updateTable('cost_component_presets')
					.set({
						code: normalizedData.code || null,
						name: normalizedData.name,
						description: normalizedData.description || '',
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						components_json: JSON.stringify(sanitisedComponents),
						is_active: normalizedData.is_active ? 1 : 0,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update cost component preset: ${err}`);
				throw err;
			}
		});
	}

	async deleteCostComponentPreset(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.clearLinkedPresetReferences(id);
				await this.kysely!.deleteFrom('cost_component_presets').where('id', '=', id).execute();
			} catch (err) {
				log.error(`Failed to delete cost component preset: ${err}`);
				throw err;
			}
		});
	}

	async bulkDeleteCostComponentPresets(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('takeoff_items')
					.set({
						applied_preset_id: null,
						applied_preset_name: null,
						updated_at: new Date().toISOString()
					})
					.where('applied_preset_id', 'in', ids)
					.execute();

				await this.kysely!.deleteFrom('cost_component_presets').where('id', 'in', ids).execute();
			} catch (err) {
				log.error(`Failed to bulk delete cost component presets: ${err}`);
				throw err;
			}
		});
	}

	async addEstimateTemplate(
		id: string,
		data: EstimateTemplateFormValues,
		estimate: EstimateTemplate['estimate']
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeEstimateTemplateFormData(data);
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		const sanitisedEstimate = this.sanitiseEstimateTemplatePayload(estimate, references);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueEstimateTemplate(null, workspaceId, normalizedData);
				await this.kysely!.insertInto('estimate_templates')
					.values({
						id,
						workspace_id: workspaceId,
						code: normalizedData.code || null,
						name: normalizedData.name,
						description: normalizedData.description || '',
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						estimate_json: JSON.stringify(sanitisedEstimate),
						is_active: normalizedData.is_active ? 1 : 0
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add estimate template: ${err}`);
				throw err;
			}
		});
	}

	async updateEstimateTemplate(
		id: string,
		data: EstimateTemplateFormValues,
		estimate: EstimateTemplate['estimate']
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeEstimateTemplateFormData(data);
		const references = await this.buildEstimateReferenceIndex(workspaceId);
		const sanitisedEstimate = this.sanitiseEstimateTemplatePayload(estimate, references);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueEstimateTemplate(id, workspaceId, normalizedData);
				await this.kysely!.updateTable('estimate_templates')
					.set({
						code: normalizedData.code || null,
						name: normalizedData.name,
						description: normalizedData.description || '',
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						estimate_json: JSON.stringify(sanitisedEstimate),
						is_active: normalizedData.is_active ? 1 : 0,
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update estimate template: ${err}`);
				throw err;
			}
		});
	}

	async deleteEstimateTemplate(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.clearLinkedTemplateReferences(id);
				await this.kysely!.deleteFrom('estimate_templates').where('id', '=', id).execute();
			} catch (err) {
				log.error(`Failed to delete estimate template: ${err}`);
				throw err;
			}
		});
	}

	async bulkDeleteEstimateTemplates(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('estimates')
					.set({
						applied_template_id: null,
						applied_template_name: null,
						updated_at: new Date().toISOString()
					})
					.where('applied_template_id', 'in', ids)
					.execute();

				await this.kysely!.deleteFrom('estimate_templates').where('id', 'in', ids).execute();
			} catch (err) {
				log.error(`Failed to bulk delete estimate templates: ${err}`);
				throw err;
			}
		});
	}

	async addQuoteOptionPreset(id: string, data: QuoteOptionPresetFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeQuoteOptionPresetFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueQuoteOptionPreset(null, workspaceId, normalizedData);
				await this.kysely!.insertInto('quote_option_presets')
					.values({
						id,
						workspace_id: workspaceId,
						label: normalizedData.label,
						lead_time: normalizedData.lead_time,
						markup_percentage: normalizedData.markup_percentage,
						material_markup_percentage: normalizedData.material_markup_percentage,
						labour_markup_percentage: normalizedData.labour_markup_percentage,
						equipment_markup_percentage: normalizedData.equipment_markup_percentage,
						subcontract_markup_percentage: normalizedData.subcontract_markup_percentage,
						notes: normalizedData.notes ?? ''
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add quote option preset: ${err}`);
				throw err;
			}
		});
	}

	async updateQuoteOptionPreset(id: string, data: QuoteOptionPresetFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeQuoteOptionPresetFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueQuoteOptionPreset(id, workspaceId, normalizedData);
				await this.kysely!.updateTable('quote_option_presets')
					.set({
						label: normalizedData.label,
						lead_time: normalizedData.lead_time,
						markup_percentage: normalizedData.markup_percentage,
						material_markup_percentage: normalizedData.material_markup_percentage,
						labour_markup_percentage: normalizedData.labour_markup_percentage,
						equipment_markup_percentage: normalizedData.equipment_markup_percentage,
						subcontract_markup_percentage: normalizedData.subcontract_markup_percentage,
						notes: normalizedData.notes ?? '',
						updated_at: new Date().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update quote option preset: ${err}`);
				throw err;
			}
		});
	}

	async deleteQuoteOptionPreset(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.deleteFrom('quote_option_presets').where('id', '=', id).execute();
			} catch (err) {
				log.error(`Failed to delete quote option preset: ${err}`);
				throw err;
			}
		});
	}

	async addProjectStructureTemplate(
		id: string,
		data: ProjectStructureTemplateFormValues,
		nodes: ProjectStructureTemplate['nodes']
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeProjectStructureTemplateFormData(data);
		const normalizedNodes = this.validateProjectStructureTemplateNodes(nodes);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueProjectStructureTemplate(null, workspaceId, normalizedData);
				await invoke('add_project_structure_template_command', {
					input: {
						id,
						workspaceId,
						code: normalizedData.code || null,
						name: normalizedData.name,
						description: normalizedData.description || '',
						isActive: normalizedData.is_active,
						updatedAt: new Date().toISOString(),
						nodes: this.orderProjectStructureNodesForInsert(normalizedNodes)
					}
				});
			} catch (err) {
				log.error(`Failed to add project structure template: ${err}`);
				throw err;
			}
		});
	}

	async updateProjectStructureTemplate(
		id: string,
		data: ProjectStructureTemplateFormValues,
		nodes: ProjectStructureTemplate['nodes']
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeProjectStructureTemplateFormData(data);
		const normalizedNodes = this.validateProjectStructureTemplateNodes(nodes);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueProjectStructureTemplate(id, workspaceId, normalizedData);
				await invoke('update_project_structure_template_command', {
					input: {
						id,
						workspaceId,
						code: normalizedData.code || null,
						name: normalizedData.name,
						description: normalizedData.description || '',
						isActive: normalizedData.is_active,
						updatedAt: new Date().toISOString(),
						nodes: this.orderProjectStructureNodesForInsert(normalizedNodes)
					}
				});
			} catch (err) {
				log.error(`Failed to update project structure template: ${err}`);
				throw err;
			}
		});
	}

	async deleteProjectStructureTemplate(id: string): Promise<void> {
		return this.bulkDeleteProjectStructureTemplates([id]);
	}

	async bulkDeleteProjectStructureTemplates(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				const deleteResult = await this.kysely!.deleteFrom('project_structure_templates')
					.where('id', 'in', ids)
					.where('workspace_id', '=', workspaceId)
					.executeTakeFirst();
				if (Number(deleteResult.numDeletedRows ?? 0) === 0) {
					throw new Error('Selected project structure template could not be found');
				}
			} catch (err) {
				log.error(`Failed to bulk delete project structure templates: ${err}`);
				throw err;
			}
		});
	}

	async applyProjectStructureTemplateToProject(
		templateId: string,
		projectId: string
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				const template = await this.getProjectStructureTemplateById(templateId);
				if (!template) {
					throw new Error('Selected project structure template could not be found');
				}
				const existingCount = await this.kysely!.selectFrom('wbs_nodes')
					.select(({ fn }) => fn.count<number>('id').as('count'))
					.where('project_id', '=', projectId)
					.executeTakeFirst();
				if (Number(existingCount?.count ?? 0) > 0) {
					throw new Error('Project structure templates can only be applied to empty projects');
				}

				await invoke('apply_project_structure_template_to_project_command', {
					input: {
						projectId,
						nodes: this.orderProjectStructureNodesForInsert(template.nodes)
					}
				});
			} catch (err) {
				log.error(`Failed to apply project structure template: ${err}`);
				throw err;
			}
		});
	}

	async addClassificationSystem(id: string, data: ClassificationSystemFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeClassificationSystemFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueClassificationSystem(null, workspaceId, normalizedData);
				if (normalizedData.is_default) {
					await this.kysely!.updateTable('classification_systems')
						.set({ is_default: 0 })
						.where('workspace_id', '=', workspaceId)
						.execute();
				}
				await this.kysely!.insertInto('classification_systems')
					.values({
						id,
						workspace_id: workspaceId,
						name: normalizedData.name,
						code: normalizedData.code || '',
						classification_type: normalizedData.classification_type,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						is_default: normalizedData.is_default ? 1 : 0
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add classification system: ${err}`);
				throw err;
			}
		});
	}

	async updateClassificationSystem(
		id: string,
		data: ClassificationSystemFormValues
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		const normalizedData = this.normalizeClassificationSystemFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueClassificationSystem(id, workspaceId, normalizedData);
				if (normalizedData.is_default) {
					await this.kysely!.updateTable('classification_systems')
						.set({ is_default: 0 })
						.where('workspace_id', '=', workspaceId)
						.where('id', '!=', id)
						.execute();
				}
				await this.kysely!.updateTable('classification_systems')
					.set({
						name: normalizedData.name,
						code: normalizedData.code || '',
						classification_type: normalizedData.classification_type,
						aliases_json: stringifyJsonArray(normalizedData.aliases),
						is_default: normalizedData.is_default ? 1 : 0
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update classification system: ${err}`);
				throw err;
			}
		});
	}

	async deleteClassificationSystem(id: string): Promise<void> {
		return this.bulkDeleteClassificationSystems([id]);
	}

	async bulkDeleteClassificationSystems(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				const costCodeIds = await this.kysely!.selectFrom('cost_codes')
					.select('id')
					.where('classification_system_id', 'in', ids)
					.execute();
				await this.clearLinkedCostCodeReferences(costCodeIds.map((row) => row.id));
				await this.kysely!.updateTable('estimates')
					.set({
						classification_system_id: null,
						updated_at: new Date().toISOString()
					})
					.where('classification_system_id', 'in', ids)
					.execute();
				await this.kysely!.deleteFrom('classification_systems').where('id', 'in', ids).execute();
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to bulk delete classification systems: ${err}`);
				throw err;
			}
		});
	}

	async unsetCurrentDefaultClassificationSystem(): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('classification_systems')
					.set({ is_default: 0 })
					.where('is_default', '=', 1)
					.execute();
			} catch (err) {
				log.error(`Failed to unset default classification system: ${err}`);
				throw err;
			}
		});
	}

	async validateCostCodeClassificationSystem(classificationSystemId: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const system = await this.kysely!.selectFrom('classification_systems')
			.select('id')
			.where('id', '=', classificationSystemId)
			.executeTakeFirst();
		if (!system) {
			throw new Error(
				`Classification system ${classificationSystemId} does not exist in this workspace.`
			);
		}
	}

	async validateCostCodeParentBelongsToSystem(
		parentId: string,
		classificationSystemId: string
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const parent = await this.kysely!.selectFrom('cost_codes')
			.select('classification_system_id')
			.where('id', '=', parentId)
			.executeTakeFirst();
		if (!parent) {
			throw new Error(`Parent cost code ${parentId} does not exist.`);
		}
		if (parent.classification_system_id !== classificationSystemId) {
			throw new Error(
				`Parent cost code ${parentId} belongs to system ${parent.classification_system_id}, not ${classificationSystemId}.`
			);
		}
	}

	// M5: FK validation — verify a contact record exists by ID in this workspace
	async validateContactExists(contactId: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const contact = await this.kysely!.selectFrom('contacts')
			.select('id')
			.where('id', '=', contactId)
			.executeTakeFirst();
		if (!contact) {
			throw new Error(`Contact ${contactId} does not exist in this workspace.`);
		}
	}

	async addCostCode(
		id: string,
		classificationSystemId: string,
		data: CostCodeFormValues
	): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const normalizedData = this.normalizeCostCodeFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.ensureUniqueCostCode(null, classificationSystemId, normalizedData);
				await this.validateCostCodeParent(
					null,
					classificationSystemId,
					normalizedData.parent_id ?? null
				);
				await this.kysely!.insertInto('cost_codes')
					.values({
						id,
						classification_system_id: classificationSystemId,
						parent_id: normalizedData.parent_id || null,
						code: normalizedData.code,
						name: normalizedData.name,
						description: normalizedData.description || '',
						is_active: normalizedData.is_active ? 1 : 0,
						sort_order: normalizedData.sort_order
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add cost code: ${err}`);
				throw err;
			}
		});
	}

	async updateCostCode(id: string, data: CostCodeFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const normalizedData = this.normalizeCostCodeFormData(data);
		await this.withWriteLock(async () => {
			try {
				const existing = await this.kysely!.selectFrom('cost_codes')
					.select('classification_system_id')
					.where('id', '=', id)
					.executeTakeFirst();
				if (!existing) {
					throw new Error('Selected cost code could not be found');
				}
				await this.ensureUniqueCostCode(id, existing.classification_system_id, normalizedData);
				await this.validateCostCodeParent(
					id,
					existing.classification_system_id,
					normalizedData.parent_id ?? null
				);
				await this.kysely!.updateTable('cost_codes')
					.set({
						parent_id: normalizedData.parent_id || null,
						code: normalizedData.code,
						name: normalizedData.name,
						description: normalizedData.description || '',
						is_active: normalizedData.is_active ? 1 : 0,
						sort_order: normalizedData.sort_order
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update cost code: ${err}`);
				throw err;
			}
		});
	}

	async deleteCostCode(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				await this.clearLinkedCostCodeReferences(await this.collectCostCodeSubtreeIds(id));
				await this.kysely!.deleteFrom('cost_codes').where('id', '=', id).execute();
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to delete cost code: ${err}`);
				throw err;
			}
		});
	}

	async bulkDeleteCostCodes(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		const workspaceId = await this.getWorkspaceIdForWrite();
		await this.withWriteLock(async () => {
			try {
				const subtreeIdsArray = await this.collectCostCodeSubtreeIds(ids);
				await this.clearLinkedCostCodeReferences(subtreeIdsArray);
				await this.kysely!.deleteFrom('cost_codes')
					.where('id', 'in', Array.from(new Set([...ids, ...subtreeIdsArray])))
					.execute();
				await this.reconcileReusableEstimatingArtifacts(workspaceId);
			} catch (err) {
				log.error(`Failed to bulk delete cost codes: ${err}`);
				throw err;
			}
		});
	}

	async addWbsNode(id: string, projectId: string, data: WbsNodeFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const normalizedData = this.normalizeWbsNodeFormData(data);
		await this.withWriteLock(async () => {
			try {
				await this.validateWbsParent(null, projectId, normalizedData.parent_id ?? null);
				await this.kysely!.insertInto('wbs_nodes')
					.values({
						id,
						project_id: projectId,
						parent_id: normalizedData.parent_id || null,
						code: normalizedData.code || null,
						name: normalizedData.name,
						type: normalizedData.type,
						sort_order: normalizedData.sort_order
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add WBS node: ${err}`);
				throw err;
			}
		});
	}

	async updateWbsNode(id: string, data: WbsNodeFormValues): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		const normalizedData = this.normalizeWbsNodeFormData(data);
		await this.withWriteLock(async () => {
			try {
				const existing = await this.kysely!.selectFrom('wbs_nodes')
					.select('project_id')
					.where('id', '=', id)
					.executeTakeFirst();
				if (!existing) {
					throw new Error('Selected WBS node could not be found');
				}
				await this.validateWbsParent(id, existing.project_id, normalizedData.parent_id ?? null);
				await this.kysely!.updateTable('wbs_nodes')
					.set({
						parent_id: normalizedData.parent_id || null,
						code: normalizedData.code || null,
						name: normalizedData.name,
						type: normalizedData.type,
						sort_order: normalizedData.sort_order
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update WBS node: ${err}`);
				throw err;
			}
		});
	}

	async addProjectStructureTemplateNode(
		id: string,
		templateId: string,
		data: Record<string, unknown>
	): Promise<string> {
		if (!isTauri()) return id;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.insertInto('project_structure_template_nodes')
					.values({
						id,
						template_id: templateId,
						parent_id: (data.parent_id as string) || null,
						code: (data.code as string) || null,
						name: data.name as string,
						type: data.type as string,
						sort_order: (data.sort_order as number) ?? 0
					})
					.execute();
			} catch (err) {
				log.error(`Failed to add template node: ${err}`);
				throw err;
			}
		});
		return id;
	}

	async updateProjectStructureTemplateNode(
		id: string,
		data: Record<string, unknown>
	): Promise<string> {
		if (!isTauri()) return id;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.updateTable('project_structure_template_nodes')
					.set({
						parent_id: (data.parent_id as string) || null,
						code: (data.code as string) || null,
						name: data.name as string,
						type: data.type as string,
						sort_order: (data.sort_order as number) ?? 0
					})
					.where('id', '=', id)
					.execute();
			} catch (err) {
				log.error(`Failed to update template node: ${err}`);
				throw err;
			}
		});
		return id;
	}

	async deleteWbsNode(id: string): Promise<void> {
		if (!isTauri()) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.deleteFrom('wbs_nodes').where('id', '=', id).execute();
			} catch (err) {
				log.error(`Failed to delete WBS node: ${err}`);
				throw err;
			}
		});
	}

	async bulkDeleteWbsNodes(ids: string[]): Promise<void> {
		if (!isTauri() || ids.length === 0) return;
		await this.init();
		await this.withWriteLock(async () => {
			try {
				await this.kysely!.deleteFrom('wbs_nodes').where('id', 'in', ids).execute();
			} catch (err) {
				log.error(`Failed to bulk delete WBS nodes: ${err}`);
				throw err;
			}
		});
	}

	async searchWorkspaceHistory(query: string, limit: number = 30): Promise<SearchResultRow[]> {
		return this.searchWorkspaceRecords({ query, limit });
	}

	async searchWorkspaceRecords(input: {
		query: string;
		browse?: boolean;
		limit?: number;
		scope?: string | null;
		includeInactive?: boolean;
		workspaceId?: string;
		projectId?: string;
	}): Promise<SearchResultRow[]> {
		if (!isTauri()) return [];
		await this.init();
		try {
			const workspaceId = input.workspaceId ?? (await this.getWorkspaceIdForWrite());
			const sanitizedQuery = input.query
				.replace(/[^\p{L}\p{N}_\s]+/gu, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			const results = await invoke<SearchResultRow[]>('search_workspace_history_command', {
				input: { ...input, query: sanitizedQuery, workspaceId }
			});
			return results;
		} catch (err) {
			log.error(`Failed to search workspace history: ${err}`);
			throw err;
		}
	}

	async describeWorkspaceRecords(scope?: string): Promise<
		Array<{
			scope: string;
			label: string;
			description: string;
			searchableFields: string[];
			detailFields: Array<{ name: string; kind: string }>;
			supportedFilters: string[];
		}>
	> {
		if (!isTauri()) return [];
		await this.init();
		return invoke('describe_workspace_records_command', { scope });
	}

	async searchAssistantRecords(input: {
		scope?: string;
		query: string;
		browse?: boolean;
		limit: number;
		projectId?: string;
		includeInactive: boolean;
		workspaceId?: string;
	}): Promise<
		Array<{
			scope: string;
			id: string;
			label: string;
			subtitle: string | null;
			relevance: number;
			fields: Record<string, string | number | boolean | null>;
		}>
	> {
		if (!isTauri()) return [];
		if (input.workspaceId) {
			const activeWorkspaceId = await this.getWorkspaceIdForWrite();
			if (input.workspaceId !== activeWorkspaceId) {
				throw new Error('Assistant workspace changed before record search completed.');
			}
		}
		const rows = await this.searchWorkspaceRecords(input);
		return rows.map((row) => ({
			scope: row.scope ?? input.scope ?? 'unknown',
			id: row.recordId,
			label: row.title,
			subtitle: row.subtitle,
			relevance: row.rank,
			fields: row.fields ?? {}
		}));
	}

	async getWorkspaceRecord(input: {
		scope: string;
		recordId: string;
		projectId?: string;
		workspaceId?: string;
	}): Promise<{
		scope: string;
		recordId: string;
		label: string;
		subtitle: string | null;
		fields: Record<string, unknown>;
	} | null> {
		if (!isTauri()) return null;
		await this.init();
		const activeWorkspaceId = await this.getWorkspaceIdForWrite();
		if (input.workspaceId && input.workspaceId !== activeWorkspaceId) {
			throw new Error('Assistant workspace changed before record retrieval completed.');
		}
		return invoke('get_workspace_record_command', {
			input: { ...input, workspaceId: activeWorkspaceId }
		});
	}

	async findPotentialDuplicateRecords(input: {
		scope: string;
		query: string;
		limit?: number;
		includeInactive?: boolean;
	}): Promise<SearchResultRow[]> {
		const trimmedQuery = input.query.trim();
		if (!trimmedQuery) return [];
		return this.searchWorkspaceRecords({
			scope: input.scope,
			query: trimmedQuery,
			limit: input.limit ?? 5,
			includeInactive: input.includeInactive ?? true
		});
	}

	async getWorkspaceStats(): Promise<{
		projectsCount: number;
		contactsCount: number;
		materialsCount: number;
		ratesCount: number;
	}> {
		if (!isTauri()) {
			return { projectsCount: 0, contactsCount: 0, materialsCount: 0, ratesCount: 0 };
		}
		await this.init();

		try {
			const [projectsRes, contactsRes, materialsRes, labourRes, equipRes, subconRes] =
				await Promise.all([
					this.kysely!.selectFrom('projects')
						.select((eb) => eb.fn.countAll().as('count'))
						.executeTakeFirst(),
					this.kysely!.selectFrom('contacts')
						.select((eb) => eb.fn.countAll().as('count'))
						.executeTakeFirst(),
					this.kysely!.selectFrom('material_catalog_items')
						.select((eb) => eb.fn.countAll().as('count'))
						.executeTakeFirst(),
					this.kysely!.selectFrom('labour_rate_cards')
						.select((eb) => eb.fn.countAll().as('count'))
						.executeTakeFirst(),
					this.kysely!.selectFrom('equipment_rate_cards')
						.select((eb) => eb.fn.countAll().as('count'))
						.executeTakeFirst(),
					this.kysely!.selectFrom('subcontract_rate_cards')
						.select((eb) => eb.fn.countAll().as('count'))
						.executeTakeFirst()
				]);

			const projectsCount = Number(projectsRes?.count ?? 0);
			const contactsCount = Number(contactsRes?.count ?? 0);
			const materialsCount = Number(materialsRes?.count ?? 0);
			const ratesCount =
				Number(labourRes?.count ?? 0) +
				Number(equipRes?.count ?? 0) +
				Number(subconRes?.count ?? 0);

			return {
				projectsCount,
				contactsCount,
				materialsCount,
				ratesCount
			};
		} catch (err) {
			log.error(`Failed to fetch workspace stats: ${err}`);
			return { projectsCount: 0, contactsCount: 0, materialsCount: 0, ratesCount: 0 };
		}
	}

	async pruneOldAiRunsAndVacuum(): Promise<void> {
		if (!isTauri() || !this.db || !this.kysely) return;

		await this.withWriteLock(async () => {
			try {
				log.info('Running database maintenance: pruning old AI runs and vacuuming...');

				const thirtyDaysAgo = new Date();
				thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
				const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

				const result = await this.kysely!.deleteFrom('ai_runs')
					.where('status', 'in', ['completed', 'failed', 'cancelled'])
					.where('completed_at', '<', thirtyDaysAgoIso)
					.executeTakeFirst();

				const prunedCount = result.numDeletedRows ? Number(result.numDeletedRows) : 0;
				log.info(`Pruned old AI runs. Runs removed: ${prunedCount}`);

				await this.db!.execute('VACUUM');
				log.info('Database vacuum complete.');
			} catch (e) {
				log.error('Database background maintenance failed', e);
			}
		});
	}
}

export const dbService = new KwantflowDatabase();
