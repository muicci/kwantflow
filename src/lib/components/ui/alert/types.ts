import { tv } from 'tailwind-variants';

export const alertVariants = tv({
	base: 'ui-radius-md ui-alert-padding grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 border [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0',
	variants: {
		variant: {
			default: 'ui-alert-surface',
			warning: 'status-badge-warning [&>svg]:text-current',
			destructive: 'status-badge-destructive [&>svg]:text-current',
			success: 'status-badge-success [&>svg]:text-current'
		}
	},
	defaultVariants: {
		variant: 'default'
	}
});

export type AlertVariant = 'default' | 'warning' | 'destructive' | 'success';
