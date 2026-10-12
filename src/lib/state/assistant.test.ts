/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeServiceMock = {
	getAssistantEnabled: vi.fn(),
	setAssistantEnabled: vi.fn()
};

const localAssistantServiceMock = {
	answerTurn: vi.fn(),
	resetConversation: vi.fn()
};

const compactConversationMock = vi.fn((conv) => Promise.resolve(conv));

const localAiServiceMock = {
	ensureLocalAiReady: vi.fn(),
	unloadRuntime: vi.fn()
};

const openDialogMock = vi.fn();
const readFileMock = vi.fn();
const allowExternalFileReadMock = vi.fn();
const getAppLocalFileUrlMock = vi.fn();
const buildAssistantImageAttachmentMock = vi.fn();

const toastMock = {
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
};

const dbServiceMock: Record<string, any> = {
	addContact: vi.fn(),
	updateContact: vi.fn(),
	addMaterialCatalogueItem: vi.fn(),
	updateMaterialCatalogueItem: vi.fn(),
	getEstimate: vi.fn(),
	saveEstimate: vi.fn(),
	addLabourRateCard: vi.fn(),
	updateLabourRateCard: vi.fn(),
	addEquipmentRateCard: vi.fn(),
	updateEquipmentRateCard: vi.fn(),
	addSubcontractRateCard: vi.fn(),
	updateSubcontractRateCard: vi.fn(),
	getContactById: vi.fn(),
	getMaterialCatalogueItemById: vi.fn(),
	getLabourRateCardById: vi.fn(),
	getEquipmentRateCardById: vi.fn(),
	getSubcontractRateCardById: vi.fn(),
	getClassificationSystemById: vi.fn(),
	getCostCodeById: vi.fn(),
	getCostComponentPresetById: vi.fn(),
	getEstimateTemplateById: vi.fn(),
	getQuoteOptionPresetById: vi.fn(),
	getWbsNode: vi.fn(),
	getQuoteOption: vi.fn(),
	getProjectStructureTemplateById: vi.fn(),
	getAssetById: vi.fn(),
	getContactRelationship: vi.fn(),
	getProjectStructureTemplateNode: vi.fn(),
	getWorkspaceIdentity: vi.fn().mockResolvedValue({ id: 'local-workspace' })
};

const contactsStateMock = {
	list: [] as Array<{ id: string }>,
	refresh: vi.fn()
};

const materialsStateMock = {
	list: [] as Array<{ id: string }>,
	refresh: vi.fn()
};

const projectsStateMock = {
	refresh: vi.fn()
};

const workspaceStateMock = {
	id: 'local-workspace'
};

const labourRatesStateMock = {
	list: [] as Array<{ id: string }>,
	refresh: vi.fn()
};

const equipmentRatesStateMock = {
	list: [] as Array<{ id: string }>,
	refresh: vi.fn()
};

const subcontractRatesStateMock = {
	list: [] as Array<{ id: string }>,
	refresh: vi.fn()
};

const costComponentPresetsStateMock = {
	refresh: vi.fn()
};

const estimateTemplatesStateMock = {
	refresh: vi.fn()
};

const projectStructureTemplatesStateMock = {
	refresh: vi.fn()
};

vi.mock('$lib/services/store.js', () => ({
	storeService: storeServiceMock
}));

vi.mock('$lib/services/local-assistant.js', () => ({
	localAssistantService: localAssistantServiceMock,
	compactConversation: compactConversationMock
}));

vi.mock('$lib/services/local-ai.js', () => ({
	localAiService: localAiServiceMock
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: openDialogMock
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	readFile: readFileMock
}));

vi.mock('$lib/services/external-file-access.js', () => ({
	allowExternalFileRead: allowExternalFileReadMock
}));

vi.mock('$lib/services/assets.js', () => ({
	getAppLocalFileUrl: getAppLocalFileUrlMock
}));

vi.mock('$lib/services/ai-file-evidence.js', () => ({
	buildAssistantImageAttachment: buildAssistantImageAttachmentMock
}));

vi.mock('$lib/services/db.js', () => ({
	dbService: dbServiceMock
}));

vi.mock('$lib/state/contacts.svelte.js', () => ({
	contactsState: contactsStateMock
}));

