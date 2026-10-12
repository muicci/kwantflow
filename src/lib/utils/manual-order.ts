export function buildMergedManualOrderIds(
	sourceIds: string[],
	visibleOrderedIds: string[]
): string[] {
	if (visibleOrderedIds.length === 0) {
		return [...sourceIds];
	}

	const visibleSet = new Set(visibleOrderedIds);
	const sourceVisibleIds = sourceIds.filter((id) => visibleSet.has(id));

	if (
		sourceVisibleIds.length !== visibleOrderedIds.length ||
		sourceVisibleIds.some((id) => !visibleSet.has(id))
	) {
		throw new Error('Visible rows must match the current source subset before reordering');
	}

	let nextVisibleIndex = 0;
	return sourceIds.map((id) => {
		if (!visibleSet.has(id)) {
			return id;
		}

		const nextId = visibleOrderedIds[nextVisibleIndex];
		nextVisibleIndex += 1;
		return nextId;
	});
}
