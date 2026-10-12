import {
	getEstimateAiStaticPolicy,
	type EstimateAiStaticPolicy
} from '$lib/constants/file-support.js';
import type { AssetFile } from '$lib/types/index.js';

export type EstimateAiEligibilityStatus = 'eligible' | 'ineligible';
export type EstimateAiEvidenceMode =
	| 'native_file'
	| 'native_image'
	| 'text'
	| 'cad_renders'
	| 'cad_metadata'
	| 'converted_image'
	| 'none';

export type EstimateAiEligibilityReasonCode =
	| 'supported'
	| 'unsupported_file_type'
	| 'image_conversion_required'
	| 'image_evidence_unavailable'
	| 'text_evidence_unavailable'
	| 'cad_evidence_unavailable'
	| 'eligibility_check_failed'
	| 'cad_read_failed';

export type EstimateAiFileEligibility = {
	fileId: string;
	fileName: string;
	status: EstimateAiEligibilityStatus;
	evidenceMode: EstimateAiEvidenceMode;
	reasonCode: EstimateAiEligibilityReasonCode;
	tooltipLabel: string;
	tooltipDetail: string;
};

export type EstimateAiFileEligibilitySummary = {
	hasEligibleFiles: boolean;
	eligibleFiles: EstimateAiFileEligibility[];
	ineligibleFiles: EstimateAiFileEligibility[];
};

export type EstimateAiFileEligibilityOptions = {
	supportsImageInputs?: boolean;
};

function eligible(
	file: AssetFile,
	evidenceMode: Exclude<EstimateAiEvidenceMode, 'none'>
): EstimateAiFileEligibility {
	return {
		fileId: file.id,
		fileName: file.original_name,
		status: 'eligible',
		evidenceMode,
		reasonCode: 'supported',
		tooltipLabel: 'Used by AI draft',
		tooltipDetail: 'AI can use this file in the draft.'
	};
}

function ineligible(file: AssetFile): EstimateAiFileEligibility {
	return {
		fileId: file.id,
		fileName: file.original_name,
		status: 'ineligible',
		evidenceMode: 'none',
		reasonCode: 'unsupported_file_type',
		tooltipLabel: 'Not used by AI draft',
		tooltipDetail: 'This file type is not supported for AI drafting yet.'
	};
}

function staticEligibility(
	file: AssetFile,
	policy: EstimateAiStaticPolicy
): EstimateAiFileEligibility {
	switch (policy) {
		case 'native_file':
			return eligible(file, 'native_file');
		case 'native_image':
			return eligible(file, 'native_image');
		case 'text':
			return eligible(file, 'text');
		case 'converted_image':
			return eligible(file, 'converted_image');
		case 'cad_renders':
			return eligible(file, 'cad_renders');
		case 'unsupported':
		default:
			return ineligible(file);
	}
}

export async function resolveEstimateAiFileEligibility(
	file: AssetFile,
	_options: EstimateAiFileEligibilityOptions = {}
): Promise<EstimateAiFileEligibility> {
	return staticEligibility(file, getEstimateAiStaticPolicy(file.file_path, file.mime_type));
}

export async function resolveEstimateAiFileEligibilities(
	files: AssetFile[],
	options: EstimateAiFileEligibilityOptions = {}
): Promise<EstimateAiFileEligibility[]> {
	return Promise.all(files.map((file) => resolveEstimateAiFileEligibility(file, options)));
}

export function summariseEstimateAiFileEligibilities(
	statuses: EstimateAiFileEligibility[]
): EstimateAiFileEligibilitySummary {
	const eligibleFiles = statuses.filter((status) => status.status === 'eligible');
	const ineligibleFiles = statuses.filter((status) => status.status === 'ineligible');
	return {
		hasEligibleFiles: eligibleFiles.length > 0,
		eligibleFiles,
		ineligibleFiles
	};
}