vi.mock('$lib/state/materials.svelte.js', () => ({
	materialsState: materialsStateMock
}));

vi.mock('$lib/state/projects.svelte.js', () => ({
	projectsState: projectsStateMock
}));

vi.mock('$lib/state/workspace.svelte.js', () => ({
	workspaceState: workspaceStateMock
}));

vi.mock('$lib/state/labour-rates.svelte.js', () => ({
	labourRatesState: labourRatesStateMock
}));

vi.mock('$lib/state/equipment-rates.svelte.js', () => ({
	equipmentRatesState: equipmentRatesStateMock
}));

vi.mock('$lib/state/subcontract-rates.svelte.js', () => ({
	subcontractRatesState: subcontractRatesStateMock
}));

vi.mock('$lib/state/cost-component-presets.svelte.js', () => ({
	costComponentPresetsState: costComponentPresetsStateMock
}));

vi.mock('$lib/state/estimate-templates.svelte.js', () => ({
	estimateTemplatesState: estimateTemplatesStateMock
}));

vi.mock('$lib/state/project-structure-templates.svelte.js', () => ({
	projectStructureTemplatesState: projectStructureTemplatesStateMock
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('@tauri-apps/plugin-log', () => ({
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	trace: vi.fn(),
	log: vi.fn(),
	attachConsole: vi.fn()
}));

const aiStateMock = vi.hoisted(() => ({
	isAssistantRunning: false,
	isDraftingActive: false,
	localAiStatus: {
		installState: 'ready' as 'ready' | 'installed' | 'loading' | 'not_downloaded',
		modelReady: true,
		runtimeAvailable: true,
		diagnostics: {
			contextSizeTokens: 4096
		}
	}
}));

vi.mock('$lib/state/ai.svelte.js', () => ({
	aiState: aiStateMock
}));

describe('assistantState', () => {
	async function flushQueue(assistantState: { isRunning: boolean; promptQueue: unknown[] }) {
		await vi.waitFor(() => {
			expect(assistantState.isRunning).toBe(false);
			expect(assistantState.promptQueue).toHaveLength(0);
		});
	}

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		aiStateMock.isAssistantRunning = false;
		aiStateMock.isDraftingActive = false;
		aiStateMock.localAiStatus.installState = 'ready';
		aiStateMock.localAiStatus.modelReady = true;
		aiStateMock.localAiStatus.runtimeAvailable = true;
		storeServiceMock.getAssistantEnabled.mockResolvedValue(false);
		storeServiceMock.setAssistantEnabled.mockResolvedValue(undefined);
		localAiServiceMock.ensureLocalAiReady.mockResolvedValue(undefined);
		localAiServiceMock.unloadRuntime.mockResolvedValue(undefined);
		localAssistantServiceMock.answerTurn.mockResolvedValue({
			answer: 'Open RFQ-1000 to review the current canopy scope.',
			citations: [
				{
					id: 'project-current-project-1',
					label: 'Current RFQ RFQ-1000',
					summary: 'Current RFQ RFQ-1000.',
					route: '/project/project-1'
				}
			],
			links: [
				{
					id: 'project-current-project-1',
					label: 'RFQ-1000',
					route: '/project/project-1'
				}
			],
			followUpSuggestions: []
		});
		localAssistantServiceMock.resetConversation.mockResolvedValue(undefined);
		openDialogMock.mockResolvedValue('/tmp/reference.png');
		allowExternalFileReadMock.mockResolvedValue('/tmp/reference.png');
		readFileMock.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
		getAppLocalFileUrlMock.mockResolvedValue('blob:preview-image');
		buildAssistantImageAttachmentMock.mockResolvedValue({
			mimeType: 'image/webp',
			inlineData: 'processed-image-data'
		});
		dbServiceMock.executeApprovedRecordProposalSet = vi.fn().mockResolvedValue({
			status: 'succeeded',
			successCount: 2,
			failureCount: 0,
			errors: []
		});
		dbServiceMock.getWorkspaceRecord = vi.fn().mockResolvedValue({
			scope: 'materials',
			recordId: 'material-1',
			label: 'KFVAL Plate',
			subtitle: null,
			fields: {
				name: 'KFVAL Plate',
				unit: 'kg',
				default_rate: 4.95,
				currency_code: 'AUD'
			}
		});
		dbServiceMock.getWorkspaceIdentity.mockResolvedValue({ id: 'local-workspace' });
		workspaceStateMock.id = 'local-workspace';
		dbServiceMock.addContact.mockResolvedValue(undefined);
		dbServiceMock.updateContact.mockResolvedValue(undefined);
		contactsStateMock.list = [];
		contactsStateMock.refresh.mockResolvedValue(undefined);
		materialsStateMock.list = [];
		materialsStateMock.refresh.mockResolvedValue(undefined);
		projectsStateMock.refresh.mockResolvedValue(undefined);
		dbServiceMock.addLabourRateCard.mockResolvedValue(undefined);
		dbServiceMock.updateLabourRateCard.mockResolvedValue(undefined);
		dbServiceMock.addEquipmentRateCard.mockResolvedValue(undefined);
		dbServiceMock.updateEquipmentRateCard.mockResolvedValue(undefined);
		dbServiceMock.addSubcontractRateCard.mockResolvedValue(undefined);
		dbServiceMock.updateSubcontractRateCard.mockResolvedValue(undefined);
		labourRatesStateMock.list = [];
		labourRatesStateMock.refresh.mockResolvedValue(undefined);
		equipmentRatesStateMock.list = [];
		equipmentRatesStateMock.refresh.mockResolvedValue(undefined);
		subcontractRatesStateMock.list = [];
		subcontractRatesStateMock.refresh.mockResolvedValue(undefined);
	});

	it('hydrates and persists the widget toggle', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		await assistantState.hydrate();
		expect(assistantState.isAssistantEnabled).toBe(false);

		await assistantState.setAssistantEnabled(true);

		expect(storeServiceMock.setAssistantEnabled).toHaveBeenCalledWith(true);
		expect(assistantState.isAssistantEnabled).toBe(true);
		expect(toastMock.success).toHaveBeenCalledWith('Ask Kwantflow added to toolbar');
	});

	it('starts with empty messages when the panel opens', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		assistantState.openSidebar();

		expect(assistantState.isSidebarOpen).toBe(true);
		expect(assistantState.messages).toHaveLength(0);
	});

	it('does not load the local AI engine when the sidebar opens', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		assistantState.openSidebar();

		expect(localAiServiceMock.ensureLocalAiReady).not.toHaveBeenCalled();
	});

	it('does not unload the local AI engine when the sidebar closes', async () => {
		vi.useFakeTimers();
		try {
			const { assistantState } = await import('./assistant.svelte.js');

			assistantState.openSidebar();
			assistantState.closeSidebar();
			await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

			expect(localAiServiceMock.unloadRuntime).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('sends workspace-style free text to Gemma instead of answering before inference', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		await assistantState.sendMessage({
			prompt: 'How many companies do we have?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		expect(localAssistantServiceMock.answerTurn).toHaveBeenCalledTimes(1);
	});

	it('does not retain native reasoning in the completed assistant message', async () => {
		const { assistantState } = await import('./assistant.svelte.js');
		localAssistantServiceMock.answerTurn.mockResolvedValueOnce({
			answer: 'The verified answer is 4.',
			thinking: 'Private model reasoning must not be retained.',
			citations: [],
			links: [],
			followUpSuggestions: []
		});

		await assistantState.sendMessage({
			prompt: 'What is 2 + 2?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		expect(assistantState.messages.at(-1)).toMatchObject({
			role: 'assistant',
			text: 'The verified answer is 4.',
			thinking: ''
		});
	});

	it('runs the first assistant prompt with a downloaded model before the engine is loaded', async () => {
		aiStateMock.localAiStatus.installState = 'installed';
		aiStateMock.localAiStatus.modelReady = false;
		const { assistantState } = await import('./assistant.svelte.js');

		await assistantState.sendMessage({
			prompt: 'Help me prepare my first local RFQ.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		expect(localAssistantServiceMock.answerTurn).toHaveBeenCalledTimes(1);
	});

	it('keeps an assistant prompt queued until a model is downloaded', async () => {
		aiStateMock.localAiStatus.installState = 'not_downloaded';
		aiStateMock.localAiStatus.modelReady = false;
		const { assistantState } = await import('./assistant.svelte.js');

		await assistantState.sendMessage({
			prompt: 'Help me prepare my first local RFQ.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});

		expect(assistantState.promptQueue).toHaveLength(1);
		expect(localAssistantServiceMock.answerTurn).not.toHaveBeenCalled();
	});

	it('ignores invalid bridge-side sendMessage calls without throwing', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		await expect(assistantState.sendMessage('Hello' as never)).resolves.toBeUndefined();

		expect(assistantState.promptQueue).toHaveLength(0);
		expect(localAssistantServiceMock.answerTurn).not.toHaveBeenCalled();
	});

	it('leaves conversation compaction to the local assistant service', async () => {
		const { assistantState } = await import('./assistant.svelte.js');
		await assistantState.sendMessage({
			prompt: 'Hello',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		expect(compactConversationMock).not.toHaveBeenCalled();
	});

	it('ends the native conversation when the user clears the assistant session', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		assistantState.clearSession();

		expect(localAssistantServiceMock.resetConversation).toHaveBeenCalledTimes(1);
	});

	it('adds an image attachment and carries it into the sent user message', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		await assistantState.addImageAttachment();
		expect(assistantState.pendingAttachments).toHaveLength(1);

		await assistantState.sendMessage({
			prompt: 'What is in this image?',
			pathname: '/project/project-1',
			projectId: 'project-1',
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		expect(localAssistantServiceMock.answerTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				attachments: [
					expect.objectContaining({
						name: 'reference.png',
						mimeType: 'image/webp',
						base64Data: 'processed-image-data',
						previewUrl: 'blob:preview-image'
					})
				]
			}),
			expect.any(Object)
		);
		expect(assistantState.messages).toHaveLength(2);
		expect(assistantState.messages[0]).toMatchObject({
			role: 'user',
			text: 'What is in this image?'
		});
		expect(assistantState.messages[0].attachments).toHaveLength(1);
		expect(assistantState.messages[1]).toMatchObject({
			role: 'assistant',
			text: 'Open RFQ-1000 to review the current canopy scope.'
		});
		expect(assistantState.pendingAttachments).toHaveLength(0);
	});

	it('passes attached page context and omits it when detached', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		assistantState.setCurrentViewportContext({
			id: 'page:/settings/materials',
			pathname: '/settings/materials',
			routeId: '/settings/materials',
			pageTitle: 'Materials',
			reference: {
				title: 'Materials',
				label: 'Sharing “Materials”',
				pathname: '/settings/materials',
				routeId: '/settings/materials'
			},
			metadata: {},
			text: 'Current app page: Materials.'
		});
		assistantState.reattachCurrentPageContext();

		await assistantState.sendMessage({
			prompt: 'What page is attached?',
			pathname: '/settings/materials',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		expect(localAssistantServiceMock.answerTurn).toHaveBeenLastCalledWith(
			expect.objectContaining({
				viewportContext: expect.objectContaining({ pageTitle: 'Materials' })
			}),
			expect.any(Object)
		);

		assistantState.detachCurrentPageContext();
		await assistantState.sendMessage({
			prompt: 'Ignore the page now',
			pathname: '/settings/materials',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		expect(localAssistantServiceMock.answerTurn).toHaveBeenLastCalledWith(
			expect.objectContaining({ viewportContext: null }),
			expect.any(Object)
		);
	});

	it('keeps page context detached when navigation updates the current page', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		assistantState.setCurrentViewportContext({
			id: 'page:/settings/materials',
			pathname: '/settings/materials',
			routeId: '/settings/materials',
			pageTitle: 'Materials',
			reference: {
				title: 'Materials',
				label: 'Sharing “Materials”',
				pathname: '/settings/materials',
				routeId: '/settings/materials'
			},
			metadata: {},
			text: 'Current app page: Materials.'
		});

		expect(assistantState.isPageContextAttached).toBe(false);
	});

	it('passes structured screen context without adding screenshot attachments for non-visual prompts', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		assistantState.setCurrentViewportContext({
			id: 'page:/project/project-1/quote',
			pathname: '/project/project-1/quote',
			routeId: '/project/[id]/quote',
			pageTitle: 'Quote Workspace',
			reference: {
				title: 'Quote Workspace',
				label: 'Sharing “Quote Workspace”',
				pathname: '/project/project-1/quote',
				routeId: '/project/[id]/quote'
			},
			metadata: { projectId: 'project-1', assetId: 'asset-1' },
			screen: {
				activeView: 'Option A',
				selectedRecordIds: ['takeoff-1'],
				visibleRecords: [{ id: 'takeoff-1', label: 'Concrete slab', summary: '42 m3 at 32MPa' }],
				draftSummary: 'One unresolved item needs review.',
				statusMessages: ['Unsaved changes']
			},
			text: 'Current app page: Quote Workspace. Active view: Option A.'
		});
		assistantState.reattachCurrentPageContext();

		await assistantState.sendMessage({
			prompt: 'what should I do next with this quote',
			pathname: '/project/project-1/quote',
			projectId: 'project-1',
			assetId: 'asset-1',
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		expect(localAssistantServiceMock.answerTurn).toHaveBeenLastCalledWith(
			expect.objectContaining({
				viewportContext: expect.objectContaining({
					screen: expect.objectContaining({ activeView: 'Option A' })
				}),
				attachments: []
			}),
			expect.any(Object)
		);
	});

	it('stores and clears the live estimate context without toast noise on clear', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		assistantState.setCurrentEstimateContext({
			assetId: 'asset-1',
			takeoffItemCount: 2,
			scopeSummary: 'Current scope',
			notes: 'Current notes',
			totalCost: 13280,
			takeoffItems: []
		});
		expect(assistantState.currentEstimateContext).toMatchObject({
			assetId: 'asset-1',
			takeoffItemCount: 2
		});

		assistantState.clearSession();
		expect(assistantState.currentEstimateContext).toMatchObject({
			assetId: 'asset-1',
			takeoffItemCount: 2
		});
		expect(toastMock.success).not.toHaveBeenCalledWith('Assistant session cleared');

		assistantState.clearCurrentEstimateContext('asset-1');
		expect(assistantState.currentEstimateContext).toBeNull();
	});

	it('caps pending image attachments at three files', async () => {
		const { assistantState } = await import('./assistant.svelte.js');
		openDialogMock
			.mockResolvedValueOnce('/tmp/reference-1.png')
			.mockResolvedValueOnce('/tmp/reference-2.png')
			.mockResolvedValueOnce('/tmp/reference-3.png')
			.mockResolvedValueOnce('/tmp/reference-4.png');
		allowExternalFileReadMock.mockImplementation(async (path: string) => path);

		await assistantState.addImageAttachment();
		await assistantState.addImageAttachment();
		await assistantState.addImageAttachment();
		await assistantState.addImageAttachment();

		expect(assistantState.pendingAttachments).toHaveLength(3);
		expect(toastMock.error).toHaveBeenCalledWith('You can attach up to 3 images');
	});

	it('adds dropped image paths and rejects unsupported files', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		await assistantState.addImageAttachmentsFromPaths([
			'/tmp/reference.png',
			'/tmp/reference-2.jpg',
			'/tmp/reference.pdf'
		]);

		expect(assistantState.pendingAttachments).toHaveLength(2);
		expect(assistantState.pendingAttachments.map((attachment) => attachment.name)).toEqual([
			'reference.png',
			'reference-2.jpg'
		]);
		expect(toastMock.error).toHaveBeenCalledWith('Only image files can be attached here');
	});

	it('routes assistant attachments through shared image preprocessing', async () => {
		const { assistantState } = await import('./assistant.svelte.js');

		await assistantState.addImageAttachment();

		expect(buildAssistantImageAttachmentMock).toHaveBeenCalledWith({
			bytes: new Uint8Array([1, 2, 3, 4]),
			mimeType: 'image/png',
			fileName: 'reference.png'
		});
		expect(assistantState.pendingAttachments[0]).toMatchObject({
			mimeType: 'image/webp',
			base64Data: 'processed-image-data'
		});
	});

	it('approves and verifies one atomic assistant proposal set', async () => {
		const { assistantState } = await import('./assistant.svelte.js');
		localAssistantServiceMock.answerTurn.mockResolvedValueOnce({
			answer: 'I drafted two changes for approval.',
			citations: [],
			links: [],
			followUpSuggestions: [],
			proposalSet: {
				id: 'set-1',
				turnId: 'turn-1',
				summary: 'Create a company and update a material.',
				status: 'pending',
				items: [
					{
						id: 'proposal-1',
						scope: 'materials',
						action: 'update',
						recordId: 'material-1',
						fields: { default_rate: 4.95 },
						summary: 'Update validation plate rate.'
					},
					{
						id: 'proposal-2',
						scope: 'contacts',
						action: 'create',
						fields: { kind: 'company', name: 'KFVAL Steel' },
						summary: 'Create KFVAL Steel.'
					}
				]
			}
		});
		dbServiceMock.getWorkspaceRecord
			.mockResolvedValueOnce({ fields: { default_rate: 4.95 } })
			.mockResolvedValueOnce({ fields: { kind: 'company', name: 'KFVAL Steel' } });

		await assistantState.sendMessage({
			prompt: 'Update KFVAL Plate to 4.95 AUD/kg',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		await assistantState.approveProposalSet('set-1');

		expect(dbServiceMock.executeApprovedRecordProposalSet).toHaveBeenCalledWith({
			proposalSetId: 'set-1',
			turnId: 'turn-1',
			items: [
				{
					proposalId: 'proposal-1',
					scope: 'materials',
					action: 'update',
					recordId: 'material-1',
					fields: { default_rate: 4.95 }
				},
				{
					proposalId: 'proposal-2',
					scope: 'contacts',
					action: 'create',
					recordId: undefined,
					fields: { kind: 'company', name: 'KFVAL Steel' }
				}
			]
		});
		expect(dbServiceMock.getWorkspaceRecord).toHaveBeenCalledTimes(2);
		expect(assistantState.messages.at(-1)?.proposalSet?.status).toBe('executed');
		expect(toastMock.success).toHaveBeenCalledWith('Assistant proposal set approved');
	});

	it('marks an approved proposal set failed when read-back verification does not match', async () => {
		const { assistantState } = await import('./assistant.svelte.js');
		dbServiceMock.getWorkspaceRecord.mockResolvedValueOnce({
			scope: 'materials',
			recordId: 'material-1',
			label: 'KFVAL Plate',
			subtitle: null,
			fields: {
				name: 'KFVAL Plate',
				unit: 'kg',
				default_rate: 4.85,
				currency_code: 'AUD'
			}
		});
		localAssistantServiceMock.answerTurn.mockResolvedValueOnce({
			answer: 'I drafted a material update for approval.',
			citations: [],
			links: [],
			followUpSuggestions: [],
			proposalSet: {
				id: 'set-1',
				turnId: 'turn-1',
				summary: 'Update validation plate rate.',
				status: 'pending',
				items: [
					{
						id: 'proposal-1',
						scope: 'materials',
						action: 'update',
						recordId: 'material-1',
						fields: { default_rate: 4.95 },
						summary: 'Update validation plate rate.'
					}
				]
			}
		});

		await assistantState.sendMessage({
			prompt: 'Update KFVAL Plate to 4.95 AUD/kg',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);

		await assistantState.approveProposalSet('set-1');

		expect(assistantState.messages.at(-1)?.proposalSet?.status).toBe('failed');
		expect(toastMock.success).not.toHaveBeenCalledWith('Assistant proposal set approved');
	});

	it('discards a proposal set without writing any record', async () => {
		const { assistantState } = await import('./assistant.svelte.js');
		localAssistantServiceMock.answerTurn.mockResolvedValueOnce({
			answer: 'I drafted one change for approval.',
			citations: [],
			links: [],
			followUpSuggestions: [],
			proposalSet: {
				id: 'set-discard',
				turnId: 'turn-discard',
				summary: 'Create a material.',
				status: 'pending',
				items: [
					{
						id: 'proposal-discard',
						scope: 'materials',
						action: 'create',
						fields: { name: 'Discarded', unit: 'kg', default_rate: 1 },
						summary: 'Create discarded material.'
					}
				]
			}
		});

		await assistantState.sendMessage({
			prompt: 'Create a material',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceProfile: null,
			knowledgeContext: null
		});
		await flushQueue(assistantState);
		assistantState.discardProposalSet('set-discard');

		expect(dbServiceMock.executeApprovedRecordProposalSet).not.toHaveBeenCalled();
		expect(assistantState.messages.at(-1)?.proposalSet?.status).toBe('discarded');
	});
});
