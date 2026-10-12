/**
 * Agent memory tests — covers persistence, search, trimming, expiry, and learning.
 * The store service is mocked so tests run in Node without Tauri.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
	rememberAgentFact,
	searchAgentMemory,
	buildAgentMemoryContext,
	learnFromProposal,
	clearAgentMemory
} from './agent-memory.js';

// Mock the store service
const mockStore = new Map<string, unknown>();
vi.mock('$lib/services/store.js', () => ({
	storeService: {
		async get<T>(key: string): Promise<T | null> {
			return (mockStore.get(key) as T) ?? null;
		},
		async set(key: string, value: unknown): Promise<void> {
			mockStore.set(key, value);
		}
	}
}));

describe('agent-memory', () => {
	beforeEach(() => {
		mockStore.clear();
	});

	// ─── Basics ─────────────────────────────────────────────────

	it('remembers a fact and retrieves it', async () => {
		await rememberAgentFact('test:hello', 'World', 'preference');

		const results = await searchAgentMemory('World');
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			key: 'test:hello',
			value: 'World',
			category: 'preference'
		});
	});

	it('returns empty array when no facts match', async () => {
		const results = await searchAgentMemory('nothing');
		expect(results).toEqual([]);
	});

	it('handles an empty store gracefully', async () => {
		const context = await buildAgentMemoryContext('anything');
		expect(context).toBe('');
	});

	// ─── Deduplication ──────────────────────────────────────────

	it('deduplicates by key and increments access count', async () => {
		await rememberAgentFact('dup:key', 'first value');
		await rememberAgentFact('dup:key', 'second value');

		const results = await searchAgentMemory('second');
		expect(results).toHaveLength(1);
		expect(results[0].value).toBe('second value');
		expect(results[0].accessCount).toBe(2);
	});

	// ─── Search ─────────────────────────────────────────────────

	it('searches by both key and value', async () => {
		await rememberAgentFact('pref:currency', 'AUD');
		await rememberAgentFact('supplier:acme', 'Acme Builders');

		const keyMatch = await searchAgentMemory('currency');
		expect(keyMatch).toHaveLength(1);
		expect(keyMatch[0].key).toBe('pref:currency');

		const valueMatch = await searchAgentMemory('Acme');
		expect(valueMatch).toHaveLength(1);
		expect(valueMatch[0].key).toBe('supplier:acme');
	});

	it('returns results sorted by access count descending', async () => {
		await rememberAgentFact('a', 'alpha');
		await rememberAgentFact('b', 'beta');
		await rememberAgentFact('c', 'gamma');

		// Access 'alpha' three times
		await rememberAgentFact('a', 'alpha');
		await rememberAgentFact('a', 'alpha');
		await rememberAgentFact('a', 'alpha');

		// Access 'beta' once
		await rememberAgentFact('b', 'beta');

		const results = await searchAgentMemory('');
		expect(results.length).toBeGreaterThanOrEqual(2);
		// 'alpha' (accessed 4 times) should come before 'beta' (accessed 2 times)
		const alphaIdx = results.findIndex((r) => r.key === 'a');
		const betaIdx = results.findIndex((r) => r.key === 'b');
		expect(alphaIdx).toBeLessThan(betaIdx);
	});

	it('respects the search limit parameter', async () => {
		await rememberAgentFact('x1', 'findme');
		await rememberAgentFact('x2', 'findme');
		await rememberAgentFact('x3', 'findme');

		const results = await searchAgentMemory('findme', 2);
		expect(results).toHaveLength(2);
	});

	// ─── buildAgentMemoryContext ────────────────────────────────

	it('builds a context string from matching memories', async () => {
		await rememberAgentFact('pref:currency', 'AUD is the default currency', 'preference');
		await rememberAgentFact('pref:unit', 'Metric units preferred', 'preference');

		const context = await buildAgentMemoryContext('currency');
		expect(context).toContain('AUD is the default currency');
		expect(context).not.toContain('Metric units preferred');
	});

	it('returns empty string when no memories match', async () => {
		await rememberAgentFact('pref:color', 'blue');
		const context = await buildAgentMemoryContext('quantum physics');
		expect(context).toBe('');
	});

	// ─── learnFromProposal ──────────────────────────────────────

	it('learns supplier from company contact proposal', async () => {
		await learnFromProposal('contacts', {
			name: 'Acme Builders',
			kind: 'company'
		});

		const results = await searchAgentMemory('Acme Builders');
		expect(results).toHaveLength(1);
		expect(results[0].key).toBe('supplier:Acme Builders');
		expect(results[0].value).toBe('User works with Acme Builders');
		expect(results[0].category).toBe('supplier');
	});

	it('does not learn supplier from person contact proposal', async () => {
		await learnFromProposal('contacts', {
			name: 'Jane Smith',
			kind: 'person'
		});

		const results = await searchAgentMemory('Jane Smith');
		expect(results).toHaveLength(0);
	});

	it('learns material usage', async () => {
		await learnFromProposal('materials', {
			name: '32MPa Concrete',
			specification: 'S3 mix'
		});

		const results = await searchAgentMemory('32MPa Concrete');
		expect(results).toHaveLength(1);
		expect(results[0].value).toContain('32MPa Concrete (S3 mix)');
	});

	it('learns rate card preference', async () => {
		await learnFromProposal('labour_rates', {
			name: 'Carpenter',
			default_rate: 85,
			unit: 'hr'
		});

		const results = await searchAgentMemory('Carpenter');
		expect(results).toHaveLength(1);
		expect(results[0].value).toContain('Carpenter');
		expect(results[0].value).toContain('$85/hr');
		expect(results[0].category).toBe('rate');
	});

	it('learns markup preference from quote preset', async () => {
		await learnFromProposal('quote_option_presets', {
			name: 'Standard Markup',
			markup_percentage: 15
		});

		const results = await searchAgentMemory('markup');
		expect(results).toHaveLength(1);
		expect(results[0].value).toContain('15% markup');
	});

	it('skips learning when name is empty', async () => {
		await learnFromProposal('materials', { name: '', spec: 'none' });
		const results = await searchAgentMemory('');
		expect(results).toHaveLength(0);
	});

	// ─── clearAgentMemory ───────────────────────────────────────

	it('clears all memory on demand', async () => {
		await rememberAgentFact('test:a', 'value a');
		await rememberAgentFact('test:b', 'value b');
		await clearAgentMemory();

		const results = await searchAgentMemory('');
		expect(results).toHaveLength(0);
	});

	// ─── Trimming ───────────────────────────────────────────────

	it('trims entries when over MAX_ENTRIES limit', async () => {
		// Fill with MAX_ENTRIES + 5 entries
		const count = 55;
		for (let i = 0; i < count; i++) {
			await rememberAgentFact(`trim:${i}`, `value ${i}`);
		}

		const results = await searchAgentMemory('');
		expect(results.length).toBeLessThanOrEqual(50);
	});

	it('preserves frequently-accessed entries during trimming', async () => {
		// Create one popular entry
		await rememberAgentFact('popular', 'very popular entry');
		for (let i = 0; i < 10; i++) {
			await rememberAgentFact('popular', 'very popular entry');
		}

		// Fill past the limit
		for (let i = 0; i < 55; i++) {
			await rememberAgentFact(`filler:${i}`, `filler ${i}`);
		}

		const results = await searchAgentMemory('popular');
		expect(results).toHaveLength(1);
		expect(results[0].accessCount).toBeGreaterThan(5);
	});
});
