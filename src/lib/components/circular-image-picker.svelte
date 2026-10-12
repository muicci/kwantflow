<script lang="ts">
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { cn } from '$lib/utils.js';

	interface Props {
		alt: string;
		initials: string;
		variant?: 'avatar' | 'logo';
		previewUrl?: string;
		disabled?: boolean;
		pending?: boolean;
		clearLabel?: string;
		pickLabel?: string;
		changeLabel?: string;
		helperText?: string;
		showActions?: boolean;
		class?: string;
		onPick: () => void | Promise<void>;
		onClear?: () => void | Promise<void>;
	}

	let {
		alt,
		initials,
		variant = 'avatar',
		previewUrl = '',
		disabled = false,
		pending = false,
		clearLabel = 'Clear image',
		pickLabel = 'Choose image',
		changeLabel = 'Change image',
		helperText = '',
		showActions = false,
		class: className,
		onPick,
		onClear
	}: Props = $props();

	const pickerLabel = $derived(previewUrl || pending ? changeLabel : pickLabel);
	const pickerWrapperClass = $derived(
		variant === 'logo' ? 'ui-image-picker-shell-logo' : 'ui-image-picker-shell-avatar'
	);
	const pickerTriggerClass = $derived(
		variant === 'logo' ? 'ui-image-picker-trigger-logo' : 'ui-image-picker-trigger-avatar'
	);
	const pickerFallbackClass = $derived(
		variant === 'logo' ? 'ui-image-picker-fallback-logo' : 'ui-image-picker-fallback-avatar'
	);
	const pickerImageClass = $derived(
		variant === 'logo' ? 'ui-image-picker-image-logo' : 'ui-image-picker-image-avatar'
	);
</script>

<div
	class={cn(
		'group flex shrink-0 gap-2',
		showActions ? 'flex-row items-start gap-3' : 'flex-col',
		className
	)}
>
	<div class={cn('relative flex', pickerWrapperClass)}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						type="button"
						class={cn(
							'ui-image-picker-trigger disabled:pointer-events-none disabled:opacity-60',
							pickerTriggerClass
						)}
						{...props}
						onclick={onPick}
						{disabled}
						aria-busy={pending}
						aria-label={pickerLabel}
					>
						{#if previewUrl}
							<img
								src={previewUrl}
								{alt}
								class={cn('ui-image-picker-image', pickerImageClass)}
								loading="lazy"
								decoding="async"
							/>
						{:else}
							<span class={cn('ui-image-picker-fallback', pickerFallbackClass)}>
								<span class="h3">{initials}</span>
							</span>
						{/if}
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content sideOffset={6}>{pickerLabel}</Tooltip.Content>
		</Tooltip.Root>

		{#if !showActions && onClear && (previewUrl || pending)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							type="button"
							variant="secondary"
							size="icon"
							class="ui-radius-pill ui-image-picker-clear absolute top-0 right-0 z-10 size-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
							{...props}
							onclick={(event) => {
								event.stopPropagation();
								void onClear?.();
							}}
							aria-label={clearLabel}
						>
							<Trash2Icon class="size-3.5" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content sideOffset={6}>{clearLabel}</Tooltip.Content>
			</Tooltip.Root>
		{/if}
	</div>

	{#if showActions}
		<div class="flex flex-col gap-1.5">
			<div class="flex flex-wrap items-center gap-2">
				<Button type="button" variant="secondary" size="sm" class="h-8" onclick={onPick} {disabled}
					>{pickerLabel}</Button
				>
				{#if onClear && (previewUrl || pending)}
					<Button
						type="button"
						variant="secondary"
						size="sm"
						class="h-8"
						onclick={() => void onClear?.()}
						{disabled}
					>
						{clearLabel}
					</Button>
				{/if}
			</div>
			{#if helperText}
				<p class="field-help max-w-48">{helperText}</p>
			{/if}
		</div>
	{/if}
</div>
