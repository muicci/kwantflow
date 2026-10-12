export const normaliseClassificationSystemId = (value: string | null | undefined) => value ?? null;

type ClassificationRouteSyncInput = {
	selectedSystemId: string | null | undefined;
	activeSystemId: string | null;
	availableSystemIds: readonly string[];
};

export type ClassificationRouteSyncAction =
	| { type: 'noop' }
	| { type: 'clear' }
	| { type: 'select'; systemId: string }
	| { type: 'recover-missing-route'; systemId: string };

export const getClassificationRouteSyncAction = ({
	selectedSystemId,
	activeSystemId,
	availableSystemIds
}: ClassificationRouteSyncInput): ClassificationRouteSyncAction => {
	const nextSelectedSystemId = normaliseClassificationSystemId(selectedSystemId);

	if (!nextSelectedSystemId) {
		return activeSystemId ? { type: 'clear' } : { type: 'noop' };
	}

	if (!availableSystemIds.includes(nextSelectedSystemId)) {
		return { type: 'recover-missing-route', systemId: nextSelectedSystemId };
	}

	if (activeSystemId !== nextSelectedSystemId) {
		return { type: 'select', systemId: nextSelectedSystemId };
	}

	return { type: 'noop' };
};

export const shouldShowCostCodeSheet = (activeSystemId: string | null, useDockedPanel: boolean) =>
	Boolean(activeSystemId) && !useDockedPanel;
