export const DEFAULT_TABLE_PAGE_SIZES = [10, 20, 30, 40, 50] as const;

export function getTablePageCount(totalRows: number, pageSize: number): number {
	if (totalRows <= 0) return 1;
	return Math.max(1, Math.ceil(totalRows / pageSize));
}

export function clampTablePageIndex(
	pageIndex: number,
	totalRows: number,
	pageSize: number
): number {
	return Math.min(Math.max(pageIndex, 0), getTablePageCount(totalRows, pageSize) - 1);
}

export function paginateTableRows<T>(rows: T[], pageIndex: number, pageSize: number): T[] {
	const start = pageIndex * pageSize;
	return rows.slice(start, start + pageSize);
}
