import { describe, it, expect } from 'vitest';
import {
	formatEstimateAiStatusLabel,
	buildEstimateAiTerminalLines
} from './estimate-ai-progress-terminal.js';

describe('formatEstimateAiStatusLabel', () => {
	it('returns "Stopping" when isCancelling is true, regardless of status', () => {
		expect(formatEstimateAiStatusLabel('drafting', true)).toBe('Stopping');
		expect(formatEstimateAiStatusLabel('queued', true)).toBe('Stopping');
	});

	it('returns correct label for valid status strings', () => {
		expect(formatEstimateAiStatusLabel('queued')).toBe('Queued');
		expect(formatEstimateAiStatusLabel('preprocessing')).toBe('Preparing files');
		expect(formatEstimateAiStatusLabel('extracting')).toBe('Reading evidence');
		expect(formatEstimateAiStatusLabel('drafting')).toBe('Drafting');
		expect(formatEstimateAiStatusLabel('drafted')).toBe('Draft ready');
		expect(formatEstimateAiStatusLabel('applied')).toBe('Ready for review');
		expect(formatEstimateAiStatusLabel('failed')).toBe('Needs attention');
		expect(formatEstimateAiStatusLabel('cancelled')).toBe('Cancelled');
		expect(formatEstimateAiStatusLabel('idle')).toBe('Ready');
	});

	it('returns "Ready" as the fallback for unknown status', () => {
		expect(formatEstimateAiStatusLabel('unknown')).toBe('Ready');
	});
});

