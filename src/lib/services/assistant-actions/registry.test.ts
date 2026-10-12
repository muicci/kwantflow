import { describe, it, expect } from 'vitest';
import {
	getAssistantActionDefinition,
	getAssistantToolDeclarations,
	assistantActionRegistry
} from './registry';

describe('assistant-actions registry', () => {
	describe('getAssistantActionDefinition', () => {
		it('returns the definition for a known action', () => {
			const def = getAssistantActionDefinition('records_search');
			expect(def).not.toBeNull();
			expect(def?.name).toBe('records_search');
			expect(def?.intent).toBe('record_lookup');
		});

		it('returns null for an unknown action', () => {
			const def = getAssistantActionDefinition('does_not_exist_action');
			expect(def).toBeNull();
		});
	});

	describe('getAssistantToolDeclarations', () => {
		it('returns tool declarations for all registered actions', () => {
			const tools = getAssistantToolDeclarations();

			expect(Array.isArray(tools)).toBe(true);

			expect(tools.length).toBe(Object.keys(assistantActionRegistry).length);
			expect(tools.length).toBeGreaterThan(0);

			const firstTool = tools[0];
			expect(firstTool.type).toBe('function');
			expect(firstTool.function).toHaveProperty('name');
			expect(firstTool.function).toHaveProperty('description');
			expect(firstTool.function).toHaveProperty('parameters');

			const names = tools.map((t) => t.function.name);
			expect(names).toContain('records_search');
			expect(names).toContain('calculator_evaluate_decimal');
			expect(names).toContain('contact_change');
		});
	});
});
