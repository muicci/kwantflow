import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

if (process.argv.length !== 7) {
	throw new Error(
		'Usage: node verify-rebuild.mjs <rebuilt-dist> <shipped-dist> <wrapper-source> <app-source> <output-json>'
	);
}
const [rebuiltDist, shippedDist, wrapperSource, app, output] = process.argv
	.slice(2)
	.map((path) => resolve(path));
const require = createRequire(import.meta.url);
const candidateFactory = require(join(rebuiltDist, 'occt-import-js.js'));
const shippedFactory = require(join(shippedDist, 'occt-import-js.js'));
const candidateWasm = readFileSync(join(rebuiltDist, 'occt-import-js.wasm'));
const shippedWasm = readFileSync(join(shippedDist, 'occt-import-js.wasm'));
assert.notEqual(
	realpathSync(join(rebuiltDist, 'occt-import-js.wasm')),
	realpathSync(join(shippedDist, 'occt-import-js.wasm')),
	'Comparison requires separate rebuilt and shipped WASM files.'
);
const candidate = await candidateFactory({ wasmBinary: candidateWasm });
const shipped = await shippedFactory({ wasmBinary: shippedWasm });
assert.notStrictEqual(candidate, shipped);
const digest = (value) => createHash('sha256').update(value).digest('hex');

function files(root) {
	return readdirSync(root, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(root, entry.name);
			return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
		})
		.sort();
}

const fixtures = files(join(wrapperSource, 'test/testfiles')).filter((path) =>
	/\.(?:step|stp|iges|igs|brep)$/i.test(path)
);
fixtures.push(join(app, 'tests/fixtures/local-ai-benchmark/source/cad/sample-bracket.step'));
fixtures.push(join(app, 'tests/fixtures/local-ai-benchmark/source/cad/sample-bracket.iges'));
const results = [];

function compare(name, method, bytes, options, expectedSuccess) {
	const left = shipped[method](bytes, options);
	const right = candidate[method](bytes, options);
	assert.deepStrictEqual(right, left, `Complete parser output differs: ${name}`);
	if (expectedSuccess !== undefined) {
		assert.equal(right.success, expectedSuccess, `${name} success`);
	}
	if (expectedSuccess === true) {
		assert.ok(
			right.meshes.some((mesh) => mesh.index.array.length > 0),
			`${name} geometry`
		);
	}
	const result = {
		fixture: name,
		method,
		options,
		inputBytes: bytes.length,
		inputSha256: digest(bytes),
		success: right.success,
		meshes: right.meshes?.length ?? 0,
		indices: right.meshes?.reduce((total, mesh) => total + mesh.index.array.length, 0) ?? 0,
		completeOutputSha256: digest(JSON.stringify(right)),
		completeOutputsExactlyEqual: true
	};
	results.push(result);
	console.log(
		`PASS ${name}: success=${result.success}, meshes=${result.meshes}, indices=${result.indices}`
	);
}

for (const path of fixtures) {
	const method = /\.(?:step|stp)$/i.test(path)
		? 'ReadStepFile'
		: /\.(?:iges|igs)$/i.test(path)
			? 'ReadIgesFile'
			: 'ReadBrepFile';
	compare(
		relative(app, path),
		method,
		readFileSync(path),
		null,
		path.includes('sample-bracket.') ? true : undefined
	);
}

const cube = readFileSync(join(wrapperSource, 'test/testfiles/cube-units/cube-m.step'));
for (const linearUnit of ['millimeter', 'centimeter', 'meter', 'inch', 'foot']) {
	compare(`cube-m.step unit=${linearUnit}`, 'ReadStepFile', cube, { linearUnit }, true);
}
const rounded = readFileSync(join(wrapperSource, 'test/testfiles/rounded-cube/rounded-cube.step'));
for (const options of [
	null,
	{ linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 },
	{ linearDeflectionType: 'absolute_value', linearDeflection: 0.1, angularDeflection: 0.5 },
	{
		linearUnit: 'meter',
		linearDeflectionType: 'absolute_value',
		linearDeflection: 0.0001,
		angularDeflection: 0.5
	}
]) {
	compare(
		`rounded-cube.step deflection=${JSON.stringify(options)}`,
		'ReadStepFile',
		rounded,
		options,
		true
	);
}
for (const method of ['ReadStepFile', 'ReadIgesFile', 'ReadBrepFile']) {
	compare(`${method} empty input`, method, Buffer.alloc(0), null, false);
	compare(
		`${method} invalid input`,
		method,
		Buffer.from('invalid synthetic CAD input\n'),
		null,
		false
	);
}
compare('truncated STEP header', 'ReadStepFile', cube.subarray(0, 64), null, false);

const receipt = {
	scope:
		'Standalone Node parser comparison, using unchanged public upstream fixtures and two original synthetic project fixtures. Complete outputs include assembly names/trees, colors, face groups, positions, normals and triangle indices. No installed-app, browser, all malformed files or byte-identical compiler output claim.',
	node: process.version,
	rebuiltWasm: { bytes: candidateWasm.length, sha256: digest(candidateWasm) },
	shippedWasm: { bytes: shippedWasm.length, sha256: digest(shippedWasm) },
	separateFilesWithExplicitWasmBytesInjectedIntoSeparateFactories: true,
	wasmBytesAreIdentical: candidateWasm.equals(shippedWasm),
	fixturesCompared: fixtures.length,
	casesPassed: results.length,
	completeOutputsExactlyEqual: true,
	results
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
console.log(
	`Complete parser comparison passed ${results.length} cases across ${fixtures.length} fixture files.`
);