describe('buildEstimateAiTerminalLines', () => {
	type BuildTerminalLinesInput = Parameters<typeof buildEstimateAiTerminalLines>[0];

	const createMockInput = (
		overrides?: Partial<BuildTerminalLinesInput>
	): BuildTerminalLinesInput => ({
		status: 'idle',
		runActive: false,
		isCancelling: false,
		progressDetail: {
			supportedArtifactCount: 0,
			unsupportedArtifactCount: 0,
			totalArtifactCount: 0,
			processedArtifactCount: 0,
			usableArtifactCount: 0,
			draftSubphase: 'composition',
			currentArtifactName: null
		},
		progressValueLabel: null,
		errorMessage: null,
		unsupportedFileCount: 0,
		issueCount: 0,
		appliedToEditor: false,
		canApplyPending: false,
		localRuntimeReady: true,
		...overrides
	});

	it('returns setup-required warning if localRuntimeReady is false and status is idle', () => {
		const input = createMockInput({ localRuntimeReady: false, status: 'idle' });
		const lines = buildEstimateAiTerminalLines(input);
		expect(lines).toHaveLength(1);
		expect(lines[0].id).toBe('setup-required');
		expect(lines[0].tone).toBe('warning');
	});

	it('handles preprocessing status without local runtime check when not idle', () => {
		const input = createMockInput({ localRuntimeReady: false, status: 'preprocessing' });
		const lines = buildEstimateAiTerminalLines(input);
		expect(lines.find((l) => l.id === 'setup-required')).toBeUndefined();
		expect(lines.find((l) => l.id === 'source-files')?.tone).toBe('active');
	});

	it('formats source-files detail string correctly for plurals and zero skipped', () => {
		const input = createMockInput({
			progressDetail: {
				...createMockInput().progressDetail,
				supportedArtifactCount: 2,
				unsupportedArtifactCount: 0,
				totalArtifactCount: 2,
				processedArtifactCount: 1
			}
		});
		const lines = buildEstimateAiTerminalLines(input);
		const sourceFilesLine = lines.find((l) => l.id === 'source-files');
		expect(sourceFilesLine?.detail).toBe('1 of 2 files reviewed');
	});

	it('formats source-files detail string correctly with skipped files', () => {
		const input = createMockInput({
			progressDetail: {
				...createMockInput().progressDetail,
				supportedArtifactCount: 2,
				unsupportedArtifactCount: 1,
				totalArtifactCount: 3,
				processedArtifactCount: 1
			}
		});
		const lines = buildEstimateAiTerminalLines(input);
		const sourceFilesLine = lines.find((l) => l.id === 'source-files');
		expect(sourceFilesLine?.detail).toBe('2 of 3 files reviewed · 1 skipped');
	});

	it('keeps failed evidence units visible after every source file reaches a terminal state', () => {
		const input = createMockInput({
			progressDetail: {
				...createMockInput().progressDetail,
				supportedArtifactCount: 3,
				totalArtifactCount: 3,
				processedArtifactCount: 3,
				failedEvidenceUnitCount: 1
			}
		});
		const lines = buildEstimateAiTerminalLines(input);
		const sourceFilesLine = lines.find((line) => line.id === 'source-files');
		expect(sourceFilesLine?.detail).toBe('3 of 3 files reviewed · 1 evidence unit needs review');
	});

	it('displays current artifact waiting in preprocessing status', () => {
		const input = createMockInput({ status: 'preprocessing' });
		const lines = buildEstimateAiTerminalLines(input);
		const waitLine = lines.find((l) => l.id === 'current-artifact-waiting');
		expect(waitLine).toBeDefined();
		expect(waitLine?.tone).toBe('active');
	});

	it('displays current artifact being reviewed in extracting status with counts', () => {
		const input = createMockInput({
			status: 'extracting',
			progressDetail: {
				...createMockInput().progressDetail,
				currentArtifactName: 'test.pdf',
				processedArtifactCount: 2
			}
		});
		const lines = buildEstimateAiTerminalLines(input);
		const currentLine = lines.find((l) => l.id === 'current-artifact');
		expect(currentLine?.message).toBe('Reviewing test.pdf');
		expect(currentLine?.detail).toBe('2 files reviewed');
		expect(currentLine?.tone).toBe('active');
	});

	it('displays current artifact being reviewed with singular form', () => {
		const input = createMockInput({
			status: 'extracting',
			progressDetail: {
				...createMockInput().progressDetail,
				currentArtifactName: 'test.pdf',
				processedArtifactCount: 1
			}
		});
		const lines = buildEstimateAiTerminalLines(input);
		const currentLine = lines.find((l) => l.id === 'current-artifact');
		expect(currentLine?.detail).toBe('1 file reviewed');
	});

	it('displays extracting useful details in extracting status with plural form', () => {
		const input = createMockInput({
			status: 'extracting',
			progressDetail: {
				...createMockInput().progressDetail,
				usableArtifactCount: 2
			}
		});
		const lines = buildEstimateAiTerminalLines(input);
		const extractLine = lines.find((l) => l.id === 'extracting');
		expect(extractLine?.tone).toBe('active');
		expect(extractLine?.detail).toBe('2 useful files');
	});

	it('displays extracting useful details with singular form', () => {
		const input = createMockInput({
			status: 'extracting',
			progressDetail: {
				...createMockInput().progressDetail,
				usableArtifactCount: 1
			}
		});
		const lines = buildEstimateAiTerminalLines(input);
		const extractLine = lines.find((l) => l.id === 'extracting');
		expect(extractLine?.detail).toBe('1 useful file');
	});

	it('displays drafting messages based on subphase in drafting status', () => {
		const inputOutline = createMockInput({
			status: 'drafting',
			progressDetail: { ...createMockInput().progressDetail, draftSubphase: 'outline' }
		});
		const linesOutline = buildEstimateAiTerminalLines(inputOutline);
		expect(linesOutline.find((l) => l.id === 'drafting')?.message).toBe(
			'Working through the estimate'
		);

		const inputMatching = createMockInput({
			status: 'drafting',
			progressDetail: { ...createMockInput().progressDetail, draftSubphase: 'matching' }
		});
		const linesMatching = buildEstimateAiTerminalLines(inputMatching);
		expect(linesMatching.find((l) => l.id === 'drafting')?.message).toBe(
			'Matching workspace items'
		);

		const inputValidation = createMockInput({
			status: 'drafting',
			progressDetail: { ...createMockInput().progressDetail, draftSubphase: 'validation' }
		});
		const linesValidation = buildEstimateAiTerminalLines(inputValidation);
		expect(linesValidation.find((l) => l.id === 'drafting')?.message).toBe(
			'Checking the draft against the files'
		);
	});

	it('handles isCancelling state correctly', () => {
		const input = createMockInput({ isCancelling: true, status: 'drafting' });
		const lines = buildEstimateAiTerminalLines(input);
		expect(lines.find((l) => l.id === 'cancelling')).toBeDefined();
		expect(lines.find((l) => l.id === 'cancelling')?.tone).toBe('warning');
		expect(lines.find((l) => l.id === 'drafting')?.tone).toBe('warning'); // activeStatus is 'cancelling'
	});

	it('handles failed state correctly', () => {
		const input = createMockInput({ status: 'failed', errorMessage: 'Test error message' });
		const lines = buildEstimateAiTerminalLines(input);
		expect(lines.find((l) => l.id === 'failed')).toBeDefined();
		expect(lines.find((l) => l.id === 'failed')?.detail).toBe('Test error message');
		expect(lines.find((l) => l.id === 'failed')?.tone).toBe('error');
	});

	it('handles cancelled state correctly', () => {
		const input = createMockInput({ status: 'cancelled' });
		const lines = buildEstimateAiTerminalLines(input);
		expect(lines.find((l) => l.id === 'cancelled')).toBeDefined();
		expect(lines.find((l) => l.id === 'cancelled')?.tone).toBe('warning');
		expect(lines.find((l) => l.id === 'drafting')).toBeUndefined();
	});

	it('handles applied state appliedToEditor=true', () => {
		const input = createMockInput({ status: 'applied', appliedToEditor: true });
		const lines = buildEstimateAiTerminalLines(input);
		const appliedLine = lines.find((l) => l.id === 'applied');
		expect(appliedLine).toBeDefined();
		expect(appliedLine?.message).toBe('Draft added to the editor');
		expect(appliedLine?.tone).toBe('success');
	});

	it('handles applied state appliedToEditor=false', () => {
		const input = createMockInput({ status: 'applied', appliedToEditor: false });
		const lines = buildEstimateAiTerminalLines(input);
		const appliedLine = lines.find((l) => l.id === 'applied');
		expect(appliedLine).toBeDefined();
		expect(appliedLine?.message).toBe('Draft ready');
		expect(appliedLine?.tone).toBe('success');
	});

	it('displays ready-to-apply if canApplyPending is true', () => {
		const input = createMockInput({ status: 'idle', canApplyPending: true });
		const lines = buildEstimateAiTerminalLines(input);
		expect(lines.find((l) => l.id === 'ready-to-apply')).toBeDefined();
	});

	it('displays attention messages for issues with singular/plural', () => {
		const inputSingular = createMockInput({ issueCount: 1 });
		const linesSingular = buildEstimateAiTerminalLines(inputSingular);
		expect(linesSingular.find((l) => l.id === 'attention')?.detail).toBe('1 item need attention'); // NOTE: code currently renders "1 item need attention" although "needs attention" is grammatically correct. Test validates current behavior.

		const inputPlural = createMockInput({ issueCount: 2 });
		const linesPlural = buildEstimateAiTerminalLines(inputPlural);
		expect(linesPlural.find((l) => l.id === 'attention')?.detail).toBe('2 items need attention');
		expect(linesPlural.find((l) => l.id === 'attention')?.tone).toBe('warning');
	});

	it('appends non-blocking information if runActive is true', () => {
		const input = createMockInput({ runActive: true, status: 'drafting' });
		const lines = buildEstimateAiTerminalLines(input);
		expect(lines.find((l) => l.id === 'thinking')).toBeDefined();
		expect(lines.find((l) => l.id === 'non-blocking')).toBeDefined();
	});
});
