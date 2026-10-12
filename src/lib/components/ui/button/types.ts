import { type WithElementRef } from '$lib/utils.js';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
import { type VariantProps, tv } from 'tailwind-variants';

export const buttonVariants = tv({
	base: 'ui-button-radius focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center whitespace-nowrap overflow-hidden border transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
	variants: {
		variant: {
			default: 'ui-button-neutral hover-surface-subtle border-transparent',
			filled:
				'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
			brand:
				'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
			destructive:
				'action-destructive border-transparent focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
			destructiveSoft:
				'bg-destructive/10 border-transparent text-destructive hover:bg-destructive/16 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
			outline: 'ui-button-outline border-transparent hover:bg-accent hover:text-accent-foreground',
			secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border-transparent',
			ghost: 'border-transparent hover:bg-accent hover:text-accent-foreground',
			link: 'border-transparent text-primary underline-offset-4 hover:underline'
		},
		size: {
			default: 'control-copy ui-button-size-default',
			xs: 'control-copy-xs ui-button-size-xs',
			sm: 'control-copy-sm ui-button-size-sm',
			lg: 'control-copy-lg ui-button-size-lg',
			icon: 'control-copy size-8 gap-0 px-0',
			'icon-sm': 'control-copy-sm size-7 gap-0 px-0',
			'icon-xs': 'control-copy-xs size-6 gap-0 px-0',
			'icon-lg': 'control-copy-lg size-9 gap-0 px-0'
		}
	},
	defaultVariants: {
		variant: 'default',
		size: 'default'
	}
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
	WithElementRef<HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		loading?: boolean;
		loadingLabel?: string;
	};
