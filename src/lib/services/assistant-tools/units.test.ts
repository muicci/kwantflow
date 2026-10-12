import { describe, expect, it } from 'vitest';
import { convertEstimatorUnit } from './units.js';

describe('convertEstimatorUnit', () => {
	it('converts length units correctly', () => {
		const mmToM = convertEstimatorUnit({ value: '1250', fromUnit: 'mm', toUnit: 'm' });
		expect(mmToM.value).toBe('1.25');
		expect(mmToM.fromUnit).toBe('mm');
		expect(mmToM.toUnit).toBe('m');

		const inToFt = convertEstimatorUnit({ value: '24', fromUnit: 'in', toUnit: 'ft' });
		expect(inToFt.value).toBe('2');
		expect(inToFt.fromUnit).toBe('in');
		expect(inToFt.toUnit).toBe('ft');
	});

	it('converts area units correctly', () => {
		const m2ToFt2 = convertEstimatorUnit({
			value: '10',
			fromUnit: 'm2',
			toUnit: 'ft2',
			decimalPlaces: 4
		});
		// 10 m2 = 10 / 0.09290304 ft2 = 107.6391
		expect(m2ToFt2.value).toBe('107.6391');
		expect(m2ToFt2.fromUnit).toBe('m2');
		expect(m2ToFt2.toUnit).toBe('ft2');
	});

	it('converts volume units correctly', () => {
		const m3ToL = convertEstimatorUnit({ value: '2.5', fromUnit: 'm3', toUnit: 'L' });
		expect(m3ToL.value).toBe('2500');
		expect(m3ToL.fromUnit).toBe('m3');
		expect(m3ToL.toUnit).toBe('L');
	});

	it('converts mass units correctly', () => {
		const kgToLb = convertEstimatorUnit({
			value: '10',
			fromUnit: 'kg',
			toUnit: 'lb',
			decimalPlaces: 4
		});
		// 10 / 0.45359237 = 22.0462
		expect(kgToLb.value).toBe('22.0462');
		expect(kgToLb.fromUnit).toBe('kg');
		expect(kgToLb.toUnit).toBe('lb');
	});

	it('converts time units correctly with workdayHours', () => {
		const result = convertEstimatorUnit({
			value: '2',
			fromUnit: 'week',
			toUnit: 'hr',
			workdayHours: '8',
			workWeekDays: '6'
		});
		// 2 weeks * 6 days/week * 8 hours/day = 96 hours
		expect(result.value).toBe('96');
		expect(result.fromUnit).toBe('week');
		expect(result.toUnit).toBe('hr');
	});

	it('applies decimalPlaces correctly', () => {
		const res = convertEstimatorUnit({ value: '1', fromUnit: 'm', toUnit: 'ft', decimalPlaces: 2 });
		// 1 / 0.3048 = 3.280839895... -> 3.28
		expect(res.value).toBe('3.28');
	});

	it('rejects cross-family conversions', () => {
		expect(() => convertEstimatorUnit({ value: '1', fromUnit: 'm', toUnit: 'kg' })).toThrow(
			/Ambiguous unit conversion/
		);
	});

	it('rejects time conversions missing workdayHours', () => {
		expect(() => convertEstimatorUnit({ value: '1', fromUnit: 'day', toUnit: 'hr' })).toThrow(
			/Ambiguous unit conversion involving day. Provide workdayHours./
		);

		expect(() => convertEstimatorUnit({ value: '1', fromUnit: 'week', toUnit: 'hr' })).toThrow(
			/Ambiguous unit conversion involving week. Provide workdayHours./
		);

		expect(() => convertEstimatorUnit({ value: '1', fromUnit: 'shift', toUnit: 'hr' })).toThrow(
			/Ambiguous unit conversion involving shift. Provide workdayHours./
		);
	});

	it('rejects ambiguous count conversions', () => {
		expect(() => convertEstimatorUnit({ value: '2', fromUnit: 'lot', toUnit: 'ea' })).toThrow(
			/Ambiguous unit conversion/
		);
	});

	it('rejects invalid numeric values', () => {
		expect(() => convertEstimatorUnit({ value: 'abc', fromUnit: 'm', toUnit: 'mm' })).toThrow(
			/Invalid decimal/
		);
	});
});
