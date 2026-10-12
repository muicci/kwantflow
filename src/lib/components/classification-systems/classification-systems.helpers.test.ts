import { describe, expect, it } from 'vitest';
import {
	getClassificationRouteSyncAction,
	normaliseClassificationSystemId,
	shouldShowCostCodeSheet
} from './classification-systems.helpers.js';

describe('classification systems helpers', () => {
	it('normalises undefined selection values to null', () => {
		expect(normaliseClassificationSystemId(undefined)).toBeNull();
		expect(normaliseClassificationSystemId(null)).toBeNull();
		expect(normaliseClassificationSystemId('cls-1')).toBe('cls-1');
	});

	it('clears stale active detail when the list route is open', () => {
		expect(
			getClassificationRouteSyncAction({
				selectedSystemId: undefined,
				activeSystemId: 'cls-1',
				availableSystemIds: ['cls-1']
			})
		).toEqual({ type: 'clear' });
	});

	it('selects the requested classification system when the detail route is valid', () => {
		expect(
			getClassificationRouteSyncAction({
				selectedSystemId: 'cls-1',
				activeSystemId: null,
				availableSystemIds: ['cls-1']
			})
		).toEqual({ type: 'select', systemId: 'cls-1' });
	});

	it('recovers missing classification detail routes back to the list route', () => {
		expect(
			getClassificationRouteSyncAction({
				selectedSystemId: 'missing-system',
				activeSystemId: null,
				availableSystemIds: []
			})
		).toEqual({ type: 'recover-missing-route', systemId: 'missing-system' });
	});

	it('does nothing when route and active selection already agree', () => {
		expect(
			getClassificationRouteSyncAction({
				selectedSystemId: 'cls-1',
				activeSystemId: 'cls-1',
				availableSystemIds: ['cls-1']
			})
		).toEqual({ type: 'noop' });
	});

	it('shows the sheet only when there is an active system and the panel is not docked', () => {
		expect(shouldShowCostCodeSheet('cls-1', false)).toBe(true);
		expect(shouldShowCostCodeSheet('cls-1', true)).toBe(false);
		expect(shouldShowCostCodeSheet(null, false)).toBe(false);
	});
});
