/* Generated from tokens/*.json. Do not edit by hand. */
export const designPrimitives = {
	$description: "Primitive design tokens that back Kwantflow's owned desktop design system.",
	font: {
		sans: {
			type: 'fontFamily',
			value: [
				'Inter',
				'ui-sans-serif',
				'system-ui',
				'sans-serif',
				'Apple Color Emoji',
				'Segoe UI Emoji',
				'Segoe UI Symbol',
				'Noto Color Emoji'
			],
			description: 'Default application UI font stack.'
		},
		display: {
			type: 'fontFamily',
			value: [
				'SF Pro Display',
				'Avenir Next',
				'Segoe UI Variable Display',
				'Inter',
				'ui-sans-serif',
				'system-ui',
				'sans-serif',
				'Apple Color Emoji',
				'Segoe UI Emoji',
				'Segoe UI Symbol',
				'Noto Color Emoji'
			],
			description: 'Display-oriented desktop title stack.'
		}
	},
	color: {
		neutral: {
			'50': {
				type: 'color',
				value: '#f6f8fb',
				description: 'Lightest neutral surface.'
			},
			'100': {
				type: 'color',
				value: '#eef2f7',
				description: 'Soft neutral surface.'
			},
			'200': {
				type: 'color',
				value: '#dde4ee',
				description: 'Muted neutral border/surface.'
			},
			'300': {
				type: 'color',
				value: '#bdcad9',
				description: 'Quiet neutral border.'
			},
			'400': {
				type: 'color',
				value: '#97a8bc',
				description: 'Quiet neutral metadata.'
			},
			'500': {
				type: 'color',
				value: '#708197',
				description: 'Muted neutral text.'
			},
			'600': {
				type: 'color',
				value: '#56657a',
				description: 'Secondary neutral text.'
			},
			'700': {
				type: 'color',
				value: '#3d495a',
				description: 'Strong neutral text.'
			},
			'800': {
				type: 'color',
				value: '#262f3c',
				description: 'Dark shell neutral.'
			},
			'900': {
				type: 'color',
				value: '#161c24',
				description: 'Primary dark text.'
			},
			'950': {
				type: 'color',
				value: '#000000',
				description: 'Deepest neutral.'
			}
		},
		darkSurface: {
			background: {
				type: 'color',
				value: '#212121',
				description: 'Softer dark-mode application background.'
			},
			shell: {
				type: 'color',
				value: '#242424',
				description: 'Softer dark-mode shell surface.'
			},
			panel: {
				type: 'color',
				value: '#262626',
				description: 'Softer dark-mode field and lower panel surface.'
			},
			secondary: {
				type: 'color',
				value: '#2a2a2a',
				description: 'Softer dark-mode secondary surface.'
			},
			muted: {
				type: 'color',
				value: '#2b2b2b',
				description: 'Softer dark-mode muted surface.'
			},
			selected: {
				type: 'color',
				value: '#2f2f2f',
				description: 'Softer dark-mode selected surface.'
			},
			strong: {
				type: 'color',
				value: '#303030',
				description: 'Softer dark-mode raised card surface.'
			},
			hover: {
				type: 'color',
				value: '#343434',
				description: 'Softer dark-mode hover surface.'
			}
		},
		darkText: {
			muted: {
				type: 'color',
				value: '#afafaf',
				description: 'Softer dark-mode secondary text.'
			}
		},
		blue: {
			'50': {
				type: 'color',
				value: '#f0f7ff',
				description: 'Lightest accent blue.'
			},
			'100': {
				type: 'color',
				value: '#deefff',
				description: 'Soft accent blue.'
			},
			'200': {
				type: 'color',
				value: '#b8ddff',
				description: 'Muted accent blue.'
			},
			'300': {
				type: 'color',
				value: '#83c4ff',
				description: 'Soft interactive blue.'
			},
			'400': {
				type: 'color',
				value: '#46acff',
				description: 'Bright interactive blue.'
			},
			'500': {
				type: 'color',
				value: '#007aff',
				description: 'Primary brand/action blue.'
			},
			'600': {
				type: 'color',
				value: '#0077e6',
				description: 'Pressed brand blue.'
			},
			'700': {
				type: 'color',
				value: '#005dc0',
				description: 'Strong blue contrast.'
			},
			'800': {
				type: 'color',
				value: '#0a468e',
				description: 'Dark blue emphasis.'
			},
			'900': {
				type: 'color',
				value: '#11335f',
				description: 'Deep blue contrast.'
			},
			'950': {
				type: 'color',
				value: '#091c35',
				description: 'Darkest blue.'
			}
		},
		error: {
			'50': {
				type: 'color',
				value: '#fff0f4',
				description: 'Lightest destructive surface.'
			},
			'100': {
				type: 'color',
				value: '#ffd9e4',
				description: 'Soft destructive surface.'
			},
			'200': {
				type: 'color',
				value: '#ffb0c6',
				description: 'Muted destructive surface.'
			},
			'300': {
				type: 'color',
				value: '#ff7b9e',
				description: 'Soft destructive emphasis.'
			},
			'400': {
				type: 'color',
				value: '#ff4f7d',
				description: 'Bright destructive accent.'
			},
			'500': {
				type: 'color',
				value: '#ff2b60',
				description: 'Default destructive accent.'
			},
			'600': {
				type: 'color',
				value: '#ea144e',
				description: 'Pressed destructive accent.'
			},
			'700': {
				type: 'color',
				value: '#bf0f40',
				description: 'Strong destructive text.'
			},
			'800': {
				type: 'color',
				value: '#981039',
				description: 'Dark destructive text.'
			},
			'900': {
				type: 'color',
				value: '#7f1235',
				description: 'Deep destructive text.'
			},
			'950': {
				type: 'color',
				value: '#4c071c',
				description: 'Darkest destructive tone.'
			}
		},
		success: {
			'50': {
				type: 'color',
				value: '#ebfff8',
				description: 'Lightest success surface.'
			},
			'100': {
				type: 'color',
				value: '#cffff0',
				description: 'Soft success surface.'
			},
			'200': {
				type: 'color',
				value: '#9afee0',
				description: 'Muted success surface.'
			},
			'300': {
				type: 'color',
				value: '#59f5c6',
				description: 'Soft success emphasis.'
			},
			'400': {
				type: 'color',
				value: '#24e3ad',
				description: 'Bright success accent.'
			},
			'500': {
				type: 'color',
				value: '#00c78f',
				description: 'Default success accent.'
			},
			'600': {
				type: 'color',
				value: '#00a574',
				description: 'Pressed success accent.'
			},
			'700': {
				type: 'color',
				value: '#00835d',
				description: 'Strong success text.'
			},
			'800': {
				type: 'color',
				value: '#05684b',
				description: 'Dark success text.'
			},
			'900': {
				type: 'color',
				value: '#0b553f',
				description: 'Deep success text.'
			},
			'950': {
				type: 'color',
				value: '#032f23',
				description: 'Darkest success tone.'
			}
		},
		warning: {
			'50': {
				type: 'color',
				value: '#fff8eb',
				description: 'Lightest warning surface.'
			},
			'100': {
				type: 'color',
				value: '#ffefc8',
				description: 'Soft warning surface.'
			},
			'200': {
				type: 'color',
				value: '#ffdd8a',
				description: 'Muted warning surface.'
			},
			'300': {
				type: 'color',
				value: '#ffc54c',
				description: 'Soft warning emphasis.'
			},
			'400': {
				type: 'color',
				value: '#ffb020',
				description: 'Bright warning accent.'
			},
			'500': {
				type: 'color',
				value: '#ff9700',
				description: 'Default warning accent.'
			},
			'600': {
				type: 'color',
				value: '#ea7b00',
				description: 'Pressed warning accent.'
			},
			'700': {
				type: 'color',
				value: '#c25d00',
				description: 'Strong warning text.'
			},
			'800': {
				type: 'color',
				value: '#9a4708',
				description: 'Dark warning text.'
			},
			'900': {
				type: 'color',
				value: '#7c3a0d',
				description: 'Deep warning text.'
			},
			'950': {
				type: 'color',
				value: '#472003',
				description: 'Darkest warning tone.'
			}
		}
	},
	space: {
		'1': {
			type: 'dimension',
			value: '0.25rem',
			description: '4px grid step.'
		},
		'2': {
			type: 'dimension',
			value: '0.5rem',
			description: '8px grid step.'
		},
		'3': {
			type: 'dimension',
			value: '0.75rem',
			description: '12px grid step.'
		},
		'4': {
			type: 'dimension',
			value: '1rem',
			description: '16px grid step.'
		},
		'5': {
			type: 'dimension',
			value: '1.25rem',
			description: '20px grid step.'
		},
		'6': {
			type: 'dimension',
			value: '1.5rem',
			description: '24px grid step.'
		},
		'8': {
			type: 'dimension',
			value: '2rem',
			description: '32px grid step.'
		},
		'10': {
			type: 'dimension',
			value: '2.5rem',
			description: '40px grid step.'
		},
		'12': {
			type: 'dimension',
			value: '3rem',
			description: '48px grid step.'
		},
		'16': {
			type: 'dimension',
			value: '4rem',
			description: '64px grid step.'
		},
		'1.5': {
			type: 'dimension',
			value: '0.375rem',
			description: '6px grid step.'
		}
	},
	radius: {
		xs: {
			type: 'dimension',
			value: '0.1875rem',
			description: 'Tight micro radius.'
		},
		tight: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Dense menu and utility radius.'
		},
		base: {
			type: 'dimension',
			value: '0.75rem',
			description: 'Soft floating-shell radius.'
		},
		md: {
			type: 'dimension',
			value: 'calc(var(--radius-base) - 2px)',
			description: 'Standard surface radius.'
		},
		sm: {
			type: 'dimension',
			value: 'calc(var(--radius-base) - 4px)',
			description: 'Standard control radius.'
		},
		lg: {
			type: 'dimension',
			value: 'var(--radius-base)',
			description: 'Floating shell radius.'
		},
		pill: {
			type: 'dimension',
			value: '999px',
			description: 'Fully rounded pill/circle radius.'
		}
	},
	size: {
		control: {
			xs: {
				type: 'dimension',
				value: '1.5rem',
				description: 'Micro control height.'
			},
			sm: {
				type: 'dimension',
				value: '1.75rem',
				description: 'Compact control height.'
			},
			md: {
				type: 'dimension',
				value: '2rem',
				description: 'Default control height.'
			},
			lg: {
				type: 'dimension',
				value: '2.25rem',
				description: 'Large control height.'
			}
		},
		dialog: {
			compact: {
				type: 'dimension',
				value: '26.5625rem',
				description: 'Compact dialog width.'
			},
			xs: {
				type: 'dimension',
				value: '28rem',
				description: 'Extra-small dialog width.'
			},
			alert: {
				type: 'dimension',
				value: '28.125rem',
				description: 'Alert dialog width.'
			},
			sm: {
				type: 'dimension',
				value: '30rem',
				description: 'Small dialog width.'
			},
			md: {
				type: 'dimension',
				value: '32.5rem',
				description: 'Medium dialog width.'
			},
			lg: {
				type: 'dimension',
				value: '35rem',
				description: 'Large dialog width.'
			},
			xl: {
				type: 'dimension',
				value: '43.75rem',
				description: 'Extra-large dialog width.'
			},
			'2xl': {
				type: 'dimension',
				value: '47.5rem',
				description: '2xl dialog width.'
			},
			'3xl': {
				type: 'dimension',
				value: '48rem',
				description: '3xl dialog width.'
			},
			'4xl': {
				type: 'dimension',
				value: '56rem',
				description: '4xl dialog width.'
			},
			setupSm: {
				type: 'dimension',
				value: '48rem',
				description: 'Setup wizard compact width.'
			},
			setupLg: {
				type: 'dimension',
				value: '72rem',
				description: 'Setup wizard wide width.'
			},
			editorHeight: {
				type: 'dimension',
				value: 'min(440px, 68vh)',
				description: 'Compact editor dialog height.'
			},
			setupHeight: {
				type: 'dimension',
				value: 'min(90vh, 960px)',
				description: 'Setup wizard max height.'
			},
			setupCompactHeight: {
				type: 'dimension',
				value: 'min(85vh, 720px)',
				description: 'Setup wizard compact max height.'
			}
		},
		sheet: {
			md: {
				type: 'dimension',
				value: '28rem',
				description: 'Standard sheet width.'
			},
			lg: {
				type: 'dimension',
				value: '18rem',
				description: 'Compact shell sheet width.'
			}
		},
		popover: {
			sm: {
				type: 'dimension',
				value: '18rem',
				description: 'Small popover width.'
			},
			md: {
				type: 'dimension',
				value: '22rem',
				description: 'Medium popover width.'
			},
			lg: {
				type: 'dimension',
				value: '24rem',
				description: 'Large popover width.'
			},
			xl: {
				type: 'dimension',
				value: '26rem',
				description: 'Extra-large popover width.'
			}
		},
		menu: {
			sm: {
				type: 'dimension',
				value: '11.25rem',
				description: 'Small menu width.'
			},
			md: {
				type: 'dimension',
				value: '12.5rem',
				description: 'Medium menu width.'
			}
		},
		rail: {
			md: {
				type: 'dimension',
				value: '13rem',
				description: 'Workspace/context rail width.'
			},
			sidebarFloatingIconWidth: {
				type: 'dimension',
				value: 'calc(var(--sidebar-width-icon) + var(--space-4) + 2px)',
				description: 'Floating sidebar icon width.'
			}
		},
		bubble: {
			md: {
				type: 'dimension',
				value: '18rem',
				description: 'Assistant/task bubble width.'
			}
		},
		pane: {
			asideMd: {
				type: 'dimension',
				value: '24rem',
				description: 'Medium aside pane width.'
			},
			asideLg: {
				type: 'dimension',
				value: 'min(34vw, 30rem)',
				description: 'Large aside pane width.'
			}
		},
		field: {
			widthSm: {
				type: 'dimension',
				value: '16rem',
				description: 'Compact field width.'
			},
			noteSm: {
				type: 'dimension',
				value: '5.5rem',
				description: 'Small note field min height.'
			},
			noteMd: {
				type: 'dimension',
				value: '6rem',
				description: 'Medium note field min height.'
			},
			noteLg: {
				type: 'dimension',
				value: '7.5rem',
				description: 'Large note field min height.'
			},
			noteXl: {
				type: 'dimension',
				value: '11.25rem',
				description: 'Extra-large note field min height.'
			},
			readonlySm: {
				type: 'dimension',
				value: '3.75rem',
				description: 'Small readonly field min height.'
			},
			readonlyMd: {
				type: 'dimension',
				value: '6.25rem',
				description: 'Medium readonly field min height.'
			}
		},
		content: {
			widthSm: {
				type: 'dimension',
				value: '16rem',
				description: 'Compact content width.'
			}
		},
		scrollPanel: {
			default: {
				type: 'dimension',
				value: '22rem',
				description: 'Default scroll panel max height.'
			},
			sm: {
				type: 'dimension',
				value: '12.5rem',
				description: 'Small scroll panel max height.'
			}
		},
		dropzone: {
			lg: {
				type: 'dimension',
				value: '20rem',
				description: 'Large empty dropzone height.'
			}
		},
		emptyState: {
			xl: {
				type: 'dimension',
				value: '15rem',
				description: 'Large empty-state height.'
			}
		},
		routeHeader: {
			sm: {
				type: 'dimension',
				value: '2.8125rem',
				description: 'Small route header height.'
			}
		},
		button: {
			minSave: {
				type: 'dimension',
				value: '5.75rem',
				description: 'Minimum save button width.'
			}
		},
		controlWidth: {
			sm: {
				type: 'dimension',
				value: '4.75rem',
				description: 'Small numeric control width.'
			}
		}
	},
	duration: {
		fast: {
			type: 'duration',
			value: '140ms',
			description: 'Fast transition duration.'
		},
		standard: {
			type: 'duration',
			value: '200ms',
			description: 'Standard transition duration.'
		},
		productive: {
			type: 'duration',
			value: '280ms',
			description: 'Slow/complex transition duration.'
		}
	},
	easing: {
		standard: {
			type: 'cubicBezier',
			value: 'cubic-bezier(0.2, 0, 0, 1)',
			description: 'Default desktop easing.'
		},
		emphasized: {
			type: 'cubicBezier',
			value: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
			description: 'Emphasized motion easing.'
		}
	}
} as const;

