import type {
	Asset,
	AssetFile,
	ExplorerProjectChildren,
	ExplorerVisibleProject,
	Project
} from '$lib/types/index.js';
import {
	getProjectCompanyDisplayName,
	getProjectRequesterDisplayName
} from '$lib/utils/project-contact.js';

function normaliseQuery(query: string): string {
	return query.trim().toLowerCase();
}

function matchesValue(value: string | null | undefined, query: string): boolean {
	if (!value) return false;
	return value.toLowerCase().includes(query);
}

function matchesProject(project: Project, query: string): boolean {
	return (
		matchesValue(project.rfq_number, query) ||
		matchesValue(project.project_name, query) ||
		matchesValue(getProjectCompanyDisplayName(project), query) ||
		matchesValue(getProjectRequesterDisplayName(project), query)
	);
}

function matchesAsset(asset: Asset, query: string): boolean {
	return matchesValue(asset.display_name, query);
}

function matchesFile(file: AssetFile, query: string): boolean {
	return matchesValue(file.original_name, query);
}

export function buildExplorerVisibleProjects(
	projects: Project[],
	childrenByProjectId: Record<string, ExplorerProjectChildren | undefined>,
	query: string
): ExplorerVisibleProject[] {
	const normalisedQuery = normaliseQuery(query);

	if (normalisedQuery.length === 0) {
		return projects.map((project) => {
			const children = childrenByProjectId[project.id];
			return {
				project,
				assets: (children?.assets ?? []).map((asset) => ({
					asset,
					files: asset.files ?? []
				})),
				unassignedFiles: children?.unassignedFiles ?? [],
				matchesSearch: false
			};
		});
	}

	return projects.flatMap((project) => {
		const children = childrenByProjectId[project.id];
		const projectMatches = matchesProject(project, normalisedQuery);

		if (projectMatches) {
			return [
				{
					project,
					assets: (children?.assets ?? []).map((asset) => ({
						asset,
						files: asset.files ?? []
					})),
					unassignedFiles: children?.unassignedFiles ?? [],
					matchesSearch: true
				}
			];
		}

		if (!children?.loaded) {
			return [];
		}

		const assets = children.assets.flatMap((asset) => {
			const assetMatches = matchesAsset(asset, normalisedQuery);
			const files = assetMatches
				? (asset.files ?? [])
				: (asset.files ?? []).filter((file) => matchesFile(file, normalisedQuery));

			if (!assetMatches && files.length === 0) {
				return [];
			}

			return [{ asset, files }];
		});

		const unassignedFiles = children.unassignedFiles.filter((file) =>
			matchesFile(file, normalisedQuery)
		);

		if (assets.length === 0 && unassignedFiles.length === 0) {
			return [];
		}

		return [
			{
				project,
				assets,
				unassignedFiles,
				matchesSearch: true
			}
		];
	});
}
