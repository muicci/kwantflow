import { tv, type VariantProps } from 'tailwind-variants';

export const sheetVariants = tv({
	base: 'ui-sheet-surface data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
	variants: {
		side: {
			top: 'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
			bottom:
				'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
			left: 'data-[state=closed]:slide-out-to-start data-[state=open]:slide-in-from-start inset-y-0 start-0 h-full w-3/4 border-e ui-sheet-size-md',
			right:
				'data-[state=closed]:slide-out-to-end data-[state=open]:slide-in-from-end inset-y-0 end-0 h-full w-3/4 border-s ui-sheet-size-md'
		}
	},
	defaultVariants: {
		side: 'right'
	}
});

export type Side = VariantProps<typeof sheetVariants>['side'];
