import Root from './alert.svelte';
import Title from './alert-title.svelte';
import Description from './alert-description.svelte';
import { alertVariants } from './types.js';
import type { AlertVariant } from './types.js';

export {
	Root,
	Title,
	Description,
	//
	Root as Alert,
	alertVariants
};

export type { AlertVariant };
