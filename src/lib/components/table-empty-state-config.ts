import type { Component, ComponentType } from 'svelte';
import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
import UsersIcon from '@lucide/svelte/icons/users';
import PackageIcon from '@lucide/svelte/icons/package';
import WrenchIcon from '@lucide/svelte/icons/wrench';
import DrillIcon from '@lucide/svelte/icons/drill';
import HandshakeIcon from '@lucide/svelte/icons/handshake';
import BlocksIcon from '@lucide/svelte/icons/blocks';
import LayoutTemplateIcon from '@lucide/svelte/icons/layout-template';
import NetworkIcon from '@lucide/svelte/icons/network';
import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
import WorkflowIcon from '@lucide/svelte/icons/workflow';
import {
	type WorkspaceRecordKey,
	workspaceRecordDefinitions
} from '$lib/constants/workspace-records.js';

type TableEmptyStateIcon = Component<Record<string, never>> | ComponentType;

export interface TableEmptyStateConfig {
	icon: TableEmptyStateIcon;
	title: string;
	description: string;
	createLabel: string;
	importLabel?: string;
}

const tableEmptyStateIcons: Record<WorkspaceRecordKey, TableEmptyStateIcon> = {
	rfqs: FolderOpenIcon,
	contacts: UsersIcon,
	materials: PackageIcon,
	labourRates: WrenchIcon,
	equipmentRates: DrillIcon,
	subcontractRates: HandshakeIcon,
	costPresets: BlocksIcon,
	estimateTemplates: LayoutTemplateIcon,
	classificationSystems: NetworkIcon,
	costCodes: FileCode2Icon,
	projectStructureTemplates: WorkflowIcon
};

export const tableEmptyStateConfigs = Object.fromEntries(
	Object.entries(workspaceRecordDefinitions).map(([key, definition]) => [
		key,
		{
			icon: tableEmptyStateIcons[key as WorkspaceRecordKey],
			title: definition.emptyTitle,
			description: definition.emptyDescription,
			createLabel: definition.createLabel,
			importLabel:
				definition.importSupport.kind === 'setup_import'
					? definition.importSupport.importLabel
					: undefined
		}
	])
) as Record<WorkspaceRecordKey, TableEmptyStateConfig>;
