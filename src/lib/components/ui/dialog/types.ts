import type { Component } from 'svelte';

export type DialogRailItem = {
	id: string;
	name: string;
	icon: Component<{ class?: string; strokeWidth?: number }>;
};
