import { tv, type VariantProps } from 'tailwind-variants';

export const sidebarMenuButtonVariants = tv({
	base: 'ui-sidebar-nav-button shell-nav-copy ui-shell-nav-tone ui-shell-nav-row ui-sidebar-item-radius peer/menu-button ring-sidebar-ring hover-surface-sidebar-accent hover:text-sidebar-accent-foreground flex w-full overflow-visible text-start outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pe-8 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-foreground/70',
	variants: {
		variant: {
			default: '',
			outline: 'field-surface border border-sidebar-border'
		},
		size: {
			default: 'min-h-9',
			sm: 'control-copy-sm min-h-7 py-1',
			lg: 'h-12 control-copy group-data-[collapsible=icon]:p-0!'
		}
	},
	defaultVariants: {
		variant: 'default',
		size: 'default'
	}
});

export type SidebarMenuButtonVariant = VariantProps<typeof sidebarMenuButtonVariants>['variant'];
export type SidebarMenuButtonSize = VariantProps<typeof sidebarMenuButtonVariants>['size'];
