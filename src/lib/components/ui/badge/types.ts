import { type VariantProps, tv } from 'tailwind-variants';

export const badgeVariants = tv({
	base: 'badge-label focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex min-h-5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden ui-radius-pill border px-2.5 py-0.5 whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] [&>svg]:pointer-events-none [&>svg]:size-3.5',
	variants: {
		variant: {
			default: 'ui-badge-neutral [a&]:hover:bg-secondary/84',
			success: 'status-badge-success border-transparent',
			premium: 'status-badge-premium border-transparent',
			brand: 'status-badge-brand border-transparent',
			secondary:
				'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90 border-transparent',
			destructive:
				'bg-destructive [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/70 border-transparent text-destructive-foreground',
			outline: 'ui-badge-outline [a&]:hover:bg-accent [a&]:hover:text-accent-foreground'
		}
	},
	defaultVariants: {
		variant: 'default'
	}
});

export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
