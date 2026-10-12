import type { AiRunProgressDetail } from '$lib/types/index.js';

export type EstimateAiTerminalLineTone = 'pending' | 'active' | 'success' | 'warning' | 'error';

export type EstimateAiTerminalLine = {
	id: string;
	message: string;
	detail?: string | null;
	prefix?: string;
	tone: EstimateAiTerminalLineTone;
};

type BuildTerminalLinesInput = {
	status: string;
	runActive: boolean;
	isCancelling: boolean;
	progressDetail: AiRunProgressDetail;
	progressValueLabel?: string | null;
	errorMessage?: string | null;
	unsupportedFileCount: number;
	issueCount: number;
	appliedToEditor: boolean;
	canApplyPending: boolean;
	localRuntimeReady: boolean;
};

function artifactSummary(detail: AiRunProgressDetail): string | null {
	const supported = detail.supportedArtifactCount || detail.totalArtifactCount;
	const skipped = detail.unsupportedArtifactCount;
	const totalSourceFiles = supported + skipped;
	if (totalSourceFiles <= 0) return null;
	const processed = Math.min(detail.processedArtifactCount + skipped, totalSourceFiles);
	const parts = [`${processed} of ${totalSourceFiles} files reviewed`];
	const incompleteEvidenceUnits =
		(detail.failedEvidenceUnitCount ?? 0) + (detail.omittedEvidenceUnitCount ?? 0);
	if (incompleteEvidenceUnits > 0) {
		parts.push(
			`${incompleteEvidenceUnits} evidence unit${incompleteEvidenceUnits === 1 ? ' needs' : 's need'} review`
		);
	}
	if (skipped > 0) {
		parts.push(`${skipped} skipped`);
	}
	return parts.join(' · ');
}

export function formatEstimateAiStatusLabel(status: string, isCancelling = false): string {
	if (isCancelling) return 'Stopping';
	switch (status) {
		case 'queued':
			return 'Queued';
		case 'preprocessing':
			return 'Preparing files';
		case 'extracting':
			return 'Reading evidence';
		case 'drafting':
			return 'Drafting';
		case 'drafted':
			return 'Draft ready';
		case 'applied':
			return 'Ready for review';
		case 'failed':
			return 'Needs attention';
		case 'cancelled':
			return 'Cancelled';
		case 'idle':
		default:
			return 'Ready';
	}
}

function draftSubphaseMessage(subphase: AiRunProgressDetail['draftSubphase']): string {
	switch (subphase) {
		case 'outline':
			return 'Working through the estimate';
		case 'matching':
			return 'Matching workspace items';
		case 'validation':
			return 'Checking the draft against the files';
		case 'composition':
		default:
			return 'Building your draft';
	}
}

function withPrefixes(lines: EstimateAiTerminalLine[]): EstimateAiTerminalLine[] {
	return lines.map((line) => ({
		...line,
		prefix: ''
	}));
}

export function buildEstimateAiTerminalLines(
	input: BuildTerminalLinesInput
): EstimateAiTerminalLine[] {
	const lines: EstimateAiTerminalLine[] = [];
	const activeStatus = input.isCancelling ? 'cancelling' : input.status;
	const progressDetail = input.progressDetail;
	const artifactDetail = artifactSummary(progressDetail);

	if (!input.localRuntimeReady && input.status === 'idle') {
		return withPrefixes([
			{
				id: 'setup-required',
				message: 'Set up Kwantflow AI',
				detail: 'You can keep estimating manually while Kwantflow AI is being set up.',
				tone: 'warning'
			}
		]);
	}

	lines.push({
		id: 'source-files',
		message: 'Getting your files ready',
		detail:
			artifactDetail ?? 'Checking the files and keeping the ones that can help with the draft.',
		tone:
			activeStatus === 'preprocessing'
				? 'active'
				: ['extracting', 'drafting', 'applied', 'cancelled'].includes(activeStatus)
					? 'success'
					: 'pending'
	});

	if (progressDetail.currentArtifactName) {
		lines.push({
			id: 'current-artifact',
			message: `Reviewing ${progressDetail.currentArtifactName}`,
			detail: progressDetail.processedArtifactCount
				? `${progressDetail.processedArtifactCount} file${progressDetail.processedArtifactCount === 1 ? '' : 's'} reviewed`
				: 'Preparing text, image, PDF, and CAD files for the draft.',
			tone: activeStatus === 'extracting' ? 'active' : 'success'
		});
	} else if (['preprocessing', 'extracting', 'drafting'].includes(activeStatus)) {
		lines.push({
			id: 'current-artifact-waiting',
			message: 'Waiting for the next file',
			detail: 'The next file is being prepared.',
			tone: activeStatus === 'preprocessing' ? 'active' : 'pending'
		});
	}

	lines.push({
		id: 'extracting',
		message: 'Pulling out useful details',
		detail: progressDetail.usableArtifactCount
			? `${progressDetail.usableArtifactCount} useful file${progressDetail.usableArtifactCount === 1 ? '' : 's'}`
			: 'Looking for quantities, materials, notes, and drawing references.',
		tone:
			activeStatus === 'extracting'
				? 'active'
				: ['drafting', 'applied', 'cancelled'].includes(activeStatus)
					? 'success'
					: 'pending'
	});

	if (input.status !== 'cancelled') {
		lines.push({
			id: 'drafting',
			message: draftSubphaseMessage(progressDetail.draftSubphase),
			detail:
				input.progressValueLabel ?? 'Turning the file details into takeoffs, costs, and notes.',
			tone:
				activeStatus === 'drafting'
					? 'active'
					: activeStatus === 'applied'
						? 'success'
						: activeStatus === 'cancelling'
							? 'warning'
							: 'pending'
		});
	}

	if (input.isCancelling) {
		lines.push({
			id: 'cancelling',
			message: 'Stopping AI draft',
			detail: 'Your changes won’t be saved while we stop the draft.',
			tone: 'warning'
		});
	} else if (input.status === 'failed') {
		lines.push({
			id: 'failed',
			message: 'Draft stopped',
			detail: input.errorMessage ?? 'You can keep estimating manually.',
			tone: 'error'
		});
	} else if (input.status === 'cancelled') {
		lines.push({
			id: 'cancelled',
			message: 'Draft cancelled',
			detail: 'Nothing was changed.',
			tone: 'warning'
		});
	} else if (input.status === 'applied') {
		lines.push({
			id: 'applied',
			message: input.appliedToEditor ? 'Draft added to the editor' : 'Draft ready',
			detail: input.appliedToEditor
				? 'Check the quantities, rates, matches, and notes before saving.'
				: 'Review the draft before adding it to your takeoffs.',
			tone: 'success'
		});
	} else if (input.canApplyPending) {
		lines.push({
			id: 'ready-to-apply',
			message: 'Draft ready',
			detail: 'Review the flagged items before adding it to your takeoffs.',
			tone: 'success'
		});
	}

	if (input.issueCount > 0) {
		lines.push({
			id: 'attention',
			message: 'Ready for review',
			detail: `${input.issueCount} item${input.issueCount === 1 ? '' : 's'} need attention`,
			tone: 'warning'
		});
	}

	if (input.runActive) {
		lines.push({
			id: 'thinking',
			message: 'AI is working through the estimate',
			detail: 'Only the draft, issues, and evidence are kept.',
			tone: activeStatus === 'drafting' ? 'active' : 'pending'
		});
		lines.push({
			id: 'non-blocking',
			message: 'You can keep working',
			detail: 'You can keep reviewing files while it works.',
			tone: 'pending'
		});
	}

	return withPrefixes(lines);
}
