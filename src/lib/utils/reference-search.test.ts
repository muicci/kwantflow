import { describe, expect, it } from 'vitest';

import {
	buildReferenceSearchTerms,
	normaliseReferenceSearchText,
	stripTrailingReferenceQuantityHint
} from './reference-search';

describe('reference search normalisation', () => {
	it('strips trailing quantity hints from colon suffixes', () => {
		expect(stripTrailingReferenceQuantityHint('Structural steel canopy package: 1 lot')).toBe(
			'Structural steel canopy package'
		);
	});

	it('strips trailing quantity hints from dot spacing suffixes', () => {
		expect(stripTrailingReferenceQuantityHint('Structural steel canopy package . 1 lot')).toBe(
			'Structural steel canopy package'
		);
	});

	it('normalises punctuation and quantity suffixes into the same search text', () => {
		expect(normaliseReferenceSearchText('Structural steel canopy package: 1 lot')).toBe(
			'structural steel canopy package'
		);
		expect(normaliseReferenceSearchText('Structural steel canopy package . 1 lot')).toBe(
			'structural steel canopy package'
		);
	});

	it('handles null, undefined and empty strings', () => {
		expect(normaliseReferenceSearchText(null)).toBe('');
		expect(normaliseReferenceSearchText(undefined)).toBe('');
		expect(normaliseReferenceSearchText('')).toBe('');
		expect(normaliseReferenceSearchText('   ')).toBe('');
	});

	it('handles strings with only punctuation or non-alphanumeric characters', () => {
		expect(normaliseReferenceSearchText('!!!')).toBe('');
		expect(normaliseReferenceSearchText('  ---  ')).toBe('');
		expect(normaliseReferenceSearchText('?.,;:')).toBe('');
	});

	it('handles mixed punctuation, multiple spaces and alphanumeric characters', () => {
		expect(normaliseReferenceSearchText('  hello   world  !!!  ')).toBe('hello world');
		expect(normaliseReferenceSearchText('foo-bar')).toBe('foo bar');
		expect(normaliseReferenceSearchText('a...b,,,c')).toBe('a b c');
		expect(normaliseReferenceSearchText('!@#123$%^456&*()')).toBe('123 456');
	});

	it('normalises Australian and US estimating vocabulary into the same match text', () => {
		expect(normaliseReferenceSearchText('After-hours installation labour')).toBe(
			'after hours installation labor'
		);
		expect(normaliseReferenceSearchText('After-hours installation labor')).toBe(
			'after hours installation labor'
		);
		expect(normaliseReferenceSearchText('Steel canopy catalogue')).toBe('steel canopy catalog');
		expect(normaliseReferenceSearchText('Canopy length metres')).toBe('canopy length meters');
	});

	it('expands similar reference terms for broader picker matching', () => {
		expect(buildReferenceSearchTerms('Installers')).toEqual(
			expect.arrayContaining(['installers', 'installer', 'install'])
		);
		expect(buildReferenceSearchTerms('Fabricators')).toEqual(
			expect.arrayContaining(['fabricators', 'fabricator', 'fabricat'])
		);
		expect(buildReferenceSearchTerms('Installation labour')).toEqual(
			expect.arrayContaining(['installation', 'install', 'labor'])
		);
		expect(buildReferenceSearchTerms('Fabrication package')).toEqual(
			expect.arrayContaining(['fabrication', 'fabricat', 'package'])
		);
	});
});
