<script lang="ts">
	import { untrack } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { Input } from '$lib/components/ui/input/index.js';
	import { formatPhoneDraft } from '$lib/services/phone.js';

	type Props = Omit<
		HTMLInputAttributes,
		'value' | 'oninput' | 'type' | 'inputmode' | 'autocomplete' | 'files' | 'size'
	> & {
		value?: string;
		countryCode?: string | null | undefined;
		size?: 'xs' | 'sm' | 'default' | 'lg';
		invalidTone?: 'neutral' | 'destructive';
		oninput?: ((event: Event) => void) | undefined;
		ref?: HTMLInputElement | null;
	};

	let {
		ref = $bindable(null),
		value = $bindable(''),
		countryCode = 'AU',
		size = 'default',
		invalidTone,
		class: className,
		placeholder = 'Phone number',
		oninput,
		...restProps
	}: Props = $props();

	function handleInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const formattedValue = formatPhoneDraft(input.value, countryCode);
		value = formattedValue;
		input.value = formattedValue;
		oninput?.(event);
	}

	$effect(() => {
		const currentValue = value;
		const formattedValue = formatPhoneDraft(
			currentValue,
			untrack(() => countryCode)
		);
		if (formattedValue !== currentValue) {
			value = formattedValue;
			if (ref) {
				ref.value = formattedValue;
			}
		}
	});
</script>

<Input
	bind:ref
	{value}
	class={className}
	{size}
	{invalidTone}
	{placeholder}
	type="tel"
	inputmode="tel"
	autocomplete="tel"
	oninput={handleInput}
	{...restProps}
/>
