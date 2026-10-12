<script lang="ts">
	import { tick } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { FieldError, FieldLabel, FieldShell, Text } from '$lib/components/primitives/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import WorkflowIcon from '@lucide/svelte/icons/workflow';
	import GitBranchPlusIcon from '@lucide/svelte/icons/git-branch-plus';
	import { projectStructureTemplatesState } from '$lib/state/project-structure-templates.svelte.js';
	import {
		projectStructureTemplateFormSchema,
		type ProjectStructureTemplateFormValues,
		wbsNodeFormSchema,
		type WbsNodeFormValues
	} from '$lib/schemas/index.js';
	import type {
		ProjectStructureTemplate,
		ProjectStructureTemplateNode,
		WbsNode
	} from '$lib/types/index.js';
	import { WBS_NODE_TYPE_OPTIONS } from '$lib/constants/index.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { toast } from 'svelte-sonner';
	import TableTextCell from '../table-text-cell.svelte';
	import TableHeaderLabel from '../table-header-label.svelte';

	interface Props {
		open?: boolean;
		template?: ProjectStructureTemplate | null;
		sourceNodes?: WbsNode[];
	}

	type TemplateStep = 'details' | 'structure';
	type TemplateField = keyof ProjectStructureTemplateFormValues;

	let { open = $bindable(false), template = null, sourceNodes = [] }: Props = $props();
	let activeStep: TemplateStep = $state('details');
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let formValues = $state<ProjectStructureTemplateFormValues>({
		code: '',
		name: '',
		description: '',
		is_active: true
	});
	let draftNodes = $state<ProjectStructureTemplateNode[]>([]);
	let nodeDialogOpen = $state(false);
	let nodeToEdit = $state<ProjectStructureTemplateNode | null>(null);
	let nodeToDelete = $state<ProjectStructureTemplateNode | null>(null);
	let deleteNodeOpen = $state(false);
	let nodeFieldErrors = $state<Record<string, string[] | undefined>>({});
	let nodeFormValues = $state<WbsNodeFormValues>({
		parent_id: null,
		code: '',
		name: '',
		type: 'custom',
		sort_order: 0
	});
	let nodeParentValue = $state('__none__');
	let nodeSortOrderInput = $state<string | number>('');

	const nav = [
		{ id: 'details' as const, name: 'Details', icon: ClipboardListIcon },
		{ id: 'structure' as const, name: 'Structure', icon: WorkflowIcon }
	];
	const fieldIdMap: Record<TemplateField, string> = {
		code: 'project-structure-template-code',
		name: 'project-structure-template-name',
		description: 'project-structure-template-description',
		is_active: 'project-structure-template-status'
	};
	const parentNameById = $derived.by(() =>
		Object.fromEntries(draftNodes.map((node) => [node.id, node.name]))
	);
	const excludedParentIds = $derived.by(() => {
		if (!nodeToEdit) return [] as string[];
		const childrenByParent: Record<string, string[]> = {};
		for (const item of draftNodes) {
			if (!item.parent_id) continue;
			const siblings = childrenByParent[item.parent_id] ?? [];
			siblings.push(item.id);
			childrenByParent[item.parent_id] = siblings;
		}
		const excluded = [nodeToEdit.id];
		const stack = [...(childrenByParent[nodeToEdit.id] ?? [])];
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current || excluded.includes(current)) continue;
			excluded.push(current);
			stack.push(...(childrenByParent[current] ?? []));
		}
		return excluded;
	});
	const parentOptions = $derived(draftNodes.filter((node) => !excludedParentIds.includes(node.id)));

	function sortNodes(nodes: ProjectStructureTemplateNode[]): ProjectStructureTemplateNode[] {
		return [...nodes].sort(
			(left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)
		);
	}

	function cloneProjectNodes(nodes: WbsNode[]): ProjectStructureTemplateNode[] {
		const idMap: Record<string, string> = {};
		for (const node of nodes) {
			idMap[node.id] = crypto.randomUUID();
		}
		return sortNodes(
			nodes.map((node) => ({
				id: idMap[node.id]!,
				template_id: '__draft__',
				parent_id: node.parent_id ? (idMap[node.parent_id] ?? null) : null,
				code: node.code ?? null,
				name: node.name,
				type: node.type,
				sort_order: node.sort_order,
				created_at: new Date().toISOString()
			}))
		);
	}

	function cloneTemplateNodes(
		nodes: ProjectStructureTemplateNode[]
	): ProjectStructureTemplateNode[] {
		return sortNodes(
			nodes.map((node) => ({
				...node,
				parent_id: node.parent_id ?? null,
				code: node.code ?? null
			}))
		);
	}

	function buildInitialFormValues(): ProjectStructureTemplateFormValues {
		if (template) {
			return {
				code: template.code ?? '',
				name: template.name,
				description: template.description,
				is_active: template.is_active
			};
		}
		return {
			code: '',
			name: '',
			description: '',
			is_active: true
		};
	}

	$effect(() => {
		if (!open) return;
		activeStep = 'details';
		fieldErrors = {};
		formValues = buildInitialFormValues();
		draftNodes = template ? cloneTemplateNodes(template.nodes) : cloneProjectNodes(sourceNodes);
		nodeDialogOpen = false;
		nodeToEdit = null;
		nodeToDelete = null;
		deleteNodeOpen = false;
	});

	$effect(() => {
		if (!nodeDialogOpen) return;
		nodeFieldErrors = {};
		const initialNodeValues: WbsNodeFormValues = nodeToEdit
			? {
					parent_id: nodeToEdit.parent_id ?? null,
					code: nodeToEdit.code ?? '',
					name: nodeToEdit.name,
					type: nodeToEdit.type,
					sort_order: nodeToEdit.sort_order
				}
			: {
					parent_id: null,
					code: '',
					name: '',
					type: 'custom',
					sort_order: draftNodes.length
				};
		nodeFormValues = initialNodeValues;
		nodeParentValue = initialNodeValues.parent_id ?? '__none__';
		nodeSortOrderInput = String(initialNodeValues.sort_order);
	});

	async function focusField(field: TemplateField) {
		await tick();
		document.getElementById(fieldIdMap[field])?.focus();
	}

	async function focusFirstError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<TemplateField>(
			['name', 'code', 'description', 'is_active'],
			errors
		);
		if (firstField) await focusField(firstField);
	}

	function openNewNodeDialog() {
		nodeToEdit = null;
		nodeDialogOpen = true;
	}

	function getNodeSortOrder(): string {
		if (typeof nodeSortOrderInput === 'number') {
			return Number.isFinite(nodeSortOrderInput) ? String(nodeSortOrderInput) : '';
		}
		return nodeSortOrderInput.trim();
	}

	function deleteNodeAndDescendants(nodeId: string) {
		const descendants = [nodeId];
		let changed = true;
		while (changed) {
			changed = false;
			for (const node of draftNodes) {
				if (
					node.parent_id &&
					descendants.includes(node.parent_id) &&
					!descendants.includes(node.id)
				) {
					descendants.push(node.id);
					changed = true;
				}
			}
		}
		draftNodes = draftNodes.filter((node) => !descendants.includes(node.id));
		nodeToDelete = null;
		deleteNodeOpen = false;
	}

	function saveNode() {
		nodeFieldErrors = {};
		const normalizedSortOrder = getNodeSortOrder();
		if (normalizedSortOrder === '') {
			nodeFieldErrors = { sort_order: ['Sort order is required'] };
			toast.error('Validation failed');
			return;
		}

		nodeFormValues = {
			...nodeFormValues,
			parent_id: nodeParentValue === '__none__' ? null : nodeParentValue,
			sort_order: Number(normalizedSortOrder)
		};
		const result = wbsNodeFormSchema.safeParse(nodeFormValues);
		if (!result.success) {
			nodeFieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			return;
		}

		const editingNode = nodeToEdit;
		if (editingNode) {
			draftNodes = sortNodes(
				draftNodes.map((node) =>
					node.id === editingNode.id
						? {
								...node,
								parent_id: result.data.parent_id ?? null,
								code: result.data.code || null,
								name: result.data.name,
								type: result.data.type,
								sort_order: result.data.sort_order
							}
						: node
				)
			);
		} else {
			draftNodes = sortNodes(
				draftNodes.concat({
					id: crypto.randomUUID(),
					template_id: template?.id ?? '__draft__',
					parent_id: result.data.parent_id ?? null,
					code: result.data.code || null,
					name: result.data.name,
					type: result.data.type,
					sort_order: result.data.sort_order,
					created_at: new Date().toISOString()
				})
			);
		}
		nodeDialogOpen = false;
	}

	async function handleSave() {
		fieldErrors = {};
		const result = projectStructureTemplateFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstError(fieldErrors);
			return;
		}
		if (draftNodes.length === 0) {
			activeStep = 'structure';
			toast.error('Add at least one structure node');
			return;
		}

		isSaving = true;
		try {
			if (template) {
				await projectStructureTemplatesState.updateTemplateContent(
					template.id,
					result.data,
					draftNodes
				);
			} else {
				await projectStructureTemplatesState.createTemplate(result.data, draftNodes);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, name: [message] };
				activeStep = 'details';
				await focusField('name');
				return;
			}
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.WorkflowFrame
		title={template ? `Edit ${template.name}` : 'Save Project Structure Template'}
		description={template
			? 'Review and update the template details and reusable structure.'
			: 'Save the current project structure as a reusable template.'}
		steps={nav}
		{activeStep}
		onStepSelect={(stepId) => {
			activeStep = stepId as TemplateStep;
		}}
		class="md:ui-dialog-height-editor ui-dialog-size-xl lg:ui-dialog-size-2xl"
	>
		{#if activeStep === 'details'}
			<div class="flex flex-col gap-4">
				<FieldShell>
					<FieldLabel for="project-structure-template-name">Template Name</FieldLabel>
					<Input
						id="project-structure-template-name"
						bind:value={formValues.name}
						size="sm"
						invalidTone={getFieldInvalidTone(fieldErrors.name)}
						placeholder="e.g. Fabrication Starter"
					/>
					<FieldError errors={fieldErrors.name} />
				</FieldShell>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="project-structure-template-code">Code</FieldLabel>
						<Input
							id="project-structure-template-code"
							bind:value={formValues.code}
							size="sm"
							placeholder="Optional code"
						/>
					</FieldShell>
					<FieldShell>
						<FieldLabel for="project-structure-template-status">Status</FieldLabel>
						<Select.Root
							type="single"
							value={formValues.is_active ? 'active' : 'inactive'}
							onValueChange={(value) => {
								formValues.is_active = value !== 'inactive';
							}}
						>
							<Select.Trigger id="project-structure-template-status" size="sm" class="w-full">
								{formValues.is_active ? 'Active' : 'Inactive'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="active">Active</Select.Item>
								<Select.Item value="inactive">Inactive</Select.Item>
							</Select.Content>
						</Select.Root>
					</FieldShell>
				</div>
				<FieldShell>
					<FieldLabel for="project-structure-template-description">Description</FieldLabel>
					<Textarea
						id="project-structure-template-description"
						bind:value={formValues.description}
						size="sm"
						class="min-h-24"
						placeholder="Optional template notes"
					/>
				</FieldShell>
			</div>
		{:else}
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div>
						<h3 class="h4">Structure Nodes</h3>
						<Text as="p" tone="muted">
							Edit the reusable hierarchy that will be copied into a project.
						</Text>
					</div>
					<Button size="sm" class="gap-1.5" onclick={openNewNodeDialog}>
						<PlusIcon class="size-3.5" />
						Add Node
					</Button>
				</div>
				<div class="ui-radius-lg overflow-hidden border">
					<Table.Root>
						<Table.Header class="bg-muted">
							<Table.Row>
								<Table.Head><TableHeaderLabel text="Name" /></Table.Head>
								<Table.Head><TableHeaderLabel text="Type" /></Table.Head>
								<Table.Head><TableHeaderLabel text="Parent" /></Table.Head>
								<Table.Head><TableHeaderLabel text="Order" align="right" /></Table.Head>
								<Table.Head class="w-12 px-1"></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if draftNodes.length > 0}
								{#each draftNodes as node (node.id)}
									<Table.Row>
										<Table.Cell>
											<div class="flex flex-col">
												<TableTextCell text={node.name} />
												<TableTextCell text={node.code} tone="secondary" />
											</div>
										</Table.Cell>
										<Table.Cell><TableTextCell text={node.type} tone="secondary" /></Table.Cell>
										<Table.Cell>
											<TableTextCell
												text={node.parent_id ? parentNameById[node.parent_id] : 'Top-level'}
												tone="secondary"
											/>
										</Table.Cell>
										<Table.Cell>
											<TableTextCell text={node.sort_order} align="right" tabular />
										</Table.Cell>
										<Table.Cell class="px-1">
											<div class="flex justify-end">
												<DropdownMenu.Root>
													<DropdownMenu.Trigger>
														{#snippet child({ props })}
															<Button {...props} variant="ghost" size="icon-xs">
																<span class="sr-only">Open menu</span>
																<MoreHorizontalIcon class="size-3.5" />
															</Button>
														{/snippet}
													</DropdownMenu.Trigger>
													<DropdownMenu.Content align="end" class="w-44">
														<DropdownMenu.Item
															class="gap-2"
															onclick={() => {
																nodeToEdit = node;
																nodeDialogOpen = true;
															}}
														>
															<PencilIcon class="muted size-3.5" />
															<span>Edit Node</span>
														</DropdownMenu.Item>
														<DropdownMenu.Separator />
														<DropdownMenu.Item
															class="menu-item-destructive gap-2"
															onclick={() => {
																nodeToDelete = node;
																deleteNodeOpen = true;
															}}
														>
															<Trash2Icon class="size-3.5" />
															<span>Delete Node</span>
														</DropdownMenu.Item>
													</DropdownMenu.Content>
												</DropdownMenu.Root>
											</div>
										</Table.Cell>
									</Table.Row>
								{/each}
							{:else}
								<Table.Row>
									<Table.Cell colspan={5} class="h-40 text-center">
										<div class="flex flex-col items-center gap-2 opacity-50">
											<GitBranchPlusIcon class="size-8" />
											<Text tone="muted">No structure nodes yet.</Text>
										</div>
									</Table.Cell>
								</Table.Row>
							{/if}
						</Table.Body>
					</Table.Root>
				</div>
			</div>
		{/if}

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="brand" onclick={handleSave} disabled={isSaving} loading={isSaving}>
				{isSaving ? 'Saving...' : template ? 'Save Changes' : 'Save Template'}
			</Button>
		{/snippet}
	</Dialog.WorkflowFrame>
</Dialog.Root>

<Dialog.Root bind:open={nodeDialogOpen}>
	<Dialog.FormFrame
		title={nodeToEdit ? 'Edit Structure Node' : 'Add Structure Node'}
		description="Use Project Structure (WBS) to organise work by phase, level, room, zone, trade, or custom groupings."
		class="ui-dialog-size-lg"
		bodyClass="space-y-4"
	>
		<div class="grid gap-4 md:grid-cols-2">
			<FieldShell class="space-y-1.5">
				<FieldLabel for="project-structure-node-name">Name</FieldLabel>
				<Input
					id="project-structure-node-name"
					bind:value={nodeFormValues.name}
					size="sm"
					invalidTone={getFieldInvalidTone(nodeFieldErrors.name)}
					placeholder="e.g. Workshop"
				/>
				<FieldError errors={nodeFieldErrors.name} />
			</FieldShell>
			<FieldShell class="space-y-1.5">
				<FieldLabel for="project-structure-node-code">Code</FieldLabel>
				<Input
					id="project-structure-node-code"
					bind:value={nodeFormValues.code}
					size="sm"
					placeholder="Optional code"
				/>
			</FieldShell>
		</div>
		<div class="grid gap-4 md:grid-cols-2">
			<FieldShell class="space-y-1.5">
				<FieldLabel for="project-structure-node-type">Type</FieldLabel>
				<Select.Root
					type="single"
					value={nodeFormValues.type}
					onValueChange={(value) => {
						nodeFormValues.type = value as WbsNodeFormValues['type'];
					}}
				>
					<Select.Trigger id="project-structure-node-type" size="sm" class="w-full">
						{WBS_NODE_TYPE_OPTIONS.find((option) => option.value === nodeFormValues.type)?.label ??
							'Type'}
					</Select.Trigger>
					<Select.Content>
						{#each WBS_NODE_TYPE_OPTIONS as option (option.value)}
							<Select.Item value={option.value}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</FieldShell>
			<FieldShell class="space-y-1.5">
				<FieldLabel for="project-structure-node-order">Sort Order</FieldLabel>
				<Input
					id="project-structure-node-order"
					bind:value={nodeSortOrderInput}
					size="sm"
					invalidTone={getFieldInvalidTone(nodeFieldErrors.sort_order)}
					placeholder="0"
				/>
				<FieldError errors={nodeFieldErrors.sort_order} />
			</FieldShell>
		</div>
		<FieldShell class="space-y-1.5">
			<FieldLabel for="project-structure-node-parent">Parent Node</FieldLabel>
			<Select.Root
				type="single"
				value={nodeParentValue}
				onValueChange={(value) => {
					nodeParentValue = value;
				}}
			>
				<Select.Trigger id="project-structure-node-parent" size="sm" class="w-full">
					{nodeParentValue === '__none__'
						? 'Top-level'
						: (parentOptions.find((item) => item.id === nodeParentValue)?.name ?? 'Top-level')}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="__none__">Top-level</Select.Item>
					{#each parentOptions as option (option.id)}
						<Select.Item value={option.id}>{option.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</FieldShell>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (nodeDialogOpen = false)}>Cancel</Button>
			<Button onclick={saveNode}>Save Node</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteNodeOpen}>
	<AlertDialog.Content class="ui-dialog-size-xs">
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Structure Node?</AlertDialog.Title>
			<AlertDialog.Description>
				This removes the selected node and any child nodes beneath it from this template.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				onclick={() => {
					nodeToDelete = null;
					deleteNodeOpen = false;
				}}
			>
				Cancel
			</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				onclick={() => nodeToDelete && deleteNodeAndDescendants(nodeToDelete.id)}
			>
				Delete Node
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