export const designThemes = {
	$description: 'Semantic light/dark theme mappings consumed by the desktop design layer.',
	light: {
		background: {
			type: 'color',
			value: '#ffffff',
			description: 'Application background.'
		},
		foreground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Primary application text.'
		},
		card: {
			type: 'color',
			value: '#ffffff',
			description: 'Default card surface.'
		},
		cardForeground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Card text.'
		},
		popover: {
			type: 'color',
			value: '#ffffff',
			description: 'Popover surface.'
		},
		popoverForeground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Popover text.'
		},
		primary: {
			type: 'color',
			value: 'var(--color-neutral-700)',
			description: 'Primary action colour.'
		},
		primaryForeground: {
			type: 'color',
			value: '#ffffff',
			description: 'Primary action text.'
		},
		secondary: {
			type: 'color',
			value: '#f7f7f7',
			description: 'Secondary surface tone.'
		},
		secondaryForeground: {
			type: 'color',
			value: 'var(--color-neutral-800)',
			description: 'Secondary surface text.'
		},
		muted: {
			type: 'color',
			value: '#f5f5f5',
			description: 'Muted surface tone.'
		},
		mutedForeground: {
			type: 'color',
			value: 'var(--color-neutral-600)',
			description: 'Muted text.'
		},
		accent: {
			type: 'color',
			value: '#efefef',
			description: 'Neutral hover/selected tone.'
		},
		accentForeground: {
			type: 'color',
			value: 'var(--color-neutral-800)',
			description: 'Accent text.'
		},
		destructive: {
			type: 'color',
			value: 'var(--color-error-500)',
			description: 'Destructive action colour.'
		},
		destructiveForeground: {
			type: 'color',
			value: 'var(--color-error-50)',
			description: 'Destructive action text.'
		},
		success: {
			type: 'color',
			value: 'var(--color-success-500)',
			description: 'Success accent.'
		},
		warning: {
			type: 'color',
			value: 'var(--color-warning-500)',
			description: 'Warning accent.'
		},
		border: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-900) 12%, transparent)',
			description: 'Default border.'
		},
		input: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-900) 14%, transparent)',
			description: 'Input border.'
		},
		ring: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-400) 50%, transparent)',
			description: 'Focus ring colour.'
		},
		surfaceBase: {
			type: 'color',
			value: '#ffffff',
			description: 'Base panel surface.'
		},
		surfaceSubtle: {
			type: 'color',
			value: '#fafafa',
			description: 'Subtle panel surface.'
		},
		surfaceStrong: {
			type: 'color',
			value: '#f3f3f3',
			description: 'Strong panel surface.'
		},
		surfaceBrand: {
			type: 'color',
			value: '#f5f5f5',
			description: 'Neutral highlighted surface.'
		},
		surfaceBrandHover: {
			type: 'color',
			value: '#efefef',
			description: 'Neutral highlighted hover surface.'
		},
		fieldSurface: {
			type: 'color',
			value: '#ffffff',
			description: 'Field background.'
		},
		shellSurface: {
			type: 'color',
			value: '#ffffff',
			description: 'Shell surface.'
		},
		focusOutline: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-900) 14%, transparent)',
			description: 'Soft focus halo.'
		},
		elevationFlat: {
			type: 'shadow',
			value: '0 0 0 1px color-mix(in srgb, var(--color-neutral-900) 6%, transparent)',
			description: 'Flat elevation inset.'
		},
		elevationOverlay: {
			type: 'shadow',
			value: '0 18px 40px color-mix(in srgb, #000000 10%, transparent)',
			description: 'Overlay elevation shadow.'
		},
		sidebar: {
			type: 'color',
			value: 'var(--color-neutral-50)',
			description: 'Sidebar background.'
		},
		sidebarForeground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Sidebar text.'
		},
		sidebarPrimary: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Sidebar primary accent.'
		},
		sidebarPrimaryForeground: {
			type: 'color',
			value: 'var(--color-neutral-100)',
			description: 'Sidebar primary text.'
		},
		sidebarAccent: {
			type: 'color',
			value: '#e8e8e8',
			description: 'Sidebar active surface.'
		},
		sidebarHover: {
			type: 'color',
			value: '#efefef',
			description: 'Sidebar hover surface.'
		},
		sidebarAccentForeground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Sidebar accent text.'
		},
		sidebarBorder: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-900) 8%, transparent)',
			description: 'Sidebar border.'
		},
		sidebarRing: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-900) 18%, transparent)',
			description: 'Sidebar focus ring.'
		},
		overlay: {
			type: 'color',
			value: 'color-mix(in srgb, #000000 28%, transparent)',
			description: 'Modal/dialog overlay.'
		},
		documentPageBackground: {
			type: 'color',
			value: '#ffffff',
			description: 'Document page background.'
		},
		documentPageForeground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Document text.'
		},
		documentPageMuted: {
			type: 'color',
			value: 'var(--color-neutral-600)',
			description: 'Document secondary text.'
		},
		documentPageSoft: {
			type: 'color',
			value: 'var(--color-neutral-100)',
			description: 'Document soft fill.'
		},
		documentPageBorder: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-900) 12%, transparent)',
			description: 'Document border.'
		},
		documentPageStrong: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Document strong rule/text.'
		},
		documentPageInverse: {
			type: 'color',
			value: '#ffffff',
			description: 'Document inverse text.'
		},
		documentPageHeader: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Document header background.'
		},
		documentPageShadow: {
			type: 'shadow',
			value: '0 8px 30px color-mix(in srgb, #000000 8%, transparent)',
			description: 'Document page shadow.'
		},
		surfaceSuccess: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-success-500) 8%, transparent)',
			description: 'Success surface tint.'
		},
		surfaceSuccessBorder: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-success-500) 26%, transparent)',
			description: 'Success border tint.'
		},
		surfaceWarning: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-warning-500) 8%, transparent)',
			description: 'Warning surface tint.'
		},
		surfaceWarningBorder: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-warning-500) 26%, transparent)',
			description: 'Warning border tint.'
		},
		surfaceDestructive: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-error-500) 8%, transparent)',
			description: 'Destructive surface tint.'
		},
		surfaceDestructiveBorder: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-error-500) 26%, transparent)',
			description: 'Destructive border tint.'
		}
	},
	dark: {
		background: {
			type: 'color',
			value: 'var(--color-dark-surface-background)',
			description: 'Application background in dark mode.'
		},
		foreground: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 92%, var(--color-neutral-100))',
			description: 'Primary text in dark mode.'
		},
		card: {
			type: 'color',
			value: 'var(--color-dark-surface-strong)',
			description: 'Card surface in dark mode.'
		},
		cardForeground: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 92%, var(--color-neutral-100))',
			description: 'Card text in dark mode.'
		},
		popover: {
			type: 'color',
			value: 'var(--color-dark-surface-strong)',
			description: 'Popover surface in dark mode.'
		},
		popoverForeground: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 90%, var(--color-neutral-100))',
			description: 'Popover text in dark mode.'
		},
		primary: {
			type: 'color',
			value: 'var(--color-neutral-100)',
			description: 'Primary accent in dark mode.'
		},
		primaryForeground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Primary text in dark mode.'
		},
		secondary: {
			type: 'color',
			value: 'var(--color-dark-surface-secondary)',
			description: 'Secondary surface in dark mode.'
		},
		secondaryForeground: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 90%, var(--color-neutral-100))',
			description: 'Secondary text in dark mode.'
		},
		muted: {
			type: 'color',
			value: 'var(--color-dark-surface-muted)',
			description: 'Muted surface in dark mode.'
		},
		mutedForeground: {
			type: 'color',
			value: 'var(--color-dark-text-muted)',
			description: 'Muted text in dark mode.'
		},
		accent: {
			type: 'color',
			value: 'var(--color-dark-surface-selected)',
			description: 'Accent surface in dark mode.'
		},
		accentForeground: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 90%, var(--color-neutral-100))',
			description: 'Accent text in dark mode.'
		},
		destructive: {
			type: 'color',
			value: 'var(--color-error-400)',
			description: 'Destructive colour in dark mode.'
		},
		destructiveForeground: {
			type: 'color',
			value: 'var(--color-error-50)',
			description: 'Destructive text in dark mode.'
		},
		success: {
			type: 'color',
			value: 'var(--color-success-400)',
			description: 'Success colour in dark mode.'
		},
		warning: {
			type: 'color',
			value: 'var(--color-warning-400)',
			description: 'Warning colour in dark mode.'
		},
		border: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 10%, transparent)',
			description: 'Default border in dark mode.'
		},
		input: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 12%, transparent)',
			description: 'Input border in dark mode.'
		},
		ring: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-500) 45%, transparent)',
			description: 'Focus ring in dark mode.'
		},
		surfaceBase: {
			type: 'color',
			value: 'var(--color-dark-surface-strong)',
			description: 'Base panel surface in dark mode.'
		},
		surfaceSubtle: {
			type: 'color',
			value: 'var(--color-dark-surface-secondary)',
			description: 'Subtle panel surface in dark mode.'
		},
		surfaceStrong: {
			type: 'color',
			value: 'var(--color-dark-surface-strong)',
			description: 'Strong panel surface in dark mode.'
		},
		surfaceBrand: {
			type: 'color',
			value: 'var(--color-dark-surface-selected)',
			description: 'Neutral highlighted surface in dark mode.'
		},
		surfaceBrandHover: {
			type: 'color',
			value: 'var(--color-dark-surface-hover)',
			description: 'Neutral highlighted hover surface in dark mode.'
		},
		fieldSurface: {
			type: 'color',
			value: 'var(--color-dark-surface-panel)',
			description: 'Field background in dark mode.'
		},
		shellSurface: {
			type: 'color',
			value: 'var(--color-dark-surface-shell)',
			description: 'Shell surface in dark mode.'
		},
		focusOutline: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-100) 22%, transparent)',
			description: 'Soft focus halo in dark mode.'
		},
		elevationFlat: {
			type: 'shadow',
			value: '0 0 0 1px color-mix(in srgb, #ffffff 5%, transparent)',
			description: 'Flat elevation in dark mode.'
		},
		elevationOverlay: {
			type: 'shadow',
			value: '0 18px 40px color-mix(in srgb, #000000 32%, transparent)',
			description: 'Overlay shadow in dark mode.'
		},
		sidebar: {
			type: 'color',
			value: 'var(--color-dark-surface-background)',
			description: 'Sidebar background in dark mode.'
		},
		sidebarForeground: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 90%, var(--color-neutral-100))',
			description: 'Sidebar text in dark mode.'
		},
		sidebarPrimary: {
			type: 'color',
			value: 'var(--color-neutral-100)',
			description: 'Sidebar primary accent in dark mode.'
		},
		sidebarPrimaryForeground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Sidebar primary text in dark mode.'
		},
		sidebarAccent: {
			type: 'color',
			value: 'var(--color-dark-surface-selected)',
			description: 'Sidebar active surface in dark mode.'
		},
		sidebarHover: {
			type: 'color',
			value: 'var(--color-dark-surface-hover)',
			description: 'Sidebar hover surface in dark mode.'
		},
		sidebarAccentForeground: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 90%, var(--color-neutral-100))',
			description: 'Sidebar accent text in dark mode.'
		},
		sidebarBorder: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 6%, transparent)',
			description: 'Sidebar border in dark mode.'
		},
		sidebarRing: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-neutral-100) 22%, transparent)',
			description: 'Sidebar focus ring in dark mode.'
		},
		overlay: {
			type: 'color',
			value: 'color-mix(in srgb, #000000 45%, transparent)',
			description: 'Modal/dialog overlay in dark mode.'
		},
		documentPageBackground: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Document page background in dark mode.'
		},
		documentPageForeground: {
			type: 'color',
			value: 'var(--color-neutral-100)',
			description: 'Document text in dark mode.'
		},
		documentPageMuted: {
			type: 'color',
			value: 'var(--color-neutral-500)',
			description: 'Document secondary text in dark mode.'
		},
		documentPageSoft: {
			type: 'color',
			value: 'var(--color-neutral-800)',
			description: 'Document soft fill in dark mode.'
		},
		documentPageBorder: {
			type: 'color',
			value: 'color-mix(in srgb, #ffffff 10%, transparent)',
			description: 'Document border in dark mode.'
		},
		documentPageStrong: {
			type: 'color',
			value: 'var(--color-neutral-100)',
			description: 'Document strong rule/text in dark mode.'
		},
		documentPageInverse: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Document inverse text in dark mode.'
		},
		documentPageHeader: {
			type: 'color',
			value: 'var(--color-neutral-900)',
			description: 'Document header background in dark mode.'
		},
		documentPageShadow: {
			type: 'shadow',
			value: '0 8px 30px color-mix(in srgb, #000000 40%, transparent)',
			description: 'Document page shadow in dark mode.'
		},
		surfaceSuccess: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-success-400) 8%, transparent)',
			description: 'Success surface tint in dark mode.'
		},
		surfaceSuccessBorder: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-success-400) 26%, transparent)',
			description: 'Success border tint in dark mode.'
		},
		surfaceWarning: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-warning-400) 8%, transparent)',
			description: 'Warning surface tint in dark mode.'
		},
		surfaceWarningBorder: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-warning-400) 26%, transparent)',
			description: 'Warning border tint in dark mode.'
		},
		surfaceDestructive: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-error-400) 8%, transparent)',
			description: 'Destructive surface tint in dark mode.'
		},
		surfaceDestructiveBorder: {
			type: 'color',
			value: 'color-mix(in srgb, var(--color-error-400) 26%, transparent)',
			description: 'Destructive border tint in dark mode.'
		}
	}
} as const;

