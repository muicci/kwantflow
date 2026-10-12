import { Kysely, sql, type Transaction } from 'kysely';

import { QuoteOptionRowSchema } from '$lib/schemas';
import type { CostComponent, Project, SearchResultRow } from '$lib/types';
import type { DB } from '$lib/types/db';
import { dbService } from '$lib/services/db';
import { normaliseMaterialUnitCode, type SupportedCurrencyCode } from '$lib/constants/index.js';

function stringifyJson(value: Record<string, unknown> | undefined): string {
	return JSON.stringify(value ?? {});
}

function stringifyJsonArray(value: unknown[] | undefined): string {
	return JSON.stringify(value ?? []);
}

function nullableText(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function matchesCountry(
	countryCode: string | null | undefined,
	blockedCountries: string[]
): boolean {
	return blockedCountries.includes(countryCode ?? '');
}

type InternalDbService = {
	kysely: Kysely<DB> | null;
};

class LocalTypedRustCommandShim {
	constructor(private readonly internal: InternalDbService) {}

	private supportsSeparateTaxIdentifier(countryCode: string | null | undefined): boolean {
		return !matchesCountry(countryCode, ['AU', 'NZ']);
	}

	async runTypedCommandLocallyForTests<T>(
		command: string,
		input: Record<string, unknown>
	): Promise<T> {
		// Vitest mirrors typed Rust commands through the local Kysely test DB so the frontend
		// service contract stays aligned without reopening frontend transactions in production.
		if (!this.internal.kysely) {
			// These commands are safe to call without Kysely (Rust-side operations or pure JS)
			if (command === 'generate_uuid') {
				return crypto.randomUUID() as T;
			}
			throw new Error(
				`Local typed command fallback requires an initialised Kysely instance: ${command}`
			);
		}

		return await this.internal.kysely.transaction().execute(async (tx) => {
			switch (command) {
				case 'add_project_command':
					await this.localAddProjectTx(
						tx,
						input as {
							id: string;
							workspaceId: string;
							sortOrder: number;
							rfqNumber: string;
							contactId?: string | null;
							contactNameSnapshot?: string | null;
							requesterContactId?: string | null;
							requesterNameSnapshot?: string | null;
							projectName?: string | null;
							dueDate?: string | null;
							receivedDate?: string | null;
							submissionDeadlineAt?: string | null;
							estimatorName?: string | null;
							customerTenderReference?: string | null;
							addendumLabel?: string | null;
							addendumDate?: string | null;
							addendumNotes?: string | null;
							siteAddress?: string | null;
							deliveryAddress?: string | null;
							sourceChannel?: string | null;
							sourceReference?: string | null;
							priority: string;
							status: string;
							content?: string | null;
							note?: string | null;
							updatedAt: string;
						}
					);
					return undefined as T;
				case 'create_project_workspace_command':
					await this.localCreateProjectWorkspaceTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'update_project_workspace_command':
					await this.localUpdateProjectWorkspaceTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'add_contact_command':
					await this.localPersistContactTx(tx, input as Record<string, unknown>, true);
					return undefined as T;
				case 'update_contact_command':
					await this.localPersistContactTx(tx, input as Record<string, unknown>, false);
					return undefined as T;
				case 'create_asset_from_files_command':
					await this.localCreateAssetFromFilesTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'assign_files_to_asset_command':
					await this.localAssignFilesToAssetTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'add_project_file_command':
					await this.localAddProjectFileTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'delete_file_command':
					return (await this.localDeleteFileTx(tx, input as Record<string, unknown>)) as T;
				case 'delete_catalogue_items_command':
					await this.localDeleteCatalogueItemsTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'merge_assets_command':
					return (await this.localMergeAssetsTx(tx, input as Record<string, unknown>)) as T;
				case 'ungroup_asset_command':
					return (await this.localUngroupAssetTx(tx, input as Record<string, unknown>)) as T;
				case 'remove_file_from_asset_command':
					await this.localRemoveFileFromAssetTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'delete_quote_option_command':
					await this.localDeleteQuoteOptionTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'set_default_quote_option_command':
					await this.localSetDefaultQuoteOptionTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'save_estimate_command':
					await this.localSaveEstimateTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'reset_quote_workspace_command':
					await this.localResetQuoteWorkspaceTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'create_quote_revision_command':
					return (await this.localCreateQuoteRevisionTx(tx, input as Record<string, unknown>)) as T;
				case 'add_project_structure_template_command':
					await this.localPersistProjectStructureTemplateTx(
						tx,
						input as Record<string, unknown>,
						true
					);
					return undefined as T;
				case 'update_project_structure_template_command':
					await this.localPersistProjectStructureTemplateTx(
						tx,
						input as Record<string, unknown>,
						false
					);
					return undefined as T;
				case 'apply_project_structure_template_to_project_command':
					await this.localApplyProjectStructureTemplateTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'duplicate_project_records_command':
					await this.localDuplicateProjectRecordsTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'apply_setup_import_session_command':
					await this.localApplySetupImportSessionTx(tx, input as Record<string, unknown>);
					return undefined as T;
				case 'search_workspace_history_command':
					return (await this.localSearchWorkspaceHistoryTx(
						tx,
						input as { query: string; limit?: number }
					)) as T;
				case 'generate_uuid':
					return crypto.randomUUID() as T;
				default:
					throw new Error(`No local typed command fallback is registered for ${command}`);
			}
		});
	}

	private async localAddProjectTx(
		tx: Transaction<DB>,
		input: {
			id: string;
			workspaceId: string;
			sortOrder: number;
			rfqNumber: string;
			contactId?: string | null;
			contactNameSnapshot?: string | null;
			requesterContactId?: string | null;
			requesterNameSnapshot?: string | null;
			projectName?: string | null;
			dueDate?: string | null;
			receivedDate?: string | null;
			submissionDeadlineAt?: string | null;
			estimatorName?: string | null;
			customerTenderReference?: string | null;
			addendumLabel?: string | null;
			addendumDate?: string | null;
			addendumNotes?: string | null;
			siteAddress?: string | null;
			deliveryAddress?: string | null;
			sourceChannel?: string | null;
			sourceReference?: string | null;
			priority: string;
			status: string;
			content?: string | null;
			note?: string | null;
			updatedAt: string;
		}
	): Promise<void> {
		await tx
			.insertInto('projects')
			.values({
				id: input.id,
				workspace_id: input.workspaceId,
				sort_order: input.sortOrder,
				is_favourite: 0,
				quote_round_prices: 0,
				rfq_number: input.rfqNumber,
				contact_id: input.contactId ?? null,
				contact_name_snapshot: input.contactNameSnapshot ?? null,
				requester_contact_id: input.requesterContactId ?? null,
				requester_name_snapshot: input.requesterNameSnapshot ?? null,
				project_name: input.projectName ?? null,
				due_date: input.dueDate ?? null,
				received_date: input.receivedDate ?? null,
				submission_deadline_at: input.submissionDeadlineAt ?? null,
				estimator_name: input.estimatorName ?? '',
				customer_tender_reference: input.customerTenderReference ?? '',
				addendum_label: input.addendumLabel ?? '',
				addendum_date: input.addendumDate ?? null,
				addendum_notes: input.addendumNotes ?? '',
				site_address: input.siteAddress ?? '',
				delivery_address: input.deliveryAddress ?? '',
				source_channel: input.sourceChannel ?? 'manual',
				source_reference: input.sourceReference ?? null,
				priority: String(input.priority),
				status: String(input.status),
				content: input.content ?? null,
				note: input.note ?? null,
				updated_at: input.updatedAt
			})
			.execute();

		await tx
			.insertInto('quote_options')
			.values({
				id: crypto.randomUUID(),
				project_id: input.id,
				label: 'Standard',
				lead_time: '2 weeks',
				markup_percentage: 0,
				notes: '',
				sort_order: 0,
				is_default: 1
			})
			.execute();
	}

	private async localInsertProjectFilesTx(
		tx: Transaction<DB>,
		projectId: string,
		files: Array<Record<string, unknown>>
	): Promise<void> {
		for (const file of files) {
			await tx
				.insertInto('files')
				.values({
					id: String(file.id),
					project_id: projectId,
					asset_id: null,
					file_path: String(file.filePath),
					original_name: String(file.originalName),
					mime_type: typeof file.mimeType === 'string' ? file.mimeType : null
				})
				.execute();
		}
	}

	private async localCreateProjectWorkspaceTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const project = input.project as Record<string, unknown>;
		await this.localAddProjectTx(tx, {
			id: String(project.id),
			workspaceId: String(project.workspaceId),
			sortOrder: Number(project.sortOrder),
			rfqNumber: String(project.rfqNumber),
			contactId: typeof project.contactId === 'string' ? project.contactId : null,
			contactNameSnapshot:
				typeof project.contactNameSnapshot === 'string' ? project.contactNameSnapshot : null,
			requesterContactId:
				typeof project.requesterContactId === 'string' ? project.requesterContactId : null,
			requesterNameSnapshot:
				typeof project.requesterNameSnapshot === 'string' ? project.requesterNameSnapshot : null,
			projectName: typeof project.projectName === 'string' ? project.projectName : null,
			dueDate: typeof project.dueDate === 'string' ? project.dueDate : null,
			receivedDate: typeof project.receivedDate === 'string' ? project.receivedDate : null,
			submissionDeadlineAt:
				typeof project.submissionDeadlineAt === 'string' ? project.submissionDeadlineAt : null,
			estimatorName: typeof project.estimatorName === 'string' ? project.estimatorName : '',
			customerTenderReference:
				typeof project.customerTenderReference === 'string' ? project.customerTenderReference : '',
			addendumLabel: typeof project.addendumLabel === 'string' ? project.addendumLabel : '',
			addendumDate: typeof project.addendumDate === 'string' ? project.addendumDate : null,
			addendumNotes: typeof project.addendumNotes === 'string' ? project.addendumNotes : '',
			siteAddress: typeof project.siteAddress === 'string' ? project.siteAddress : '',
			deliveryAddress: typeof project.deliveryAddress === 'string' ? project.deliveryAddress : '',
			sourceChannel: typeof project.sourceChannel === 'string' ? project.sourceChannel : 'manual',
			sourceReference: typeof project.sourceReference === 'string' ? project.sourceReference : null,
			priority: String(project.priority),
			status: String(project.status),
			content: typeof project.content === 'string' ? project.content : null,
			note: typeof project.note === 'string' ? project.note : null,
			updatedAt: String(project.updatedAt)
		});
		await this.localInsertProjectFilesTx(
			tx,
			String(project.id),
			Array.isArray(input.files) ? (input.files as Array<Record<string, unknown>>) : []
		);
	}

	private async localUpdateProjectWorkspaceTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const removedFileIds = Array.isArray(input.removedFileIds)
			? (input.removedFileIds as unknown[]).map((value) => String(value))
			: [];
		const removedAssetIds = Array.isArray(input.removedAssetIds)
			? (input.removedAssetIds as unknown[]).map((value) => String(value))
			: [];
		await tx
			.updateTable('projects')
			.set({
				rfq_number: String(input.rfqNumber),
				contact_id: typeof input.contactId === 'string' ? input.contactId : null,
				contact_name_snapshot:
					typeof input.contactNameSnapshot === 'string' ? input.contactNameSnapshot : null,
				requester_contact_id:
					typeof input.requesterContactId === 'string' ? input.requesterContactId : null,
				requester_name_snapshot:
					typeof input.requesterNameSnapshot === 'string' ? input.requesterNameSnapshot : null,
				project_name: typeof input.projectName === 'string' ? input.projectName : null,
				due_date: typeof input.dueDate === 'string' ? input.dueDate : null,
				received_date: typeof input.receivedDate === 'string' ? input.receivedDate : null,
				submission_deadline_at:
					typeof input.submissionDeadlineAt === 'string' ? input.submissionDeadlineAt : null,
				estimator_name: typeof input.estimatorName === 'string' ? input.estimatorName : '',
				customer_tender_reference:
					typeof input.customerTenderReference === 'string' ? input.customerTenderReference : '',
				addendum_label: typeof input.addendumLabel === 'string' ? input.addendumLabel : '',
				addendum_date: typeof input.addendumDate === 'string' ? input.addendumDate : null,
				addendum_notes: typeof input.addendumNotes === 'string' ? input.addendumNotes : '',
				site_address: typeof input.siteAddress === 'string' ? input.siteAddress : '',
				delivery_address: typeof input.deliveryAddress === 'string' ? input.deliveryAddress : '',
				source_channel: typeof input.sourceChannel === 'string' ? input.sourceChannel : 'manual',
				source_reference: typeof input.sourceReference === 'string' ? input.sourceReference : null,
				priority: String(input.priority) as Project['priority'],
				status: String(input.status) as Project['status'],
				content: typeof input.content === 'string' ? input.content : null,
				note: typeof input.note === 'string' ? input.note : null,
				updated_at: String(input.updatedAt)
			})
			.where('id', '=', String(input.id))
			.execute();

		await this.localInsertProjectFilesTx(
			tx,
			String(input.id),
			Array.isArray(input.newFiles)
				? (input.newFiles as Array<Record<string, unknown>>)
				: Array.isArray(input.files)
					? (input.files as Array<Record<string, unknown>>)
					: []
		);
		if (removedFileIds.length > 0) {
			await tx.deleteFrom('files').where('id', 'in', removedFileIds).execute();
		}
		for (const assetId of removedAssetIds) {
			await this.localSyncAssetThumbnailTx(tx, assetId);
		}
	}

	private async localSyncAssetThumbnailTx(tx: Transaction<DB>, assetId: string): Promise<void> {
		const nextThumbnail = await tx
			.selectFrom('files')
			.select('id')
			.where('asset_id', '=', assetId)
			.orderBy('created_at', 'asc')
			.executeTakeFirst();
		await tx
			.updateTable('assets')
			.set({
				thumbnail_file_id: nextThumbnail?.id ?? null
			})
			.where('id', '=', assetId)
			.execute();
	}

	private async localCreateAssetFromFilesTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const projectId = String(input.projectId);
		const assetId = String(input.assetId);
		const fileIds = Array.isArray(input.fileIds)
			? (input.fileIds as unknown[]).map((value) => String(value))
			: [];
		if (fileIds.length === 0) return;
		const fileRows = await tx
			.selectFrom('files')
			.select(['id', 'asset_id'])
			.where('project_id', '=', projectId)
			.where('id', 'in', fileIds)
			.execute();
		if (fileRows.length !== fileIds.length) {
			throw new Error('One or more files could not be found for this project');
		}
		if (fileRows.some((row) => row.asset_id)) {
			throw new Error('Only review-pool files can be grouped into a new asset');
		}
		await tx
			.insertInto('assets')
			.values({
				id: assetId,
				project_id: projectId,
				display_name: String(input.displayName),
				thumbnail_file_id: null,
				is_selected: 1,
				quote_quantity: 1,
				is_pdf_included: 1
			})
			.execute();
		await tx
			.updateTable('files')
			.set({ asset_id: assetId })
			.where('project_id', '=', projectId)
			.where('id', 'in', fileIds)
			.execute();
		await this.localSyncAssetThumbnailTx(tx, assetId);
	}

	private async localAssignFilesToAssetTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const assetId = String(input.assetId);
		const projectId = String(input.projectId);
		const fileIds = Array.isArray(input.fileIds)
			? (input.fileIds as unknown[]).map((value) => String(value))
			: [];
		if (fileIds.length === 0) return;
		const asset = await tx
			.selectFrom('assets')
			.select('thumbnail_file_id')
			.where('id', '=', assetId)
			.where('project_id', '=', projectId)
			.executeTakeFirst();
		if (!asset) {
			throw new Error('Target asset could not be found for this project');
		}
		const fileRows = await tx
			.selectFrom('files')
			.select(['id', 'asset_id'])
			.where('project_id', '=', projectId)
			.where('id', 'in', fileIds)
			.execute();
		if (fileRows.length !== fileIds.length) {
			throw new Error('One or more files could not be found for this project');
		}
		if (fileRows.some((row) => row.asset_id)) {
			throw new Error('Only review-pool files can be added to an existing asset');
		}
		await tx
			.updateTable('files')
			.set({ asset_id: assetId })
			.where('project_id', '=', projectId)
			.where('id', 'in', fileIds)
			.execute();
		if (!asset.thumbnail_file_id) {
			await this.localSyncAssetThumbnailTx(tx, assetId);
		}
	}

	private async localAddProjectFileTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const assetId =
			typeof input.assetId === 'string' && input.assetId.trim().length > 0
				? input.assetId.trim()
				: null;
		const projectId = String(input.projectId);
		if (assetId) {
			const asset = await tx
				.selectFrom('assets')
				.select('project_id')
				.where('id', '=', assetId)
				.executeTakeFirst();
			if (!asset) {
				throw new Error('Selected asset could not be found');
			}
			if (asset.project_id !== projectId) {
				throw new Error('File asset must belong to the same project');
			}
		}

		await tx
			.insertInto('files')
			.values({
				id: String(input.fileId),
				project_id: projectId,
				asset_id: assetId,
				file_path: String(input.filePath),
				original_name: String(input.originalName),
				mime_type: typeof input.mimeType === 'string' ? input.mimeType : null
			})
			.execute();

		if (assetId) {
			await this.localSyncAssetThumbnailTx(tx, assetId);
		}
	}

	private async localDeleteFileTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<{ filePath: string | null }> {
		const fileId = String(input.fileId);
		const file = await tx
			.selectFrom('files')
			.select(['asset_id', 'file_path'])
			.where('id', '=', fileId)
			.executeTakeFirst();
		if (!file) {
			return { filePath: null };
		}

		await tx.deleteFrom('files').where('id', '=', fileId).execute();
		if (file.asset_id) {
			await this.localSyncAssetThumbnailTx(tx, file.asset_id);
		}
		return { filePath: file.file_path };
	}

	private async localMergeAssetsTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<{ estimatesDiscarded: boolean }> {
		const sourceAssetIds = Array.isArray(input.sourceAssetIds)
			? (input.sourceAssetIds as unknown[]).map((value) => String(value))
			: [];
		if (sourceAssetIds.length === 0) return { estimatesDiscarded: false };
		const estimateCountRow = await tx
			.selectFrom('estimates')
			.select(({ fn }) => fn.count<number>('asset_id').as('count'))
			.where('asset_id', 'in', sourceAssetIds)
			.executeTakeFirst();
		await tx
			.updateTable('files')
			.set({ asset_id: String(input.targetAssetId) })
			.where('asset_id', 'in', sourceAssetIds)
			.execute();
		if (typeof input.newName === 'string' && input.newName.trim().length > 0) {
			await tx
				.updateTable('assets')
				.set({ display_name: input.newName.trim() })
				.where('id', '=', String(input.targetAssetId))
				.execute();
		}
		await this.localSyncAssetThumbnailTx(tx, String(input.targetAssetId));
		await tx.deleteFrom('assets').where('id', 'in', sourceAssetIds).execute();
		return { estimatesDiscarded: Number(estimateCountRow?.count ?? 0) > 0 };
	}

	private async localUngroupAssetTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<{ hadEstimate: boolean }> {
		const assetId = String(input.assetId);
		const estimateCount = await tx
			.selectFrom('estimates')
			.select(({ fn }) => fn.count<number>('asset_id').as('count'))
			.where('asset_id', '=', assetId)
			.executeTakeFirst();
		await tx.updateTable('files').set({ asset_id: null }).where('asset_id', '=', assetId).execute();
		await tx.deleteFrom('assets').where('id', '=', assetId).execute();
		return { hadEstimate: Number(estimateCount?.count ?? 0) > 0 };
	}

	private async localRemoveFileFromAssetTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const fileId = String(input.fileId);
		const file = await tx
			.selectFrom('files')
			.select('asset_id')
			.where('id', '=', fileId)
			.executeTakeFirst();
		if (!file?.asset_id) return;
		const fileCount = await tx
			.selectFrom('files')
			.select(({ fn }) => fn.count<number>('id').as('count'))
			.where('asset_id', '=', file.asset_id)
			.executeTakeFirst();
		if (Number(fileCount?.count ?? 0) <= 1) {
			throw new Error('Use ungroup asset to return the final file to review');
		}
		await tx.updateTable('files').set({ asset_id: null }).where('id', '=', fileId).execute();
		await this.localSyncAssetThumbnailTx(tx, file.asset_id);
	}

	private async localDeleteQuoteOptionTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const optionId = String(input.optionId);
		const target = await tx
			.selectFrom('quote_options')
			.selectAll()
			.where('id', '=', optionId)
			.executeTakeFirst();
		if (!target) return;

		const projectRows = await tx
			.selectFrom('quote_options')
			.selectAll()
			.where('project_id', '=', target.project_id)
			.orderBy('sort_order', 'asc')
			.orderBy('created_at', 'asc')
			.execute();
		if (projectRows.length <= 1) return;

		const remainingRows = projectRows.filter((row) => row.id !== optionId);
		await tx.deleteFrom('quote_options').where('id', '=', optionId).execute();

		const now = new Date().toISOString();
		for (const [index, row] of remainingRows.entries()) {
			const rowIsDefault = row.is_default === 1;
			await tx
				.updateTable('quote_options')
				.set({
					sort_order: index,
					is_default: target.is_default ? (index === 0 ? 1 : 0) : rowIsDefault ? 1 : 0,
					updated_at:
						row.sort_order !== index || (target.is_default && rowIsDefault !== (index === 0))
							? now
							: row.updated_at
				})
				.where('id', '=', row.id)
				.execute();
		}
	}

	private async localSetDefaultQuoteOptionTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const optionId = String(input.optionId);
		const optionRow = QuoteOptionRowSchema.parse(
			await tx.selectFrom('quote_options').selectAll().where('id', '=', optionId).executeTakeFirst()
		);

		await tx
			.updateTable('quote_options')
			.set({ is_default: 0 })
			.where('project_id', '=', optionRow.project_id)
			.where('id', '!=', optionId)
			.execute();

		await tx
			.updateTable('quote_options')
			.set({
				is_default: 1,
				updated_at: new Date().toISOString()
			})
			.where('id', '=', optionId)
			.execute();
	}

	private async localSyncContactRelationshipsTx(
		tx: Transaction<DB>,
		contactId: string,
		workspaceId: string,
		data: Record<string, unknown>
	): Promise<void> {
		const linkedCompanyId =
			typeof data.linked_company_id === 'string' && data.linked_company_id.trim().length > 0
				? data.linked_company_id.trim()
				: null;
		await tx
			.deleteFrom('contact_relationships')
			.where('workspace_id', '=', workspaceId)
			.where('from_contact_id', '=', contactId)
			.where('relationship_type', 'in', ['works_for', 'primary_contact_for'])
			.execute();
		if (!linkedCompanyId) return;

		await tx
			.insertInto('contact_relationships')
			.values({
				id: crypto.randomUUID(),
				workspace_id: workspaceId,
				from_contact_id: contactId,
				to_contact_id: linkedCompanyId,
				relationship_type: 'works_for',
				is_primary: data.is_primary_company_contact ? 1 : 0,
				notes: null
			})
			.execute();

		if (data.is_primary_company_contact) {
			await tx
				.insertInto('contact_relationships')
				.values({
					id: crypto.randomUUID(),
					workspace_id: workspaceId,
					from_contact_id: contactId,
					to_contact_id: linkedCompanyId,
					relationship_type: 'primary_contact_for',
					is_primary: 1,
					notes: null
				})
				.execute();
		}
	}

	private async localPersistContactTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>,
		isCreate: boolean
	): Promise<void> {
		const data = input.data as Record<string, unknown>;
		const values = {
			kind: String(data.kind ?? 'company'),
			display_name: String(data.display_name),
			name: String(data.name),
			company_name: nullableText(data.company_name),
			person_first_name: nullableText(data.person_first_name),
			person_last_name: nullableText(data.person_last_name),
			role_title: nullableText(data.role_title),
			linked_company_id: nullableText(data.linked_company_id),
			is_primary_company_contact: data.is_primary_company_contact ? 1 : 0,
			country_code: String(data.country_code),
			contact_name: nullableText(data.contact_name),
			email: nullableText(data.email),
			website: nullableText(data.website),
			phone: nullableText(data.phone),
			phone_e164: nullableText(data.phone_e164) ?? '',
			phone_country_code: nullableText(data.phone_country_code) ?? String(data.country_code),
			abn: nullableText(data.abn),
			business_id_label: nullableText(data.business_id_label) ?? 'Business ID',
			business_id_value: nullableText(data.business_id_value),
			tax_id_label: nullableText(data.tax_id_label) ?? 'Tax ID',
			tax_id_value: nullableText(data.tax_id_value),
			address: nullableText(data.address),
			notes: nullableText(data.notes),
			logo_file_path: nullableText(data.logo_file_path),
			custom_role_label: nullableText(data.custom_role_label),
			roles_json: stringifyJsonArray(Array.isArray(data.roles) ? data.roles : []),
			tags_json: stringifyJsonArray(Array.isArray(data.tags) ? data.tags : []),
			is_active: data.is_active === false ? 0 : 1
		};
		if (isCreate) {
			await tx
				.insertInto('contacts')
				.values({
					id: String(input.id),
					workspace_id: String(input.workspaceId),
					sort_order: Number(input.sortOrder),
					...values
				})
				.execute();
		} else {
			await tx
				.updateTable('contacts')
				.set({
					...values,
					updated_at: String(input.updatedAt)
				})
				.where('id', '=', String(input.id))
				.execute();
		}

		await this.localSyncContactRelationshipsTx(
			tx,
			String(input.id),
			String(input.workspaceId),
			data
		);
	}

	private async localSaveEstimateTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const estimate = input.estimate as Record<string, unknown>;
		await tx
			.insertInto('estimates')
			.values({
				asset_id: String(input.assetId),
				scope_summary: typeof estimate.scope_summary === 'string' ? estimate.scope_summary : '',
				notes: typeof estimate.notes === 'string' ? estimate.notes : '',
				classification_system_id:
					typeof estimate.classification_system_id === 'string'
						? estimate.classification_system_id
						: null,
				wbs_root_node_id:
					typeof estimate.wbs_root_node_id === 'string' ? estimate.wbs_root_node_id : null,
				applied_template_id:
					typeof estimate.applied_template_id === 'string' ? estimate.applied_template_id : null,
				applied_template_name:
					typeof estimate.applied_template_name === 'string'
						? estimate.applied_template_name
						: null,
				currency_code: typeof estimate.currency_code === 'string' ? estimate.currency_code : null,
				updated_at: String(input.updatedAt)
			})
			.onConflict((oc) =>
				oc.column('asset_id').doUpdateSet({
					scope_summary: typeof estimate.scope_summary === 'string' ? estimate.scope_summary : '',
					notes: typeof estimate.notes === 'string' ? estimate.notes : '',
					classification_system_id:
						typeof estimate.classification_system_id === 'string'
							? estimate.classification_system_id
							: null,
					wbs_root_node_id:
						typeof estimate.wbs_root_node_id === 'string' ? estimate.wbs_root_node_id : null,
					applied_template_id:
						typeof estimate.applied_template_id === 'string' ? estimate.applied_template_id : null,
					applied_template_name:
						typeof estimate.applied_template_name === 'string'
							? estimate.applied_template_name
							: null,
					currency_code: typeof estimate.currency_code === 'string' ? estimate.currency_code : null,
					updated_at: String(input.updatedAt)
				})
			)
			.execute();

		await tx
			.deleteFrom('takeoff_items')
			.where('estimate_asset_id', '=', String(input.assetId))
			.execute();
		const takeoffItems = Array.isArray(estimate.takeoff_items)
			? (estimate.takeoff_items as Array<Record<string, unknown>>)
			: [];
		await this.localInsertTakeoffItemsTx(tx, String(input.assetId), takeoffItems);
	}

	private async localInsertTakeoffItemsTx(
		tx: Transaction<DB>,
		estimateAssetId: string,
		takeoffItems: Array<Record<string, unknown>>
	): Promise<void> {
		for (const item of takeoffItems) {
			await tx
				.insertInto('takeoff_items')
				.values({
					id: String(item.id),
					estimate_asset_id: estimateAssetId,
					parent_id: typeof item.parent_id === 'string' ? item.parent_id : null,
					wbs_node_id: typeof item.wbs_node_id === 'string' ? item.wbs_node_id : null,
					cost_code_id: typeof item.cost_code_id === 'string' ? item.cost_code_id : null,
					applied_preset_id:
						typeof item.applied_preset_id === 'string' ? item.applied_preset_id : null,
					applied_preset_name:
						typeof item.applied_preset_name === 'string' ? item.applied_preset_name : null,
					name: String(item.name),
					description: typeof item.description === 'string' ? item.description : '',
					quantity: Number(item.quantity ?? 0),
					unit: String(item.unit),
					properties_json: stringifyJson((item.properties as Record<string, unknown>) ?? {}),
					sort_order: Number(item.sort_order ?? 0)
				})
				.execute();
			for (const component of Array.isArray(item.cost_components)
				? (item.cost_components as Array<Record<string, unknown>>)
				: []) {
				await tx
					.insertInto('cost_components')
					.values({
						id: String(component.id),
						takeoff_item_id: String(item.id),
						category: String(component.category),
						source_type: String(component.source_type),
						source_id: typeof component.source_id === 'string' ? component.source_id : null,
						name: String(component.name),
						description: typeof component.description === 'string' ? component.description : '',
						quantity: Number(component.quantity ?? 0),
						unit: String(component.unit),
						unit_rate: Number(component.unit_rate ?? 0),
						formula_json: stringifyJson((component.formula as Record<string, unknown>) ?? {}),
						metadata_json: stringifyJson((component.metadata as Record<string, unknown>) ?? {}),
						sort_order: Number(component.sort_order ?? 0)
					})
					.execute();
			}
		}
	}

	private async localInsertQuoteOptionsTx(
		tx: Transaction<DB>,
		projectId: string,
		options: Array<Record<string, unknown>>
	): Promise<void> {
		for (const option of options) {
			await tx
				.insertInto('quote_options')
				.values({
					id: String(option.id),
					project_id: projectId,
					label: String(option.label),
					lead_time: String(option.leadTime ?? option.lead_time ?? '2 weeks'),
					markup_percentage: Number(option.markupPercentage ?? option.markup_percentage ?? 0),
					material_markup_percentage:
						(option.materialMarkupPercentage as number | null | undefined) ??
						(option.material_markup_percentage as number | null | undefined) ??
						null,
					labour_markup_percentage:
						(option.labourMarkupPercentage as number | null | undefined) ??
						(option.labour_markup_percentage as number | null | undefined) ??
						null,
					equipment_markup_percentage:
						(option.equipmentMarkupPercentage as number | null | undefined) ??
						(option.equipment_markup_percentage as number | null | undefined) ??
						null,
					subcontract_markup_percentage:
						(option.subcontractMarkupPercentage as number | null | undefined) ??
						(option.subcontract_markup_percentage as number | null | undefined) ??
						null,
					notes: String(option.notes ?? ''),
					sort_order: Number(option.sortOrder ?? option.sort_order ?? 0),
					is_default: option.isDefault || option.is_default ? 1 : 0
				})
				.execute();
		}
	}

	private async localResetQuoteWorkspaceTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const assetIds = Array.isArray(input.assetIds)
			? (input.assetIds as unknown[]).map((value) => String(value))
			: [];
		if (assetIds.length > 0) {
			await tx.deleteFrom('estimates').where('asset_id', 'in', assetIds).execute();
		}
		await tx
			.deleteFrom('quote_options')
			.where('project_id', '=', String(input.projectId))
			.execute();
		await this.localInsertQuoteOptionsTx(
			tx,
			String(input.projectId),
			Array.isArray(input.quoteOptions)
				? (input.quoteOptions as Array<Record<string, unknown>>)
				: []
		);
		await tx
			.updateTable('projects')
			.set({
				quote_round_prices: 0,
				updated_at: String(input.updatedAt)
			})
			.where('id', '=', String(input.projectId))
			.execute();
		await tx
			.updateTable('assets')
			.set({
				quote_quantity: 1,
				is_pdf_included: 1
			})
			.where('project_id', '=', String(input.projectId))
			.execute();
	}

	private async localCreateQuoteRevisionTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<{ revisionId: string }> {
		const latest = await tx
			.selectFrom('quote_revisions')
			.select(({ fn }) => fn.max<number>('revision_number').as('max_revision_number'))
			.where('project_id', '=', String(input.projectId))
			.executeTakeFirst();
		const revisionNumber = Number(latest?.max_revision_number ?? 0) + 1;
		const revisionId = crypto.randomUUID();
		const revisionLabel = `Rev ${revisionNumber}`;
		const contact = (input.contact as Record<string, unknown> | null) ?? null;
		const business = input.business as Record<string, unknown>;
		const contactCountryCode =
			(typeof contact?.countryCode === 'string' ? contact.countryCode : null) ??
			(typeof business.countryCode === 'string' ? business.countryCode : null);
		const businessCountryCode =
			(typeof business.countryCode === 'string' ? business.countryCode : null) ??
			contactCountryCode;
		const contactTaxIdLabel = this.supportsSeparateTaxIdentifier(contactCountryCode)
			? typeof contact?.taxIdLabel === 'string'
				? contact.taxIdLabel
				: null
			: null;
		const contactTaxIdValue = this.supportsSeparateTaxIdentifier(contactCountryCode)
			? typeof contact?.taxIdValue === 'string'
				? contact.taxIdValue
				: null
			: null;
		const businessTaxIdLabel = this.supportsSeparateTaxIdentifier(businessCountryCode)
			? typeof business.taxIdLabel === 'string'
				? business.taxIdLabel
				: null
			: null;
		const businessTaxIdValue = this.supportsSeparateTaxIdentifier(businessCountryCode)
			? typeof business.taxIdValue === 'string'
				? business.taxIdValue
				: null
			: null;

		await tx
			.insertInto('quote_revisions')
			.values({
				id: revisionId,
				project_id: String(input.projectId),
				revision_number: revisionNumber,
				revision_label: revisionLabel,
				rfq_number_snapshot: String(input.rfqNumber),
				contact_name_snapshot: typeof input.contactName === 'string' ? input.contactName : null,
				contact_country_code_snapshot: contactCountryCode,
				contact_business_id_label_snapshot:
					typeof contact?.businessIdLabel === 'string' ? contact.businessIdLabel : null,
				contact_business_id_value_snapshot:
					typeof contact?.businessIdValue === 'string' ? contact.businessIdValue : null,
				contact_tax_id_label_snapshot: contactTaxIdLabel,
				contact_tax_id_value_snapshot: contactTaxIdValue,
				project_name_snapshot: typeof input.projectName === 'string' ? input.projectName : null,
				business_name_snapshot: String(business.name),
				business_id_label_snapshot:
					(typeof business.businessIdLabel === 'string' ? business.businessIdLabel : null) ??
					(typeof business.abn === 'string' && business.abn ? 'ABN' : null),
				business_id_value_snapshot:
					(typeof business.businessIdValue === 'string' ? business.businessIdValue : null) ??
					(typeof business.abn === 'string' ? business.abn : null),
				tax_id_label_snapshot: businessTaxIdLabel,
				tax_id_value_snapshot: businessTaxIdValue,
				tax_display_label_snapshot:
					typeof business.taxDisplayLabel === 'string' ? business.taxDisplayLabel : null,
				tax_rate_percentage_snapshot:
					typeof business.taxRatePercentage === 'number' ? business.taxRatePercentage : null,
				business_abn_snapshot:
					business.businessIdLabel === 'ABN'
						? typeof business.businessIdValue === 'string'
							? business.businessIdValue
							: null
						: typeof business.abn === 'string'
							? business.abn
							: null,
				business_address_snapshot: typeof business.address === 'string' ? business.address : null,
				business_email_snapshot:
					typeof business.contactEmail === 'string' ? business.contactEmail : null,
				business_contact_name_snapshot:
					typeof business.contactName === 'string' ? business.contactName : null,
				business_contact_phone_snapshot:
					typeof business.contactPhone === 'string' ? business.contactPhone : null,
				currency_code_snapshot: String(business.currencyCode),
				currency_symbol_snapshot: String(business.currencySymbol),
				issued_date: String(input.issuedDate),
				valid_until_date: String(input.validUntilDate),
				package_attachments_json:
					typeof input.packageAttachmentsJson === 'string'
						? input.packageAttachmentsJson
						: stringifyJsonArray([]),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			})
			.execute();

		for (const option of Array.isArray(input.options)
			? (input.options as Array<Record<string, unknown>>)
			: []) {
			await tx
				.insertInto('quote_revision_options')
				.values({
					id: crypto.randomUUID(),
					revision_id: revisionId,
					source_quote_option_id:
						typeof option.sourceQuoteOptionId === 'string' ? option.sourceQuoteOptionId : null,
					label: String(option.label),
					lead_time: String(option.leadTime),
					markup_percentage: Number(option.markupPercentage ?? 0),
					notes: String(option.notes ?? ''),
					sort_order: Number(option.sortOrder ?? 0),
					is_default: option.isDefault ? 1 : 0,
					is_selected: option.isSelected ? 1 : 0,
					line_items_json:
						typeof option.lineItemsJson === 'string'
							? option.lineItemsJson
							: stringifyJsonArray([]),
					subtotal_amount: Number(option.subtotalAmount ?? 0),
					gst_amount: Number(option.gstAmount ?? 0),
					total_amount: Number(option.totalAmount ?? 0)
				})
				.execute();
		}

		return { revisionId };
	}

	private async localPersistProjectStructureTemplateTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>,
		isCreate: boolean
	): Promise<void> {
		if (isCreate) {
			await tx
				.insertInto('project_structure_templates')
				.values({
					id: String(input.id),
					workspace_id: String(input.workspaceId),
					code: typeof input.code === 'string' ? input.code : '',
					name: String(input.name),
					description: typeof input.description === 'string' ? input.description : '',
					is_active: input.isActive ? 1 : 0
				})
				.execute();
		} else {
			const updated = await tx
				.updateTable('project_structure_templates')
				.set({
					code: typeof input.code === 'string' ? input.code : '',
					name: String(input.name),
					description: typeof input.description === 'string' ? input.description : '',
					is_active: input.isActive ? 1 : 0,
					updated_at: String(input.updatedAt)
				})
				.where('id', '=', String(input.id))
				.where('workspace_id', '=', String(input.workspaceId))
				.executeTakeFirst();
			if (Number(updated.numUpdatedRows ?? 0) === 0) {
				throw new Error('Selected project structure template could not be found');
			}
			await tx
				.deleteFrom('project_structure_template_nodes')
				.where('template_id', '=', String(input.id))
				.execute();
		}
		for (const node of Array.isArray(input.nodes)
			? (input.nodes as Array<Record<string, unknown>>)
			: []) {
			await tx
				.insertInto('project_structure_template_nodes')
				.values({
					id: String(node.id),
					template_id: String(input.id),
					parent_id: typeof node.parent_id === 'string' ? node.parent_id : null,
					code: typeof node.code === 'string' ? node.code : '',
					name: String(node.name),
					type: String(node.type ?? node.node_type),
					sort_order: Number(node.sort_order ?? 0)
				})
				.execute();
		}
	}

	private async localApplyProjectStructureTemplateTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const existing = await tx
			.selectFrom('wbs_nodes')
			.select(({ fn }) => fn.count<number>('id').as('count'))
			.where('project_id', '=', String(input.projectId))
			.executeTakeFirst();
		if (Number(existing?.count ?? 0) > 0) {
			throw new Error('Project structure templates can only be applied to empty projects');
		}
		const nodeIdMap = new Map<string, string>();
		for (const node of Array.isArray(input.nodes)
			? (input.nodes as Array<Record<string, unknown>>)
			: []) {
			nodeIdMap.set(String(node.id), crypto.randomUUID());
		}
		for (const node of Array.isArray(input.nodes)
			? (input.nodes as Array<Record<string, unknown>>)
			: []) {
			await tx
				.insertInto('wbs_nodes')
				.values({
					id: nodeIdMap.get(String(node.id))!,
					project_id: String(input.projectId),
					parent_id:
						typeof node.parent_id === 'string' ? (nodeIdMap.get(node.parent_id) ?? null) : null,
					code: typeof node.code === 'string' ? node.code : '',
					name: String(node.name),
					type: String(node.type ?? node.node_type),
					sort_order: Number(node.sort_order ?? 0)
				})
				.execute();
		}
	}

	private async localInsertWbsNodesTx(
		tx: Transaction<DB>,
		nodes: Array<Record<string, unknown>>
	): Promise<void> {
		for (const node of nodes) {
			await tx
				.insertInto('wbs_nodes')
				.values({
					id: String(node.id),
					project_id: String(node.project_id),
					parent_id: typeof node.parent_id === 'string' ? node.parent_id : null,
					code: typeof node.code === 'string' ? node.code : '',
					name: String(node.name),
					type: String(node.type),
					sort_order: Number(node.sort_order ?? 0)
				})
				.execute();
		}
	}

	private async localInsertAssetsTx(
		tx: Transaction<DB>,
		assets: Array<Record<string, unknown>>
	): Promise<void> {
		for (const asset of assets) {
			await tx
				.insertInto('assets')
				.values({
					id: String(asset.id),
					project_id: String(asset.project_id),
					display_name: String(asset.display_name),
					thumbnail_file_id:
						typeof asset.thumbnail_file_id === 'string' ? asset.thumbnail_file_id : null,
					is_selected: asset.is_selected ? 1 : 0,
					quote_quantity: Number(asset.quote_quantity ?? 1),
					is_pdf_included: asset.is_pdf_included === false ? 0 : 1
				})
				.execute();
		}
	}

	private async localInsertFilesTx(
		tx: Transaction<DB>,
		files: Array<Record<string, unknown>>
	): Promise<void> {
		for (const file of files) {
			await tx
				.insertInto('files')
				.values({
					id: String(file.id),
					project_id: String(file.project_id),
					asset_id: typeof file.asset_id === 'string' ? file.asset_id : null,
					file_path: String(file.file_path),
					original_name: String(file.original_name),
					mime_type: typeof file.mime_type === 'string' ? file.mime_type : null
				})
				.execute();
		}
	}

	private async localUpdateAssetThumbnailsTx(
		tx: Transaction<DB>,
		updates: Array<Record<string, unknown>>
	): Promise<void> {
		for (const update of updates) {
			await tx
				.updateTable('assets')
				.set({
					thumbnail_file_id:
						typeof update.thumbnail_file_id === 'string' ? update.thumbnail_file_id : null
				})
				.where('id', '=', String(update.asset_id))
				.execute();
		}
	}

	private async localInsertEstimatesTx(
		tx: Transaction<DB>,
		estimates: Array<Record<string, unknown>>
	): Promise<void> {
		for (const estimate of estimates) {
			await tx
				.insertInto('estimates')
				.values({
					asset_id: String(estimate.asset_id),
					scope_summary: typeof estimate.scope_summary === 'string' ? estimate.scope_summary : '',
					notes: typeof estimate.notes === 'string' ? estimate.notes : '',
					classification_system_id:
						typeof estimate.classification_system_id === 'string'
							? estimate.classification_system_id
							: null,
					wbs_root_node_id:
						typeof estimate.wbs_root_node_id === 'string' ? estimate.wbs_root_node_id : null,
					applied_template_id:
						typeof estimate.applied_template_id === 'string' ? estimate.applied_template_id : null,
					applied_template_name:
						typeof estimate.applied_template_name === 'string'
							? estimate.applied_template_name
							: null
				})
				.execute();

			const takeoffItems = Array.isArray(estimate.takeoff_items)
				? (estimate.takeoff_items as Array<Record<string, unknown>>)
				: [];
			await this.localInsertTakeoffItemsTx(tx, String(estimate.asset_id), takeoffItems);
		}
	}

	private async localDuplicateProjectRecordsTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const project = input.project as Record<string, unknown>;
		await tx
			.insertInto('projects')
			.values({
				id: String(project.id),
				workspace_id: String(project.workspace_id),
				sort_order: Number(project.sort_order ?? 0),
				is_favourite: project.is_favourite ? 1 : 0,
				quote_round_prices: project.quote_round_prices ? 1 : 0,
				rfq_number: String(project.rfq_number),
				contact_id: typeof project.contact_id === 'string' ? project.contact_id : null,
				contact_name_snapshot:
					typeof project.contact_name_snapshot === 'string' ? project.contact_name_snapshot : null,
				requester_contact_id:
					typeof project.requester_contact_id === 'string' ? project.requester_contact_id : null,
				requester_name_snapshot:
					typeof project.requester_name_snapshot === 'string'
						? project.requester_name_snapshot
						: null,
				project_name: typeof project.project_name === 'string' ? project.project_name : null,
				due_date: typeof project.due_date === 'string' ? project.due_date : null,
				received_date: typeof project.received_date === 'string' ? project.received_date : null,
				submission_deadline_at:
					typeof project.submission_deadline_at === 'string'
						? project.submission_deadline_at
						: null,
				estimator_name: typeof project.estimator_name === 'string' ? project.estimator_name : '',
				customer_tender_reference:
					typeof project.customer_tender_reference === 'string'
						? project.customer_tender_reference
						: '',
				addendum_label: typeof project.addendum_label === 'string' ? project.addendum_label : '',
				addendum_date: typeof project.addendum_date === 'string' ? project.addendum_date : null,
				addendum_notes: typeof project.addendum_notes === 'string' ? project.addendum_notes : '',
				site_address: typeof project.site_address === 'string' ? project.site_address : '',
				delivery_address:
					typeof project.delivery_address === 'string' ? project.delivery_address : '',
				source_channel:
					typeof project.source_channel === 'string' ? project.source_channel : 'manual',
				source_reference:
					typeof project.source_reference === 'string' ? project.source_reference : null,
				priority: String(project.priority),
				status: String(project.status),
				content: typeof project.content === 'string' ? project.content : null,
				note: typeof project.note === 'string' ? project.note : null,
				updated_at: String(project.updated_at)
			})
			.execute();

		await this.localInsertQuoteOptionsTx(
			tx,
			String(project.id),
			Array.isArray(input.quoteOptions)
				? (input.quoteOptions as Array<Record<string, unknown>>)
				: []
		);

		await this.localInsertWbsNodesTx(
			tx,
			Array.isArray(input.wbsNodes) ? (input.wbsNodes as Array<Record<string, unknown>>) : []
		);

		await this.localInsertAssetsTx(
			tx,
			Array.isArray(input.assets) ? (input.assets as Array<Record<string, unknown>>) : []
		);

		await this.localInsertFilesTx(
			tx,
			Array.isArray(input.files) ? (input.files as Array<Record<string, unknown>>) : []
		);

		await this.localUpdateAssetThumbnailsTx(
			tx,
			Array.isArray(input.assetThumbnailUpdates)
				? (input.assetThumbnailUpdates as Array<Record<string, unknown>>)
				: []
		);

		await this.localInsertEstimatesTx(
			tx,
			Array.isArray(input.estimates) ? (input.estimates as Array<Record<string, unknown>>) : []
		);
	}

	private async localApplySetupImportSessionTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const workspaceIdentity = await tx
			.selectFrom('workspace_identity')
			.select('id')
			.executeTakeFirstOrThrow();
		const workspaceId = workspaceIdentity.id;
		const now = new Date().toISOString();
		const lastContact = await tx
			.selectFrom('contacts')
			.select(sql<number>`coalesce(max(sort_order), -1)`.as('sort_order'))
			.executeTakeFirst();
		let contactSortOrder = Number(lastContact?.sort_order ?? -1) + 1;
		for (const operation of Array.isArray(input.contacts)
			? (input.contacts as Array<Record<string, unknown>>)
			: []) {
			const contactInput = {
				id: String(operation.id),
				workspaceId,
				sortOrder: operation.action === 'create' ? contactSortOrder++ : null,
				updatedAt: now,
				data: operation.data as Record<string, unknown>
			};
			await this.localPersistContactTx(tx, contactInput, operation.action === 'create');
		}
		for (const operation of Array.isArray(input.materials)
			? (input.materials as Array<Record<string, unknown>>)
			: []) {
			const data = operation.data as Record<string, unknown>;
			const mappedFields = new Set(
				Array.isArray(operation.mappedFields) ? operation.mappedFields.map(String) : []
			);
			if (operation.action === 'create') {
				await tx
					.insertInto('material_catalog_items')
					.values({
						id: String(operation.id),
						workspace_id: workspaceId,
						code: typeof data.code === 'string' ? data.code : null,
						name: String(data.name),
						category: typeof data.category === 'string' ? data.category : null,
						specification: typeof data.specification === 'string' ? data.specification : null,
						unit: normaliseMaterialUnitCode(data.unit) ?? 'ea',
						default_rate: Number(data.default_rate ?? 0),
						aliases_json: stringifyJsonArray(
							Array.isArray(data.aliases)
								? data.aliases.filter((value): value is string => typeof value === 'string')
								: []
						),
						metadata_json: stringifyJson({}),
						effective_date: nullableText(data.effective_date),
						verified_date: nullableText(data.verified_date),
						rate_basis: typeof data.rate_basis === 'string' ? data.rate_basis : 'cost',
						lead_time: typeof data.lead_time === 'string' ? data.lead_time : '',
						availability: typeof data.availability === 'string' ? data.availability : '',
						reference: typeof data.reference === 'string' ? data.reference : '',
						is_active: data.is_active === false ? 0 : 1,
						currency_code:
							typeof data.currency_code === 'string'
								? (data.currency_code as SupportedCurrencyCode)
								: 'AUD'
					})
					.execute();
			} else {
				await tx
					.updateTable('material_catalog_items')
					.set({
						...(mappedFields.has('code') && {
							code: typeof data.code === 'string' ? data.code : null
						}),
						...(mappedFields.has('name') && { name: String(data.name) }),
						...(mappedFields.has('category') && {
							category: typeof data.category === 'string' ? data.category : null
						}),
						...(mappedFields.has('specification') && {
							specification: typeof data.specification === 'string' ? data.specification : null
						}),
						...(mappedFields.has('unit') && {
							unit: normaliseMaterialUnitCode(data.unit) ?? 'ea'
						}),
						...(mappedFields.has('default_rate') && {
							default_rate: Number(data.default_rate ?? 0)
						}),
						...(mappedFields.has('aliases') && {
							aliases_json: stringifyJsonArray(
								Array.isArray(data.aliases)
									? data.aliases.filter((value): value is string => typeof value === 'string')
									: []
							)
						}),
						...(mappedFields.has('effective_date') && {
							effective_date: nullableText(data.effective_date)
						}),
						...(mappedFields.has('verified_date') && {
							verified_date: nullableText(data.verified_date)
						}),
						...(mappedFields.has('rate_basis') && {
							rate_basis: String(data.rate_basis ?? 'cost')
						}),
						...(mappedFields.has('lead_time') && { lead_time: String(data.lead_time ?? '') }),
						...(mappedFields.has('availability') && {
							availability: String(data.availability ?? '')
						}),
						...(mappedFields.has('reference') && { reference: String(data.reference ?? '') }),
						...(mappedFields.has('is_active') && { is_active: data.is_active === false ? 0 : 1 }),
						...(mappedFields.has('currency_code') && {
							currency_code:
								typeof data.currency_code === 'string'
									? (data.currency_code as SupportedCurrencyCode)
									: 'AUD'
						}),
						updated_at: now
					})
					.where('id', '=', String(operation.id))
					.where('workspace_id', '=', workspaceId)
					.execute();
			}
		}
	}

	private async localDeleteCatalogueItemsTx(
		tx: Transaction<DB>,
		input: Record<string, unknown>
	): Promise<void> {
		const scope = String(input.scope);
		const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean) : [];
		const contractByScope: Record<
			string,
			{ sourceType: CostComponent['source_type']; tableName: keyof DB }
		> = {
			materials: { sourceType: 'material_catalog', tableName: 'material_catalog_items' },
			labour_rates: { sourceType: 'labour_rate_card', tableName: 'labour_rate_cards' },
			equipment_rates: { sourceType: 'equipment_rate_card', tableName: 'equipment_rate_cards' },
			subcontract_rates: {
				sourceType: 'subcontract_rate_card',
				tableName: 'subcontract_rate_cards'
			}
		};
		const contract = contractByScope[scope];
		if (!contract || ids.length === 0) return;
		const now = new Date().toISOString();

		await tx
			.updateTable('cost_components')
			.set({
				source_type: 'manual',
				source_id: null,
				updated_at: now
			})
			.where('source_type', '=', contract.sourceType)
			.where('source_id', 'in', ids)
			.execute();

		await tx.deleteFrom(contract.tableName).where('id', 'in', ids).execute();
	}

	private async localSearchWorkspaceHistoryTx(
		tx: Transaction<DB>,
		input: { query: string; limit?: number }
	): Promise<SearchResultRow[]> {
		const safeQuery = input.query.trim();
		if (!safeQuery) {
			return [];
		}

		const matchTerm = `${safeQuery.replace(/["']/g, '')}*`;
		const limit = input.limit ?? 30;
		const results: SearchResultRow[] = [];

		// 1. Projects
		try {
			const rows = await sql<{
				id: string;
				project_name: string | null;
				rfq_number: string;
				rank: number;
			}>`
				SELECT id, project_name, rfq_number, rank 
				FROM global_search_index 
				WHERE global_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'projects',
					recordId: row.id,
					title: row.project_name || 'Untitled Project',
					subtitle: row.rfq_number || null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		// 2. Contacts
		try {
			const rows = await sql<{
				id: string;
				display_name: string;
				company_name: string | null;
				rank: number;
			}>`
				SELECT id, display_name, company_name, rank 
				FROM contacts_search_index 
				WHERE contacts_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'contacts',
					recordId: row.id,
					title: row.display_name,
					subtitle: row.company_name || null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		// 3. Materials
		try {
			const rows = await sql<{ id: string; name: string; code: string | null; rank: number }>`
				SELECT id, name, code, rank 
				FROM materials_search_index 
				WHERE materials_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'material_catalog_items',
					recordId: row.id,
					title: row.name,
					subtitle: row.code || null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		// 4. Labour
		try {
			const rows = await sql<{ id: string; name: string; code: string | null; rank: number }>`
				SELECT id, name, code, rank 
				FROM labour_search_index 
				WHERE labour_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'labour_rate_cards',
					recordId: row.id,
					title: row.name,
					subtitle: row.code || null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		// 5. Equipment
		try {
			const rows = await sql<{ id: string; name: string; code: string | null; rank: number }>`
				SELECT id, name, code, rank 
				FROM equipment_search_index 
				WHERE equipment_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'equipment_rate_cards',
					recordId: row.id,
					title: row.name,
					subtitle: row.code || null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		// 6. Subcontract
		try {
			const rows = await sql<{ id: string; name: string; code: string | null; rank: number }>`
				SELECT id, name, code, rank 
				FROM subcontract_search_index 
				WHERE subcontract_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'subcontract_rate_cards',
					recordId: row.id,
					title: row.name,
					subtitle: row.code || null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		// 7. Cost Presets
		try {
			const rows = await sql<{ id: string; name: string; code: string | null; rank: number }>`
				SELECT id, name, code, rank 
				FROM cost_presets_search_index 
				WHERE cost_presets_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'cost_component_presets',
					recordId: row.id,
					title: row.name,
					subtitle: row.code || null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		// 8. Estimate Templates
		try {
			const rows = await sql<{ id: string; name: string; code: string | null; rank: number }>`
				SELECT id, name, code, rank 
				FROM templates_search_index 
				WHERE templates_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'estimate_templates',
					recordId: row.id,
					title: row.name,
					subtitle: row.code || null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		// 9. Estimates
		try {
			const rows = await sql<{ asset_id: string; scope_summary: string; rank: number }>`
				SELECT asset_id, scope_summary, rank 
				FROM estimates_search_index 
				WHERE estimates_search_index MATCH ${matchTerm} 
				ORDER BY rank ASC LIMIT ${limit}
			`.execute(tx);
			for (const row of rows.rows) {
				results.push({
					tableName: 'estimates',
					recordId: row.asset_id,
					title: row.scope_summary.trim() ? row.scope_summary : 'Empty Estimate Scope',
					subtitle: null,
					rank: Number(row.rank)
				});
			}
		} catch (err) {
			console.warn('Search index query error:', err);
		}

		results.sort((a, b) => a.rank - b.rank);
		return results.slice(0, limit);
	}
}

export async function invokeTypedRustCommandForTests(
	command: string,
	input: Record<string, unknown> = {}
): Promise<unknown> {
	return await new LocalTypedRustCommandShim(
		dbService as unknown as InternalDbService
	).runTypedCommandLocallyForTests(command, input);
}
