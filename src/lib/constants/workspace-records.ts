import type { SetupImportTargetTable } from '$lib/constants/setup-import-registry.js';

export type WorkspaceRecordKey =
	| 'rfqs'
	| 'contacts'
	| 'materials'
	| 'labourRates'
	| 'equipmentRates'
	| 'subcontractRates'
	| 'costPresets'
	| 'estimateTemplates'
	| 'classificationSystems'
	| 'costCodes'
	| 'projectStructureTemplates';

export type WorkspaceRecordImportSupport =
	| {
			kind: 'setup_import';
			targetTableId: SetupImportTargetTable;
			importLabel: string;
	  }
	| {
			kind: 'none';
	  };

export interface WorkspaceRecordDefinition {
	key: WorkspaceRecordKey;
	entityLabel: string;
	emptyTitle: string;
	emptyDescription: string;
	createLabel: string;
	componentPath: string;
	stateAuthorityPath?: string;
	importSupport: WorkspaceRecordImportSupport;
}

export const workspaceRecordDefinitions = {
	rfqs: {
		key: 'rfqs',
		entityLabel: 'RFQs',
		emptyTitle: 'No RFQs Yet',
		emptyDescription:
			'Create your first RFQ to start tracking files, estimates, and quote progress.',
		createLabel: 'Create RFQ',
		componentPath: 'src/lib/components/rfqs/data-table.svelte',
		importSupport: {
			kind: 'none'
		}
	},
	contacts: {
		key: 'contacts',
		entityLabel: 'Companies',
		emptyTitle: 'No Companies Yet',
		emptyDescription:
			'Create your first company to start linking RFQs, people, and commercial records.',
		createLabel: 'Create Company',
		componentPath: 'src/lib/components/contacts/contact-table.svelte',
		stateAuthorityPath: 'src/lib/state/contacts.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'contacts',
			importLabel: 'Import Companies'
		}
	},
	materials: {
		key: 'materials',
		entityLabel: 'Materials',
		emptyTitle: 'No Materials Yet',
		emptyDescription: 'Create your first material to build out your estimating catalogue.',
		createLabel: 'Create Material',
		componentPath: 'src/lib/components/materials/material-table.svelte',
		stateAuthorityPath: 'src/lib/state/materials.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'materials',
			importLabel: 'Import Materials'
		}
	},
	labourRates: {
		key: 'labourRates',
		entityLabel: 'Labour Rates',
		emptyTitle: 'No Labour Rates Yet',
		emptyDescription: 'Create your first labour rate to start pricing labour work consistently.',
		createLabel: 'Create Labour Rate',
		componentPath: 'src/lib/components/labour-rates/labour-rate-table.svelte',
		stateAuthorityPath: 'src/lib/state/labour-rates.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'labour_rates',
			importLabel: 'Import Labour Rates'
		}
	},
	equipmentRates: {
		key: 'equipmentRates',
		entityLabel: 'Equipment Rates',
		emptyTitle: 'No Equipment Rates Yet',
		emptyDescription: 'Create your first equipment rate to keep plant and hire pricing ready.',
		createLabel: 'Create Equipment Rate',
		componentPath: 'src/lib/components/equipment-rates/equipment-rate-table.svelte',
		stateAuthorityPath: 'src/lib/state/equipment-rates.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'equipment_rates',
			importLabel: 'Import Equipment Rates'
		}
	},
	subcontractRates: {
		key: 'subcontractRates',
		entityLabel: 'Subcontract Rates',
		emptyTitle: 'No Subcontract Rates Yet',
		emptyDescription:
			'Create your first subcontract rate to price vendor and subcontract work consistently.',
		createLabel: 'Create Subcontract Rate',
		componentPath: 'src/lib/components/subcontract-rates/subcontract-rate-table.svelte',
		stateAuthorityPath: 'src/lib/state/subcontract-rates.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'subcontract_rates',
			importLabel: 'Import Subcontract Rates'
		}
	},
	costPresets: {
		key: 'costPresets',
		entityLabel: 'Cost Presets',
		emptyTitle: 'No Cost Presets Yet',
		emptyDescription: 'Create your first cost preset to reuse common component bundles.',
		createLabel: 'Create Cost Preset',
		componentPath: 'src/lib/components/cost-component-presets/cost-component-presets-table.svelte',
		stateAuthorityPath: 'src/lib/state/cost-component-presets.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'cost_presets',
			importLabel: 'Import Cost Presets'
		}
	},
	estimateTemplates: {
		key: 'estimateTemplates',
		entityLabel: 'Estimate Templates',
		emptyTitle: 'No Estimate Templates Yet',
		emptyDescription: 'Create your first estimate template to speed up repeatable quoting work.',
		createLabel: 'Create Estimate Template',
		componentPath: 'src/lib/components/estimate-templates/estimate-templates-table.svelte',
		stateAuthorityPath: 'src/lib/state/estimate-templates.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'estimate_templates',
			importLabel: 'Import Estimate Templates'
		}
	},
	classificationSystems: {
		key: 'classificationSystems',
		entityLabel: 'Classification Systems',
		emptyTitle: 'No Classification Systems Yet',
		emptyDescription:
			'Create your first classification system to organise cost codes and structure.',
		createLabel: 'Create System',
		componentPath: 'src/lib/components/classification-systems/classification-systems-table.svelte',
		stateAuthorityPath: 'src/lib/state/classification-systems.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'classification_systems',
			importLabel: 'Import Systems'
		}
	},
	costCodes: {
		key: 'costCodes',
		entityLabel: 'Cost Codes',
		emptyTitle: 'No Cost Codes Yet',
		emptyDescription: 'Create your first cost code for this classification system.',
		createLabel: 'Create Cost Code',
		componentPath: 'src/lib/components/classification-systems/cost-codes-table.svelte',
		stateAuthorityPath: 'src/lib/state/classification-systems.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'cost_codes',
			importLabel: 'Import Cost Codes'
		}
	},
	projectStructureTemplates: {
		key: 'projectStructureTemplates',
		entityLabel: 'Project Structure Templates',
		emptyTitle: 'No Structure Templates Yet',
		emptyDescription:
			'Create your first project structure template to reuse a proven starting point.',
		createLabel: 'Create Structure Template',
		componentPath: 'src/lib/components/wbs/project-structure-templates-table.svelte',
		stateAuthorityPath: 'src/lib/state/project-structure-templates.svelte.ts',
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'project_structure_templates',
			importLabel: 'Import Structure Templates'
		}
	}
} satisfies Record<WorkspaceRecordKey, WorkspaceRecordDefinition>;

export function getWorkspaceRecordDefinition(key: WorkspaceRecordKey): WorkspaceRecordDefinition {
	return workspaceRecordDefinitions[key];
}

export const workspaceRecordDefinitionList = Object.values(workspaceRecordDefinitions);