export const designTypography = {
	$description: 'Semantic typography composites for owned desktop text roles.',
	heading: {
		page: {
			fontFamily: {
				type: 'fontFamily',
				value: 'var(--font-display)',
				description: 'Page heading family.'
			},
			fontSize: {
				type: 'dimension',
				value: '1.25rem',
				description: 'Page heading size.'
			},
			lineHeight: {
				type: 'number',
				value: '1.2',
				description: 'Page heading line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 540,
				description: 'Page heading weight.'
			},
			letterSpacing: {
				type: 'dimension',
				value: '-0.03em',
				description: 'Page heading tracking.'
			}
		},
		section: {
			fontFamily: {
				type: 'fontFamily',
				value: 'var(--font-display)',
				description: 'Section heading family.'
			},
			fontSize: {
				type: 'dimension',
				value: '1rem',
				description: 'Section heading size.'
			},
			lineHeight: {
				type: 'number',
				value: '1.2',
				description: 'Section heading line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 560,
				description: 'Section heading weight.'
			},
			letterSpacing: {
				type: 'dimension',
				value: '-0.02em',
				description: 'Section heading tracking.'
			}
		}
	},
	title: {
		panel: {
			fontSize: {
				type: 'dimension',
				value: '0.9375rem',
				description: 'Panel title size.'
			},
			lineHeight: {
				type: 'number',
				value: '1.333',
				description: 'Panel title line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 540,
				description: 'Panel title weight.'
			},
			letterSpacing: {
				type: 'dimension',
				value: '-0.02em',
				description: 'Panel title tracking.'
			}
		}
	},
	body: {
		large: {
			fontSize: {
				type: 'dimension',
				value: '1rem',
				description: 'Large body size.'
			},
			lineHeight: {
				type: 'number',
				value: '1.35',
				description: 'Large body line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 560,
				description: 'Large body weight.'
			}
		},
		small: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Small body size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.125rem',
				description: 'Small body line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Small body weight.'
			}
		},
		muted: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Muted body size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.35rem',
				description: 'Muted body line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 400,
				description: 'Muted body weight.'
			}
		},
		caption: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Caption size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.35rem',
				description: 'Caption line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 450,
				description: 'Caption weight.'
			}
		},
		field: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Field body size.'
			},
			lineHeight: {
				type: 'number',
				value: '1.35',
				description: 'Field body line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 400,
				description: 'Field body weight.'
			}
		},
		table: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Table body size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.25rem',
				description: 'Table body line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 400,
				description: 'Table body weight.'
			}
		},
		menu: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Menu copy size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.125rem',
				description: 'Menu copy line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Menu copy weight.'
			}
		}
	},
	label: {
		field: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Field label size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.125rem',
				description: 'Field label line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Field label weight.'
			}
		},
		shell: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Shell label size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.125rem',
				description: 'Shell label line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Shell label weight.'
			}
		},
		shellStrong: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Strong shell label size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.125rem',
				description: 'Strong shell label line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 580,
				description: 'Strong shell label weight.'
			}
		},
		shellMeta: {
			fontSize: {
				type: 'dimension',
				value: '0.75rem',
				description: 'Shell meta size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.125rem',
				description: 'Shell meta line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 400,
				description: 'Shell meta weight.'
			}
		},
		tab: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Tab label size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.125rem',
				description: 'Tab label line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Tab label weight.'
			}
		},
		tableCaption: {
			fontSize: {
				type: 'dimension',
				value: '0.75rem',
				description: 'Table caption size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.25rem',
				description: 'Table caption line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 400,
				description: 'Table caption weight.'
			}
		},
		eyebrow: {
			fontSize: {
				type: 'dimension',
				value: '0.6875rem',
				description: 'Eyebrow size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Eyebrow line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 600,
				description: 'Eyebrow weight.'
			},
			letterSpacing: {
				type: 'dimension',
				value: '0.16em',
				description: 'Eyebrow tracking.'
			}
		},
		badge: {
			fontSize: {
				type: 'dimension',
				value: '0.6875rem',
				description: 'Badge label size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Badge label line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 450,
				description: 'Badge label weight.'
			},
			letterSpacing: {
				type: 'dimension',
				value: '0.01em',
				description: 'Badge label tracking.'
			}
		}
	},
	control: {
		xs: {
			fontSize: {
				type: 'dimension',
				value: '0.75rem',
				description: 'Extra-small control text size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Extra-small control line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Extra-small control weight.'
			}
		},
		default: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Default control text size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.25rem',
				description: 'Default control line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Default control weight.'
			}
		},
		sm: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Compact control text size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.125rem',
				description: 'Compact control line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Compact control weight.'
			}
		},
		lg: {
			fontSize: {
				type: 'dimension',
				value: '0.875rem',
				description: 'Large control text size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.25rem',
				description: 'Large control line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 540,
				description: 'Large control weight.'
			}
		}
	},
	helper: {
		field: {
			fontSize: {
				type: 'dimension',
				value: '0.6875rem',
				description: 'Field help size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Field help line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 400,
				description: 'Field help weight.'
			}
		},
		tooltip: {
			fontSize: {
				type: 'dimension',
				value: '0.6875rem',
				description: 'Tooltip size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Tooltip line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Tooltip weight.'
			}
		},
		calendar: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Calendar copy size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Calendar copy line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 520,
				description: 'Calendar copy weight.'
			}
		},
		calendarCaption: {
			fontSize: {
				type: 'dimension',
				value: '0.6875rem',
				description: 'Calendar caption size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Calendar caption line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Calendar caption weight.'
			}
		},
		menuShortcut: {
			fontSize: {
				type: 'dimension',
				value: '0.6875rem',
				description: 'Menu shortcut size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Menu shortcut line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 600,
				description: 'Menu shortcut weight.'
			},
			letterSpacing: {
				type: 'dimension',
				value: '0.12em',
				description: 'Menu shortcut tracking.'
			}
		},
		toastTitle: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Toast title size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.25rem',
				description: 'Toast title line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 500,
				description: 'Toast title weight.'
			}
		},
		toastDescription: {
			fontSize: {
				type: 'dimension',
				value: '0.75rem',
				description: 'Toast description size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Toast description line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 400,
				description: 'Toast description weight.'
			}
		},
		codeBlock: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Code block size.'
			},
			lineHeight: {
				type: 'number',
				value: '1.625',
				description: 'Code block line height.'
			}
		},
		onboardingHero: {
			fontSize: {
				type: 'dimension',
				value: '1.875rem',
				description: 'Onboarding hero size.'
			},
			lineHeight: {
				type: 'number',
				value: '1.2',
				description: 'Onboarding hero line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 600,
				description: 'Onboarding hero weight.'
			},
			letterSpacing: {
				type: 'dimension',
				value: '-0.025em',
				description: 'Onboarding hero tracking.'
			}
		},
		menuHeading: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Menu heading size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1rem',
				description: 'Menu heading line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 600,
				description: 'Menu heading weight.'
			}
		},
		tableHeading: {
			fontSize: {
				type: 'dimension',
				value: '0.8125rem',
				description: 'Table heading size.'
			},
			lineHeight: {
				type: 'dimension',
				value: '1.25rem',
				description: 'Table heading line height.'
			},
			fontWeight: {
				type: 'fontWeight',
				value: 560,
				description: 'Table heading weight.'
			}
		}
	}
} as const;

