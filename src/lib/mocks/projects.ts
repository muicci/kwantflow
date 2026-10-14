// Browser-only fixture: used when the UI runs outside Tauri (`pnpm dev`, Storybook, Vitest).
// Never returned inside the desktop app.
import { ProjectStatus } from '../constants/index.js';
import type { Project } from '../types/index.js';

/**
 * Mock RFQ Projects — Used as fallback when SQLite is not available (browser mode).
 * DELETE THIS FILE when all data comes from the real database.
 */
export const MOCK_PROJECTS: Project[] = [
	{
		id: 'mock-001',
		workspace_id: 'local-workspace',
		rfq_number: 'RFQ-2024-0187',
		sort_order: 0,
		is_favourite: false,
		status: ProjectStatus.Draft,
		updated_at: '2026-03-04T08:00:00Z',
		created_at: '2026-03-04T08:00:00Z',
		asset_count: 12
	},
	{
		id: 'mock-002',
		workspace_id: 'local-workspace',
		rfq_number: 'RFQ-2024-0186',
		sort_order: 1,
		is_favourite: false,
		status: ProjectStatus.Draft,
		updated_at: '2026-03-03T14:30:00Z',
		created_at: '2026-03-03T14:30:00Z',
		asset_count: 4
	},
	{
		id: 'mock-003',
		workspace_id: 'local-workspace',
		rfq_number: 'RFQ-2024-0185',
		sort_order: 2,
		is_favourite: false,
		status: ProjectStatus.Draft,
		updated_at: '2026-03-02T09:15:00Z',
		created_at: '2026-03-02T09:15:00Z',
		asset_count: 28
	},
	{
		id: 'mock-004',
		workspace_id: 'local-workspace',
		rfq_number: 'RFQ-2024-0184',
		sort_order: 3,
		is_favourite: false,
		status: ProjectStatus.Draft,
		updated_at: '2026-02-28T16:45:00Z',
		created_at: '2026-02-28T16:45:00Z',
		asset_count: 7
	},
	{
		id: 'mock-005',
		workspace_id: 'local-workspace',
		rfq_number: 'RFQ-2024-0183',
		sort_order: 4,
		is_favourite: false,
		status: ProjectStatus.Draft,
		updated_at: '2026-02-25T11:00:00Z',
		created_at: '2026-02-25T11:00:00Z',
		asset_count: 2
	}
];
