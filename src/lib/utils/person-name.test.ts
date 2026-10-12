import { describe, expect, it } from 'vitest';

import {
	buildPersonDisplayName,
	resolvePersonNameParts,
	splitPersonDisplayName
} from './person-name.js';

describe('person-name helpers', () => {
	it('builds a display name from first and last names', () => {
		expect(buildPersonDisplayName('Sam', 'Owner')).toBe('Sam Owner');
		expect(buildPersonDisplayName('Sam', '')).toBe('Sam');
	});

	it('splits a full display name into first and last names', () => {
		expect(splitPersonDisplayName('Sam Owner')).toEqual({
			firstName: 'Sam',
			lastName: 'Owner',
			displayName: 'Sam Owner'
		});
		expect(splitPersonDisplayName('Madonna')).toEqual({
			firstName: 'Madonna',
			lastName: '',
			displayName: 'Madonna'
		});
	});

	it('prefers structured parts and falls back to a display name split', () => {
		expect(
			resolvePersonNameParts({
				firstName: 'Sam',
				lastName: 'Owner',
				displayName: 'Ignored Value'
			})
		).toEqual({
			firstName: 'Sam',
			lastName: 'Owner',
			displayName: 'Sam Owner'
		});

		expect(resolvePersonNameParts({ displayName: 'Jamie Estimator' })).toEqual({
			firstName: 'Jamie',
			lastName: 'Estimator',
			displayName: 'Jamie Estimator'
		});
	});
});
