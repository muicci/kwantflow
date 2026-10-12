/**
 * Agent memory service — lightweight persistent memory for the local AI agent.
 *
 * Stores key facts learned from user interactions and injects them into the
 * system prompt on subsequent requests. Uses the Tauri Store plugin for
 * persistence across sessions.
 *
 * Memory categories:
 * - preference: user defaults (e.g. "prefers company by default", "AUD currency")
 * - supplier: frequently used suppliers
 * - pattern: learned interaction patterns (e.g. "user typically adds materials with spec field")
 * - rate: frequently used rates/markups
 */

import { storeService } from '$lib/services/store.js';
import { createLogger } from '$lib/services/logger.js';

const log = createLogger('agent-memory');

export type AgentMemoryCategory = 'preference' | 'supplier' | 'pattern' | 'rate';

export interface AgentMemoryEntry {
	key: string;
	value: string;
	category: AgentMemoryCategory;
	createdAt: string;
	updatedAt: string;
	accessCount: number;
}

const STORE_KEY = 'agentMemory';
const MAX_ENTRIES = 50;
const STALE_DAYS = 90;
const MS_PER_DAY = 86_400_000;

async function loadMemory(): Promise<AgentMemoryEntry[]> {
	try {
		const raw = await storeService.get<AgentMemoryEntry[]>(STORE_KEY);
		return Array.isArray(raw) ? raw : [];
	} catch (err) {
		log.warn('Failed to load agent memory from store', { err });
		return [];
	}
}

async function saveMemory(entries: AgentMemoryEntry[]): Promise<void> {
	try {
		await storeService.set(STORE_KEY, entries);
	} catch (err) {
		log.warn('Failed to persist agent memory', { err });
	}
}

/**
 * Remove entries older than STALE_DAYS that haven't been accessed recently.
 * Preserves frequently-accessed memories regardless of age.
 */
function pruneStaleEntries(entries: AgentMemoryEntry[]): AgentMemoryEntry[] {
	const cutoff = Date.now() - STALE_DAYS * MS_PER_DAY;
	return entries.filter((entry) => {
		// Keep entries accessed recently or accessed more than once (active)
		const updatedAt = new Date(entry.updatedAt).getTime();
		return !isNaN(updatedAt) && (updatedAt >= cutoff || entry.accessCount > 1);
	});
}

/**
 * Record a fact in agent memory. Deduplicates by key.
 */
export async function rememberAgentFact(
	key: string,
	value: string,
	category: AgentMemoryCategory = 'pattern'
): Promise<void> {
	const entries = pruneStaleEntries(await loadMemory());
	const now = new Date().toISOString();
	const existing = entries.find((e) => e.key === key);
	if (existing) {
		existing.value = value;
		existing.updatedAt = now;
		existing.accessCount++;
	} else {
		entries.push({ key, value, category, createdAt: now, updatedAt: now, accessCount: 1 });
		// Trim oldest entries if over limit (least-frequently-accessed first)
		if (entries.length > MAX_ENTRIES) {
			entries.sort((a, b) => a.accessCount - b.accessCount);
			entries.splice(0, entries.length - MAX_ENTRIES);
		}
	}
	await saveMemory(entries);
}

/**
 * Search agent memory for relevant facts. Returns entries whose key or value
 * contain the query string, sorted by access count (most used first).
 */
export async function searchAgentMemory(query: string, limit = 5): Promise<AgentMemoryEntry[]> {
	const entries = await loadMemory();
	const lower = query.toLowerCase();
	const matches = entries.filter(
		(e) => e.key.toLowerCase().includes(lower) || e.value.toLowerCase().includes(lower)
	);
	matches.sort((a, b) => b.accessCount - a.accessCount);
	return matches.slice(0, limit);
}

/**
 * Build a memory context string for injection into the system prompt.
 * Returns empty string if no relevant memories found.
 */
export async function buildAgentMemoryContext(userPrompt: string): Promise<string> {
	const entries = await searchAgentMemory(userPrompt, 3);
	if (entries.length === 0) return '';
	return entries.map((e) => `• ${e.value}`).join('\n');
}

/**
 * Extract learnings from a successful proposal and record them.
 */
export async function learnFromProposal(
	proposalType: string,
	fields: Record<string, unknown>
): Promise<void> {
	const name = String(fields.name || fields.label || '');
	if (!name) return;

	// Record supplier preference
	if (proposalType === 'contacts' && fields.kind === 'company' && name) {
		await rememberAgentFact(`supplier:${name}`, `User works with ${name}`, 'supplier');
	}

	// Record material usage
	if (proposalType === 'materials' && name) {
		const spec = fields.specification ? ` (${fields.specification})` : '';
		await rememberAgentFact(`material:${name}`, `User uses ${name}${spec}`, 'rate');
	}

	// Record rate card preference
	if (['labour_rates', 'equipment_rates', 'subcontract_rates'].includes(proposalType) && name) {
		const rate = fields.default_rate ? ` at $${fields.default_rate}/${fields.unit || 'unit'}` : '';
		await rememberAgentFact(`rate:${name}`, `User uses ${name}${rate}`, 'rate');
	}

	// Record markup preference
	if (proposalType === 'quote_option_presets' && fields.markup_percentage) {
		await rememberAgentFact(
			'pref:default_markup',
			`User typically uses ${fields.markup_percentage}% markup`,
			'preference'
		);
	}
}

/**
 * Clear all agent memory. Used for testing or reset.
 */
export async function clearAgentMemory(): Promise<void> {
	await saveMemory([]);
}