export const designLayout = {
	$description: 'Layout and shell sizing tokens for shared desktop utilities.',
	page: {
		gutter: {
			type: 'dimension',
			value: 'var(--space-4)',
			description: 'Default page gutter.'
		},
		stackGap: {
			type: 'dimension',
			value: 'var(--space-4)',
			description: 'Default page stack gap.'
		},
		contentMaxWidth: {
			type: 'dimension',
			value: '80rem',
			description: 'Bounded desktop content column width for list pages and primary work surfaces.'
		}
	},
	section: {
		stackGap: {
			type: 'dimension',
			value: 'var(--space-3)',
			description: 'Default section gap.'
		}
	},
	field: {
		shellGap: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Field shell gap.'
		},
		labelRowGap: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Field label row gap.'
		}
	},
	dialog: {
		frame: {
			widthSm: {
				type: 'dimension',
				value: '36rem',
				description: 'Semantic small framed-dialog width.'
			},
			widthMd: {
				type: 'dimension',
				value: '50rem',
				description: 'Semantic medium framed-dialog width.'
			},
			widthLg: {
				type: 'dimension',
				value: '64rem',
				description: 'Semantic large framed-dialog width for roomy settings and review surfaces.'
			},
			heightSm: {
				type: 'dimension',
				value: '24rem',
				description: 'Semantic small framed-dialog height.'
			},
			heightMd: {
				type: 'dimension',
				value: '33rem',
				description: 'Semantic medium framed-dialog height.'
			},
			heightLg: {
				type: 'dimension',
				value: '42rem',
				description: 'Semantic large framed-dialog height.'
			},
			contentWidthForm: {
				type: 'dimension',
				value: '47rem',
				description:
					'Centered content column width for form-like dialog bodies inside wider shells.'
			}
		},
		shell: {
			standardHeight: {
				type: 'dimension',
				value: 'min(500px, 74vh)',
				description: 'Standard shell dialog height.'
			},
			mediumHeight: {
				type: 'dimension',
				value: 'min(500px, 74vh)',
				description: 'Medium shell dialog height.'
			},
			compactHeight: {
				type: 'dimension',
				value: 'min(460px, 70vh)',
				description: 'Compact shell dialog height.'
			},
			workflowHeight: {
				type: 'dimension',
				value: 'min(42rem, 84vh)',
				description:
					'Workflow/admin dialog height for wider review surfaces that need a visible rail and scrollable main content.'
			},
			workbenchHeight: {
				type: 'dimension',
				value: 'min(46rem, calc(100vh - 5rem))',
				description: 'Oversized review-dialog height for full-workbench flows such as setup import.'
			},
			formHeight: {
				type: 'dimension',
				value: 'min(640px, 82vh)',
				description: 'Short-form dialog height for compact record create/edit flows.'
			},
			widthMd: {
				type: 'dimension',
				value: '43.75rem',
				description: 'Standard shell dialog width on medium screens.'
			},
			widthLg: {
				type: 'dimension',
				value: '50rem',
				description:
					'Standard shell dialog width on large screens, matching the shadcn sidebar-dialog reference.'
			},
			widthWorkbench: {
				type: 'dimension',
				value: 'min(66rem, calc(100vw - 8rem))',
				description: 'Oversized review-dialog width for workbench-style mapping and review flows.'
			},
			widthForm: {
				type: 'dimension',
				value: '43.75rem',
				description: 'Short-form dialog width.'
			},
			widthWorkflow: {
				type: 'dimension',
				value: '50rem',
				description: 'Workflow dialog width aligned to the shadcn sidebar-dialog reference.'
			}
		},
		max: {
			sm: {
				type: 'dimension',
				value: 'var(--size-dialog-xs)',
				description: 'Compact dialog max width.'
			},
			md: {
				type: 'dimension',
				value: 'var(--size-dialog-md)',
				description: 'Medium dialog max width.'
			},
			xl: {
				type: 'dimension',
				value: 'var(--size-dialog-4xl)',
				description: 'Wide workflow dialog max width.'
			}
		},
		sidebarWidth: {
			type: 'dimension',
			value: '15rem',
			description:
				'Sidebar width inside shell dialogs, tuned to the shadcn sidebar-dialog example without starving the main content column.'
		},
		bodyPaddingX: {
			type: 'dimension',
			value: 'var(--space-4)',
			description: 'Shell dialog body horizontal padding.'
		}
	},
	surface: {
		stripRowHeight: {
			type: 'dimension',
			value: '2.5rem',
			description: 'Viewer/editor strip row height.'
		}
	},
	projectStructure: {
		sidebarWidth: {
			type: 'dimension',
			value: '12rem',
			description: 'Project structure sidebar width.'
		}
	},
	onboarding: {
		cornerMark: {
			type: 'dimension',
			value: '3.375rem',
			description: 'Onboarding corner logo size.'
		}
	}
} as const;

