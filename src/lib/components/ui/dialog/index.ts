import Root from './dialog.svelte';
import Portal from './dialog-portal.svelte';
import Title from './dialog-title.svelte';
import Footer from './dialog-footer.svelte';
import Header from './dialog-header.svelte';
import Overlay from './dialog-overlay.svelte';
import Content from './dialog-content.svelte';
import Description from './dialog-description.svelte';
import Trigger from './dialog-trigger.svelte';
import Close from './dialog-close.svelte';
import WorkflowFrame from './dialog-workflow-frame.svelte';
import FormFrame from './dialog-form-frame.svelte';
import RailFrame from './dialog-rail-frame.svelte';
import StandardFrame from './dialog-standard-frame.svelte';
import ToggleRow from './dialog-toggle-row.svelte';
import type { DialogRailItem } from './types.js';

export {
	Root,
	Title,
	Portal,
	Footer,
	Header,
	Trigger,
	Overlay,
	Content,
	Description,
	Close,
	WorkflowFrame,
	FormFrame,
	RailFrame,
	StandardFrame,
	ToggleRow,
	//
	Root as Dialog,
	Title as DialogTitle,
	Portal as DialogPortal,
	Footer as DialogFooter,
	Header as DialogHeader,
	Trigger as DialogTrigger,
	Overlay as DialogOverlay,
	Content as DialogContent,
	Description as DialogDescription,
	Close as DialogClose,
	WorkflowFrame as DialogWorkflowFrame,
	FormFrame as DialogFormFrame,
	RailFrame as DialogRailFrame,
	StandardFrame as DialogStandardFrame,
	ToggleRow as DialogToggleRow,
	type DialogRailItem
};
