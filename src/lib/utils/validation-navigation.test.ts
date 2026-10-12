import { describe, expect, it } from 'vitest';

import { findFirstErrorField } from './validation-navigation';

describe('findFirstErrorField', () => {
	it('returns the first field in the declared order with errors', () => {
		expect(
			findFirstErrorField(['name', 'unit', 'default_rate'] as const, {
				unit: ['Unit is required'],
				default_rate: ['Rate is required']
			})
		).toBe('unit');
	});

	it('returns null when no declared fields have errors', () => {
		expect(
			findFirstErrorField(['name', 'unit'] as const, {
				category: ['Not part of the form order']
			})
		).toBeNull();
	});
});