export const designComponents = {
	$description: 'Narrow component-token layer for core owned shared wrappers.',
	button: {
		$description: 'Owned button wrapper contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-md)',
			description: 'Default button radius.'
		},
		heightXs: {
			type: 'dimension',
			value: 'var(--size-control-xs)',
			description: 'Extra-small button height.'
		},
		heightSm: {
			type: 'dimension',
			value: 'var(--size-control-sm)',
			description: 'Small button height.'
		},
		heightMd: {
			type: 'dimension',
			value: 'var(--size-control-md)',
			description: 'Default button height.'
		},
		heightLg: {
			type: 'dimension',
			value: 'var(--size-control-lg)',
			description: 'Large button height.'
		},
		paddingInlineXs: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Extra-small button inline padding.'
		},
		paddingInlineSm: {
			type: 'dimension',
			value: '0.625rem',
			description: 'Small button inline padding.'
		},
		paddingInlineMd: {
			type: 'dimension',
			value: 'var(--space-3)',
			description: 'Default button inline padding.'
		},
		paddingInlineLg: {
			type: 'dimension',
			value: 'var(--space-4)',
			description: 'Large button inline padding.'
		},
		gapXs: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Extra-small button content gap.'
		},
		gapSm: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Small button content gap.'
		},
		gapMd: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Default button content gap.'
		},
		gapLg: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Large button content gap.'
		},
		iconXs: {
			type: 'dimension',
			value: '0.875rem',
			description: 'Extra-small button icon size.'
		},
		iconSm: {
			type: 'dimension',
			value: '0.875rem',
			description: 'Small button icon size.'
		},
		iconMd: {
			type: 'dimension',
			value: '1rem',
			description: 'Default button icon size.'
		},
		iconLg: {
			type: 'dimension',
			value: '1rem',
			description: 'Large button icon size.'
		}
	},
	field: {
		$description:
			'Shared single-line field sizing contract for inputs, selects, and search controls.',
		heightXs: {
			type: 'dimension',
			value: 'var(--size-control-xs)',
			description: 'Extra-small field height.'
		},
		heightSm: {
			type: 'dimension',
			value: 'var(--size-control-sm)',
			description: 'Small field height.'
		},
		heightMd: {
			type: 'dimension',
			value: 'var(--size-control-md)',
			description: 'Default field height.'
		},
		heightLg: {
			type: 'dimension',
			value: 'var(--size-control-lg)',
			description: 'Large field height.'
		},
		paddingInlineXs: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Extra-small field inline padding.'
		},
		paddingInlineSm: {
			type: 'dimension',
			value: '0.625rem',
			description: 'Small field inline padding.'
		},
		paddingInlineMd: {
			type: 'dimension',
			value: 'var(--space-3)',
			description: 'Default field inline padding.'
		},
		paddingInlineLg: {
			type: 'dimension',
			value: '0.875rem',
			description: 'Large field inline padding.'
		},
		gapXs: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Extra-small field content gap.'
		},
		gapSm: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Small field content gap.'
		},
		gapMd: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Default field content gap.'
		},
		gapLg: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Large field content gap.'
		},
		iconXs: {
			type: 'dimension',
			value: '0.875rem',
			description: 'Extra-small field icon size.'
		},
		iconSm: {
			type: 'dimension',
			value: '0.875rem',
			description: 'Small field icon size.'
		},
		iconMd: {
			type: 'dimension',
			value: '1rem',
			description: 'Default field icon size.'
		},
		iconLg: {
			type: 'dimension',
			value: '1rem',
			description: 'Large field icon size.'
		}
	},
	input: {
		$description: 'Owned text input wrapper contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-sm)',
			description: 'Default input radius.'
		}
	},
	select: {
		$description: 'Owned select trigger contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-sm)',
			description: 'Default select trigger radius.'
		}
	},
	badge: {
		$description: 'Owned badge contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-pill)',
			description: 'Badge pill radius.'
		}
	},
	switch: {
		$description: 'Owned switch contract.',
		width: {
			type: 'dimension',
			value: '2.25rem',
			description: 'Default switch width.'
		},
		height: {
			type: 'dimension',
			value: '1.25rem',
			description: 'Default switch height.'
		},
		padding: {
			type: 'dimension',
			value: '0.125rem',
			description: 'Switch inner padding.'
		},
		thumbSize: {
			type: 'dimension',
			value: '0.875rem',
			description: 'Switch thumb size.'
		},
		thumbTranslate: {
			type: 'dimension',
			value: '1rem',
			description: 'Checked thumb translate distance.'
		}
	},
	progress: {
		$description: 'Owned progress contract.',
		height: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Default progress bar height.'
		},
		heightEmphasis: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Emphasised progress bar height.'
		},
		radius: {
			type: 'dimension',
			value: 'var(--radius-pill)',
			description: 'Progress track radius.'
		}
	},
	tabs: {
		$description: 'Owned segmented tabs contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-md)',
			description: 'Tabs list radius.'
		},
		listPadding: {
			type: 'dimension',
			value: 'var(--space-1)',
			description: 'Tabs list inner padding.'
		},
		triggerPaddingInline: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Tabs trigger inline padding.'
		}
	},
	dialog: {
		$description: 'Owned dialog sizing contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-lg)',
			description: 'Dialog content radius.'
		},
		defaultWidth: {
			type: 'dimension',
			value: 'var(--size-dialog-lg)',
			description: 'Default dialog width.'
		},
		alertWidth: {
			type: 'dimension',
			value: 'var(--size-dialog-alert)',
			description: 'Alert dialog width.'
		}
	},
	accordion: {
		$description: 'Owned accordion chrome contract.',
		divider: {
			type: 'string',
			value: 'border',
			description: 'Accordion divider token family.'
		}
	},
	popover: {
		$description: 'Owned popover sizing contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-lg)',
			description: 'Popover radius.'
		},
		defaultWidth: {
			type: 'dimension',
			value: 'var(--size-popover-sm)',
			description: 'Default popover width.'
		},
		padding: {
			type: 'dimension',
			value: 'var(--space-4)',
			description: 'Default popover padding.'
		}
	},
	sidebar: {
		$description: 'Owned shell/sidebar chrome contract.',
		itemRadius: {
			type: 'dimension',
			value: 'var(--radius-lg)',
			description: 'Sidebar button radius.'
		},
		controlHeight: {
			type: 'dimension',
			value: 'var(--size-control-lg)',
			description: 'Sidebar compact control height.'
		}
	},
	table: {
		$description: 'Owned table shell contract.',
		headerSurface: {
			type: 'string',
			value: 'surface-subtle',
			description: 'Default sticky header surface helper.'
		},
		textRole: {
			type: 'string',
			value: 'table-copy',
			description: 'Default table text role.'
		}
	},
	empty: {
		$description: 'Owned empty-state contract.',
		titleRole: {
			type: 'string',
			value: 'title-copy',
			description: 'Empty-state title role.'
		},
		descriptionRole: {
			type: 'string',
			value: 'muted',
			description: 'Empty-state description role.'
		}
	},
	textarea: {
		$description: 'Owned textarea contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-sm)',
			description: 'Textarea radius.'
		},
		paddingInline: {
			type: 'dimension',
			value: 'var(--space-3)',
			description: 'Textarea inline padding.'
		},
		paddingBlockXs: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Extra-small textarea vertical padding.'
		},
		paddingBlockSm: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Small textarea vertical padding.'
		},
		paddingBlockMd: {
			type: 'dimension',
			value: '0.625rem',
			description: 'Default textarea vertical padding.'
		},
		paddingBlockLg: {
			type: 'dimension',
			value: '0.75rem',
			description: 'Large textarea vertical padding.'
		},
		minHeight: {
			type: 'dimension',
			value: '4rem',
			description: 'Default textarea minimum height.'
		}
	},
	dropdownMenu: {
		$description: 'Owned dropdown menu contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-lg)',
			description: 'Dropdown menu radius.'
		},
		widthSm: {
			type: 'dimension',
			value: 'var(--size-menu-sm)',
			description: 'Small dropdown width.'
		},
		widthMd: {
			type: 'dimension',
			value: 'var(--size-menu-md)',
			description: 'Medium dropdown width.'
		}
	},
	tooltip: {
		$description: 'Owned tooltip contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-tight)',
			description: 'Tooltip bubble radius.'
		},
		arrowRadius: {
			type: 'dimension',
			value: '0.125rem',
			description: 'Tooltip arrow radius.'
		},
		paddingX: {
			type: 'dimension',
			value: '0.625rem',
			description: 'Tooltip horizontal padding.'
		},
		paddingY: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Tooltip vertical padding.'
		}
	},
	sheet: {
		$description: 'Owned sheet contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-lg)',
			description: 'Sheet radius.'
		},
		widthMd: {
			type: 'dimension',
			value: 'var(--size-sheet-md)',
			description: 'Standard sheet width.'
		},
		widthLg: {
			type: 'dimension',
			value: 'var(--size-sheet-lg)',
			description: 'Compact shell sheet width.'
		}
	},
	checkbox: {
		$description: 'Owned checkbox contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-tight)',
			description: 'Checkbox radius.'
		},
		size: {
			type: 'dimension',
			value: '1rem',
			description: 'Checkbox size.'
		}
	},
	label: {
		$description: 'Owned label contract.',
		gap: {
			type: 'dimension',
			value: '0.375rem',
			description: 'Gap between label text and inline affordances.'
		}
	},
	avatar: {
		$description: 'Owned avatar contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-pill)',
			description: 'Avatar radius.'
		},
		size: {
			type: 'dimension',
			value: '2rem',
			description: 'Default avatar size.'
		}
	},
	breadcrumb: {
		$description: 'Owned breadcrumb contract.',
		gap: {
			type: 'dimension',
			value: 'var(--space-2)',
			description: 'Default breadcrumb item gap.'
		},
		gapWide: {
			type: 'dimension',
			value: 'var(--space-3)',
			description: 'Wider breadcrumb item gap on larger screens.'
		},
		separatorSize: {
			type: 'dimension',
			value: '0.875rem',
			description: 'Breadcrumb separator icon size.'
		}
	},
	alert: {
		$description: 'Owned alert contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-md)',
			description: 'Alert radius.'
		},
		paddingX: {
			type: 'dimension',
			value: 'var(--space-4)',
			description: 'Alert horizontal padding.'
		},
		paddingY: {
			type: 'dimension',
			value: 'var(--space-3)',
			description: 'Alert vertical padding.'
		}
	},
	alertDialog: {
		$description: 'Owned alert dialog contract.',
		width: {
			type: 'dimension',
			value: 'var(--size-dialog-alert)',
			description: 'Alert dialog width.'
		}
	},
	calendar: {
		$description: 'Owned calendar contract.',
		dayRadius: {
			type: 'dimension',
			value: 'var(--radius-sm)',
			description: 'Calendar day radius.'
		}
	},
	dataTable: {
		$description: 'Owned headless data-table contract.',
		textRole: {
			type: 'string',
			value: 'table-copy',
			description: 'Default data-table text role.'
		},
		headerRole: {
			type: 'string',
			value: 'table-heading',
			description: 'Default data-table header role.'
		}
	},
	resizable: {
		$description: 'Owned resizable-pane contract.',
		handleThickness: {
			type: 'dimension',
			value: '1px',
			description: 'Base resizer handle thickness.'
		},
		hitArea: {
			type: 'dimension',
			value: 'var(--space-1)',
			description: 'Invisible hit area around the resizer handle.'
		},
		gripRadius: {
			type: 'dimension',
			value: 'var(--radius-xs)',
			description: 'Grip radius for visible resizer handles.'
		}
	},
	scrollArea: {
		$description: 'Owned scroll-area contract.',
		trackThickness: {
			type: 'dimension',
			value: '0.625rem',
			description: 'Scrollbar track thickness.'
		},
		thumbRadius: {
			type: 'dimension',
			value: 'var(--radius-pill)',
			description: 'Scrollbar thumb radius.'
		}
	},
	separator: {
		$description: 'Owned separator contract.',
		thickness: {
			type: 'dimension',
			value: '1px',
			description: 'Separator line thickness.'
		}
	},
	skeleton: {
		$description: 'Owned skeleton contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-md)',
			description: 'Skeleton radius.'
		}
	},
	sonner: {
		$description: 'Owned toast/toaster contract.',
		radius: {
			type: 'dimension',
			value: 'var(--radius-md)',
			description: 'Toast surface radius.'
		},
		width: {
			type: 'dimension',
			value: 'var(--size-popover-md)',
			description: 'Default maximum toast width.'
		}
	}
} as const;

export const designTokenMetadata = {
	owner: 'src/lib/design/* + src/lib/components/ui/*',
	status: 'active',
	modes: ['light', 'dark', 'compact', 'default'],
	generatedOutputs: [
		'src/lib/design/generated/primitives.css',
		'src/lib/design/generated/typography.css',
		'src/lib/design/generated/layout.css',
		'src/lib/design/generated/components.css',
		'src/lib/design/generated/modes.css',
		'src/lib/design/generated/registry.ts'
	],
	notes: [
		'Figma is a downstream consumer of this registry, not the master source of truth.',
		'Storybook documents primitives, owned ui wrappers, and golden patterns, not every full route.',
		'Literal domain/business strings are not tokenized here; reusable visual and content roles are.',
		'Shared copy patterns are documented in the UI conventions section of ARCHITECTURE.md instead of being stored as literal token values.'
	]
} as const;
