<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import SparkleIcon from '@lucide/svelte/icons/sparkle';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { FieldError, Meta, Text } from '$lib/components/primitives/index.js';
	import { aiState } from '$lib/state/ai.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';

	interface Props {
		showRemove?: boolean;
		compact?: boolean;
	}

	let { showRemove = false, compact = false }: Props = $props();
	let localActionBusy = $state(false);

	const localAiReady = $derived(
		aiState.localAiStatus.installState === 'ready' &&
			aiState.localAiStatus.modelReady &&
			!aiState.localAiStatus.lastError
	);
	const localAiInstalled = $derived(
		(aiState.localAiStatus.installState === 'installed' || localAiReady) &&
			!aiState.localAiStatus.lastError
	);
	const hasLocalModel = $derived(
		aiState.localAiStatus.installState !== 'not_downloaded' &&
			aiState.localAiStatus.installState !== 'downloading' &&
			aiState.localAiStatus.installState !== 'verifying'
	);
	const localAiNeedsRepair = $derived(
		aiState.localAiStatus.installState === 'repair_needed' ||
			aiState.localAiStatus.installState === 'failed'
	);
	const localAiPreparing = $derived(
		aiState.localAiStatus.installState === 'downloading' ||
			aiState.localAiStatus.installState === 'verifying' ||
			aiState.localAiStatus.installState === 'loading'
	);
	const localAiDownloading = $derived(aiState.localAiStatus.installState === 'downloading');
	const canCancelLocalAiDownload = $derived(
		localAiDownloading ||
			(aiState.localAiStatus.installState === 'verifying' &&
				Boolean(aiState.localAiStatus.activeDownload))
	);
	const showLocalDownloadProgress = $derived.by(() => {
		if (!canCancelLocalAiDownload) return false;
		const activeDownload = aiState.localAiStatus.activeDownload;
		if (!activeDownload) return false;
		return (activeDownload.totalBytes ?? 0) > 0 && (activeDownload.downloadedBytes ?? 0) > 0;
	});
	const downloadPercent = $derived.by(() => {
		const activeDownload = aiState.localAiStatus.activeDownload;
		if (!activeDownload?.totalBytes) return 0;
		return Math.min(
			100,
			Math.round(((activeDownload.downloadedBytes ?? 0) / activeDownload.totalBytes) * 100)
		);
	});
	const statusText = $derived.by(() => {
		if (aiState.localAiStatus.installState === 'unsupported') return 'Not available on this device';
		if (localAiNeedsRepair) return 'Needs attention';
		if (localAiPreparing) return 'Preparing Kwantflow AI';
		if (localAiReady) return 'Ready on this device';
		if (localAiInstalled) return 'Downloaded on this device';
		return 'Not downloaded';
	});

	const statusVariant = $derived.by((): BadgeVariant => {
		if (localAiInstalled) return 'success';
		if (localAiPreparing) return 'brand';
		if (localAiNeedsRepair) return 'destructive';
		if (aiState.localAiStatus.installState === 'unsupported') return 'secondary';
		return 'brand';
	});

	const primaryLabel = $derived.by(() => {
		if (localAiPreparing) return compact ? 'Preparing' : 'Preparing Kwantflow AI';
		if (localAiNeedsRepair) return compact ? 'Retry' : 'Retry Kwantflow AI';
		if (localAiReady) return compact ? 'Check' : 'Verify Kwantflow AI';
		if (localAiInstalled) return compact ? 'Check' : 'Check Kwantflow AI install';
		if (aiState.localAiStatus.installState === 'unsupported') {
			return compact ? 'Unavailable' : 'Kwantflow AI unavailable';
		}
		return compact ? 'Download' : 'Download Kwantflow AI';
	});
	const downloadWeightLabel = $derived.by(() => {
		return formatDownloadSize(aiState.localAiStatus.expectedDownloadBytes);
	});
	const supportingCopy = $derived.by(() => {
		if (localAiReady) {
			return compact
				? 'Ready for on-device drafting.'
				: 'Ready for local estimate drafts and local help.';
		}
		if (localAiInstalled) {
			return compact ? 'Ready when needed.' : 'Downloaded and ready to load when needed.';
		}
		if (localAiPreparing)
			return compact
				? canCancelLocalAiDownload
					? `${aiState.localAiStatus.activeDownload?.label ?? 'Downloading'} · ${downloadWeightLabel}`
					: 'Preparing'
				: canCancelLocalAiDownload
					? `${aiState.localAiStatus.activeDownload?.label ?? 'Downloading Kwantflow AI'} · ${downloadWeightLabel}`
					: 'Preparing Kwantflow AI';
		if (localAiNeedsRepair) {
			return compact
				? 'Finish setup for on-device drafting.'
				: 'Repair Kwantflow AI to resume on-device drafting.';
		}
		if (aiState.localAiStatus.installState === 'unsupported') {
			return 'Manual estimating remains available on this device.';
		}
		return `${downloadWeightLabel} one-time download. Internet needed for setup; use offline afterward.`;
	});

	function formatDownloadSize(bytes: number | null | undefined): string {
		if (!Number.isFinite(bytes) || (bytes ?? 0) <= 0) return '0 MB';
		const safeBytes = Math.max(bytes ?? 0, 0);
		const gigabytes = safeBytes / 1_000_000_000;
		if (gigabytes >= 1) return `${gigabytes.toFixed(gigabytes >= 10 ? 0 : 1)} GB`;
		const megabytes = safeBytes / 1_000_000;
		return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`;
	}

	async function handlePrimaryAction(): Promise<void> {
		if (localAiPreparing || aiState.localAiStatus.installState === 'unsupported') return;
		localActionBusy = true;
		try {
			if (localAiInstalled) {
				await aiState.verifyLocalAiInstall();
				return;
			}
			void aiState
				.downloadLocalAiModel()
				.catch((error) => errorState.catchError(error, 'Download Kwantflow AI'));
		} catch (error) {
			await errorState.catchError(error, 'Manage Kwantflow AI');
		} finally {
			localActionBusy = false;
		}
	}

	async function handleCancelDownload(): Promise<void> {
		localActionBusy = true;
		try {
			await aiState.cancelLocalAiDownload();
		} catch (error) {
			await errorState.catchError(error, 'Cancel Kwantflow AI download');
		} finally {
			localActionBusy = false;
		}
	}

	let removeConfirmOpen = $state(false);

	function promptRemove(): void {
		removeConfirmOpen = true;
	}

	async function confirmRemove(): Promise<void> {
		removeConfirmOpen = false;
		localActionBusy = true;
		try {
			await aiState.removeLocalAiModel();
		} catch (error) {
			await errorState.catchError(error, 'Remove Kwantflow AI');
		} finally {
			localActionBusy = false;
		}
	}
</script>

<div
	class={compact
		? 'ui-choice-card ui-choice-card-neutral flex-col items-stretch gap-2'
		: 'ui-choice-card ui-choice-card-neutral flex-col items-stretch gap-4'}
>
	<div class={compact ? 'flex w-full min-w-0 items-center gap-3' : 'flex w-full items-start gap-3'}>
		<div
			class={compact
				? 'flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15'
				: 'ui-note-panel ui-note-panel-tight shrink-0'}
		>
			{#if localAiInstalled}
				<CheckIcon class="size-4 text-success" />
			{:else if localAiPreparing}
				<div
					class="size-4 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground"
				></div>
			{:else}
				<SparkleIcon class="muted size-4" strokeWidth={1.5} />
			{/if}
		</div>
		<div class={compact ? 'min-w-0 flex-1' : 'min-w-0 flex-1 space-y-1'}>
			<div
				class={compact
					? 'flex min-w-0 items-center gap-2'
					: 'flex items-center justify-between gap-3'}
			>
				<Text class={compact ? 'shrink-0' : undefined}>Kwantflow AI</Text>
				{#if !compact}
					<Badge variant={statusVariant}>{statusText}</Badge>
				{/if}
			</div>
			<Meta class={compact ? 'mt-0.5' : undefined}>{supportingCopy}</Meta>
		</div>
		{#if compact}
			<div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
				{#if canCancelLocalAiDownload}
					<Button
						variant="secondary"
						size="sm"
						class="h-8 gap-2"
						disabled={localActionBusy}
						onclick={handleCancelDownload}
					>
						Cancel
					</Button>
				{/if}
				{#if showRemove && hasLocalModel}
					<Button
						variant="destructiveSoft"
						size="sm"
						class="h-8 gap-2"
						disabled={localActionBusy || localAiPreparing}
						onclick={promptRemove}
					>
						<Trash2Icon class="size-3.5" />
						Remove
					</Button>
				{/if}
				<Button
					size="sm"
					class="h-8 gap-2"
					loading={localActionBusy || (localAiPreparing && !showLocalDownloadProgress)}
					loadingLabel={localAiPreparing ? 'Preparing Kwantflow AI' : 'Checking Kwantflow AI'}
					disabled={localAiPreparing || aiState.localAiStatus.installState === 'unsupported'}
					onclick={() => void handlePrimaryAction()}
				>
					{primaryLabel}
				</Button>
			</div>
		{/if}
	</div>

	{#if !compact}
		<div class="grid gap-2 sm:grid-cols-3">
			<div class="ui-note-panel ui-note-panel-tight">
				<Text>Draft with AI</Text>
				<Meta class="mt-1">Turn project evidence into editable estimate drafts.</Meta>
			</div>
			<div class="ui-note-panel ui-note-panel-tight">
				<Text>Assistant support</Text>
				<Meta class="mt-1">Use local help once Kwantflow AI is ready.</Meta>
			</div>
			<div class="ui-note-panel ui-note-panel-tight">
				<Text>{formatDownloadSize(aiState.localAiStatus.expectedDownloadBytes)}</Text>
				<Meta class="mt-1">One device download.</Meta>
			</div>
		</div>
	{/if}

	{#if !localAiInstalled && aiState.localAiStatus.installState !== 'unsupported'}
		<Meta
			>Allow {formatDownloadSize(
				Math.ceil((aiState.localAiStatus.expectedDownloadBytes + 64 * 1024 * 1024) / 100_000_000) *
					100_000_000
			)} free disk space for setup. Interrupted downloads can be retried.</Meta
		>
	{/if}

	{#if showLocalDownloadProgress && aiState.localAiStatus.activeDownload}
		<div class="w-full space-y-2">
			<div class="flex items-center justify-between gap-3">
				<Meta>
					{formatDownloadSize(aiState.localAiStatus.activeDownload.downloadedBytes)} of
					{formatDownloadSize(aiState.localAiStatus.activeDownload.totalBytes)}
				</Meta>
				<Meta>{downloadPercent}%</Meta>
			</div>
			<div class="ui-progress-root ui-progress-download">
				<div
					class="ui-progress-indicator"
					style:transform={`translateX(-${100 - downloadPercent}%)`}
				></div>
			</div>
		</div>
	{/if}

	{#if aiState.localAiStatus.lastError}
		<FieldError errors={[aiState.localAiStatus.lastError]} />
	{/if}

	{#if !compact}
		<div class="flex flex-wrap items-center justify-end gap-2">
			{#if canCancelLocalAiDownload}
				<Button
					variant="secondary"
					size="sm"
					class="h-8 gap-2"
					disabled={localActionBusy}
					onclick={handleCancelDownload}
				>
					Cancel
				</Button>
			{/if}
			{#if showRemove && hasLocalModel}
				<Button
					variant="destructiveSoft"
					size="sm"
					class="h-8 gap-2"
					disabled={localActionBusy || localAiPreparing}
					onclick={promptRemove}
				>
					<Trash2Icon class="size-3.5" />
					Remove
				</Button>
			{/if}
			<Button
				size="sm"
				class="h-8 gap-2"
				loading={localActionBusy || (localAiPreparing && !showLocalDownloadProgress)}
				loadingLabel={localAiPreparing ? 'Preparing Kwantflow AI' : 'Checking Kwantflow AI'}
				disabled={localAiPreparing || aiState.localAiStatus.installState === 'unsupported'}
				onclick={() => void handlePrimaryAction()}
			>
				{primaryLabel}
			</Button>
		</div>
	{/if}
</div>

<AlertDialog.Root bind:open={removeConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove Kwantflow AI?</AlertDialog.Title>
			<AlertDialog.Description>
				This will delete the local AI model from this device. You will need to download it again to
				use on-device AI features.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (removeConfirmOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => void confirmRemove()}
				disabled={localActionBusy}
				variant="destructiveSoft"
			>
				{localActionBusy ? 'Removing...' : 'Remove'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
