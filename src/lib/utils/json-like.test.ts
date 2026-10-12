import { describe, expect, it } from 'vitest';
import {
	normaliseFunctionCallJsonLikeContent,
	normaliseJsonLikeContent,
	normaliseToolCallArguments
} from './json-like.js';

describe('normaliseJsonLikeContent', () => {
	it('returns plain object payloads unchanged', () => {
		expect(normaliseJsonLikeContent({ status: 'ready' })).toEqual({ status: 'ready' });
	});

	it('parses fenced json payloads', () => {
		expect(normaliseJsonLikeContent('```json\n{"status":"ready"}\n```')).toEqual({
			status: 'ready'
		});
	});

	it('recovers the first balanced json object from a prose preamble', () => {
		expect(
			normaliseJsonLikeContent(
				'This file contains relevant estimating evidence.\n{"summary":"Canopy package","candidateItems":[],"issues":[]}'
			)
		).toEqual({
			summary: 'Canopy package',
			candidateItems: [],
			issues: []
		});
	});

	it('recovers Gemma function-call style structured return arguments for the expected tool', () => {
		expect(
			normaliseFunctionCallJsonLikeContent(
				'kwantflow_return_evidence_batch_extraction(units=[{"unitKey":"pdf:text:1","summary":"shaft drawing","candidateItems":[]}])',
				'kwantflow_return_evidence_batch_extraction'
			)
		).toEqual({
			units: [{ unitKey: 'pdf:text:1', summary: 'shaft drawing', candidateItems: [] }]
		});
	});

	it('recovers Python-like Gemma function-call arguments without accepting the wrong tool', () => {
		expect(
			normaliseFunctionCallJsonLikeContent(
				"kwantflow_return_evidence_batch_extraction(units=[{'unitKey':'cad:metadata','contentClass':'technical_drawing'}])",
				'kwantflow_return_evidence_batch_extraction'
			)
		).toEqual({
			units: [{ unitKey: 'cad:metadata', contentClass: 'technical_drawing' }]
		});
		expect(
			normaliseFunctionCallJsonLikeContent(
				"kwantflow_return_other(units=[{'unitKey':'cad:metadata'}])",
				'kwantflow_return_evidence_batch_extraction'
			)
		).toBeNull();
	});

	it('recovers bare object keys from a Gemma native function-call payload', () => {
		expect(
			normaliseFunctionCallJsonLikeContent(
				'kwantflow_return_evidence_batch_extraction(units=[{unitKey: "cad:metadata", contentClass: "technical_drawing", estimatingUtility: "high", summary: "Machined bracket", estimatingSignals: [], candidateItems: [], issues: []}])',
				'kwantflow_return_evidence_batch_extraction'
			)
		).toEqual({
			units: [
				{
					unitKey: 'cad:metadata',
					contentClass: 'technical_drawing',
					estimatingUtility: 'high',
					summary: 'Machined bracket',
					estimatingSignals: [],
					candidateItems: [],
					issues: []
				}
			]
		});
	});

	it('recovers expected function-call arguments when Gemma omits the closing parenthesis', () => {
		expect(
			normaliseFunctionCallJsonLikeContent(
				'kwantflow_return_evidence_batch_extraction(units=[{"unitKey":"pdf:text:1","summary":"shaft"',
				'kwantflow_return_evidence_batch_extraction'
			)
		).toEqual({
			units: [{ unitKey: 'pdf:text:1', summary: 'shaft' }]
		});
	});

	it('recovers alternate evidence_units function-call argument names', () => {
		expect(
			normaliseFunctionCallJsonLikeContent(
				'kwantflow_return_evidence_batch_extraction(evidence_units=[{"unitKey":"cad:metadata","contentClass":"technical_drawing"}])',
				'kwantflow_return_evidence_batch_extraction'
			)
		).toEqual({
			evidence_units: [{ unitKey: 'cad:metadata', contentClass: 'technical_drawing' }]
		});
	});

	it('recovers raw tool-call argument assignments emitted without a JSON object wrapper', () => {
		expect(
			normaliseToolCallArguments(
				'evidence_units=[{"unitKey":"cad:metadata","contentClass":"technical_drawing"}]',
				'kwantflow_return_evidence_batch_extraction'
			)
		).toEqual({
			evidence_units: [{ unitKey: 'cad:metadata', contentClass: 'technical_drawing' }]
		});
	});

	it('repairs duplicated commas inside recovered JSON objects', () => {
		expect(
			normaliseJsonLikeContent(`{
  "kwantflow_return_evidence_batch_extraction": [
    {
      "unitKey": "cad:metadata",
      ,
      "contentClass": "technical_drawing"
    }
  ]
}`)
		).toEqual({
			kwantflow_return_evidence_batch_extraction: [
				{ unitKey: 'cad:metadata', contentClass: 'technical_drawing' }
			]
		});
	});

	it('recovers truncated JSON payloads through auto-balancing of brackets', () => {
		expect(normaliseJsonLikeContent('{"status":"ready", "metadata": {"model": "gemma"')).toEqual({
			status: 'ready',
			metadata: {
				model: 'gemma'
			}
		});
	});

	it('corrects Gemma 4 constrained decoding double-closing bracket bugs', () => {
		expect(normaliseJsonLikeContent('{"status":"ready", "items": [{"id": 1}] ]')).toEqual({
			status: 'ready',
			items: [{ id: 1 }]
		});

		expect(normaliseJsonLikeContent('{"status":"ready", "items": [[{"id": 1}]]}')).toEqual({
			status: 'ready',
			items: [[{ id: 1 }]]
		});
	});

	it('handles deeply nested arrays and objects safely', () => {
		const deepPayload = '{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}';
		expect(normaliseJsonLikeContent(deepPayload)).toEqual({
			a: { b: { c: { d: { e: { f: 1 } } } } }
		});
	});

	it('handles invalid / non-object JSON values by throwing', () => {
		expect(() => normaliseJsonLikeContent('["array", "only"]')).toThrow();
		expect(() => normaliseJsonLikeContent('"just string"')).toThrow();
		expect(() => normaliseJsonLikeContent(12345)).toThrow();
		expect(normaliseJsonLikeContent(null)).toEqual({});
		expect(normaliseJsonLikeContent(undefined)).toEqual({});
	});

	it('throws when no json object can be recovered', () => {
		expect(() => normaliseJsonLikeContent('This is not JSON at all.')).toThrow(
			/unable to recover a JSON object/
		);
	});

	describe('extreme stress, boundaries and malicious inputs', () => {
		it('handles extremely deeply nested balanced objects without stack overflows', () => {
			let deepString = '';
			for (let i = 0; i < 50; i++) {
				deepString += `{"level${i}":`;
			}
			deepString += '"safe"';
			for (let i = 0; i < 50; i++) {
				deepString += '}';
			}
			const parsed = normaliseJsonLikeContent(deepString);
			expect(parsed.level0).toBeDefined();
		});

		it('handles extremely truncated/corrupted objects gracefully by failing cleanly', () => {
			// Unbalanced quotes
			expect(() => normaliseJsonLikeContent('{"status": "ready, "key": "value"')).toThrow();
			// Missing commas and broken fields are healed when possible
			expect(normaliseJsonLikeContent('{"status": "ready" "key": "value"}')).toEqual({
				status: 'ready',
				key: 'value'
			});
			// Mismatched brackets that cannot be balanced
			expect(() => normaliseJsonLikeContent('{"status": "ready" ] }')).toThrow();
		});

		it('handles giant payloads without freezing or blowing up heap limits', () => {
			const giantString = 'A'.repeat(50_000); // 50KB prose preamble
			const jsonBody = '{"name": "heavy payload"}';
			const combined = `${giantString}\n${jsonBody}`;
			const start = performance.now();
			const result = normaliseJsonLikeContent(combined);
			const elapsed = performance.now() - start;
			expect(result).toEqual({ name: 'heavy payload' });
			expect(elapsed).toBeLessThan(100); // Should run in < 100ms
		});

		it('recovers extremely mangled multi-entity relationship JSON generated by Gemma VLM', () => {
			const rawMangled = `{
  "actions": [
    {
      "localRef": "action-1",
      "intent": "create"
      "recordType": "contacts"
"
      "sourceText": "create a company called China Pty"
"
"extractedFacts": {
        "name": "China Pty"
"kind": "company"
      }
"requiredFieldsMissing": []
"confidence": "high"
    },
    {
      "localRef": "action2"
      "intent":create"
"recordType": "contacts"
"
      "sourceText": "owner is Jack, his 0123 from Brisbane"
"
"extractedFacts": {
        "name": "Jack"
"kind"person"
"phone": "123"
}
"
requiredFieldsMissing": ["company_id"]
"confidence": "medium"
},
    {
      "localRef": "action3"      "intent": "relationship"
"recordType": "contact_relationships"
"
      "source": "owner Jack, his 1 from Brisbane"
"extractedFacts": {
        "from_contact_id": "action2"
_id": "action1"
"
"relationship_type": "owner"
}
"requiredFieldsMissing": []
"confidence"high"
}
  ],
  "ambiguities": [],
  "dependencies": [    {
      "fromLocalRef": "action2"
      "to": "action1"
"type":created_id"
"relationshipType":null
    }
    {
      "from": "action2"      "to": "action1"type"
"created"relationshipType":null
    }
    ]
}`;
			const parsed = normaliseJsonLikeContent(rawMangled) as {
				actions: Array<{ localRef: string; extractedFacts: { to_contact_id: string } }>;
				dependencies: Array<{ fromLocalRef: string; toLocalRef: string; type: string }>;
			};
			expect(parsed.actions).toHaveLength(3);
			expect(parsed.dependencies).toHaveLength(2);
			expect(parsed.actions[0].localRef).toBe('action-1');
			expect(parsed.actions[1].localRef).toBe('action2');
			expect(parsed.actions[2].localRef).toBe('action3');
			expect(parsed.actions[2].extractedFacts.to_contact_id).toBe('action1');
			expect(parsed.dependencies[1].fromLocalRef).toBe('action2');
			expect(parsed.dependencies[1].toLocalRef).toBe('action1');
			expect(parsed.dependencies[1].type).toBe('created');
		});
	});
});
