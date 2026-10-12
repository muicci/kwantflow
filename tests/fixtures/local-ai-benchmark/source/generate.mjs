// Original synthetic benchmark inputs. No customer or downloaded image content.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import XLSX from 'xlsx';

const root = dirname(fileURLToPath(import.meta.url));
const date = new Date('2026-10-10T00:00:00Z');
function put(name, bytes) {
	mkdirSync(dirname(join(root, name)), { recursive: true });
	writeFileSync(join(root, name), bytes);
}

// Closed six-face BREP of an 80 x 60 x 10 mm plate, using shared edges/vertices.
const entities = [];
const entity = (value) => {
	const reference = `#${entities.length + 1}`;
	entities.push(`${reference}=${value};`);
	return reference;
};
const coordinates = [
	[0, 0, 0],
	[80, 0, 0],
	[80, 60, 0],
	[0, 60, 0],
	[0, 0, 10],
	[80, 0, 10],
	[80, 60, 10],
	[0, 60, 10]
];
const points = coordinates.map((point) => entity(`CARTESIAN_POINT('',(${point.join(',')}))`));
const vertices = points.map((point) => entity(`VERTEX_POINT('',${point})`));
const edges = new Map();
const faces = [
	[
		[0, 3, 2, 1],
		[0, 0, -1]
	],
	[
		[4, 5, 6, 7],
		[0, 0, 1]
	],
	[
		[0, 1, 5, 4],
		[0, -1, 0]
	],
	[
		[1, 2, 6, 5],
		[1, 0, 0]
	],
	[
		[2, 3, 7, 6],
		[0, 1, 0]
	],
	[
		[3, 0, 4, 7],
		[-1, 0, 0]
	]
].map(([indexes, normal]) => {
	const oriented = indexes.map((start, index) => {
		const end = indexes[(index + 1) % indexes.length];
		const low = Math.min(start, end);
		const high = Math.max(start, end);
		const key = `${low}:${high}`;
		if (!edges.has(key)) {
			const delta = coordinates[high].map((value, axis) => value - coordinates[low][axis]);
			const direction = entity(`DIRECTION('',(${delta.join(',')}))`);
			const vector = entity(`VECTOR('',${direction},1.)`);
			const line = entity(`LINE('',${points[low]},${vector})`);
			edges.set(key, entity(`EDGE_CURVE('',${vertices[low]},${vertices[high]},${line},.T.)`));
		}
		return entity(`ORIENTED_EDGE('',*,*,${edges.get(key)},.${start === low ? 'T' : 'F'}.)`);
	});
	const loop = entity(`EDGE_LOOP('',(${oriented.join(',')}))`);
	const bound = entity(`FACE_OUTER_BOUND('',${loop},.T.)`);
	const axis = entity(`DIRECTION('',(${normal.join(',')}))`);
	const reference = coordinates[indexes[1]].map((value, i) => value - coordinates[indexes[0]][i]);
	const direction = entity(`DIRECTION('',(${reference.join(',')}))`);
	const placement = entity(`AXIS2_PLACEMENT_3D('',${points[indexes[0]]},${axis},${direction})`);
	const plane = entity(`PLANE('',${placement})`);
	return entity(`ADVANCED_FACE('',(${bound}),${plane},.T.)`);
});
const shell = entity(`CLOSED_SHELL('',(${faces.join(',')}))`);
const solid = entity(`MANIFOLD_SOLID_BREP('Structural steel connection bracket',${shell})`);
const millimetres = entity('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
const radians = entity('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
const steradians = entity('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
const tolerance = entity(
	`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),${millimetres},'distance_accuracy_value','')`
);
const context = entity(
	`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${tolerance}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${millimetres},${radians},${steradians}))REPRESENTATION_CONTEXT('',''))`
);
const representation = entity(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${solid}),${context})`);
const application = entity(
	"APPLICATION_CONTEXT('core data for automotive mechanical design processes')"
);
entity(
	`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${application})`
);
const productContext = entity(`PRODUCT_CONTEXT('',${application},'mechanical')`);
const product = entity(
	`PRODUCT('Structural steel connection bracket','80 x 60 x 10 mm steel plate','',(${productContext}))`
);
const formation = entity(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
const definitionContext = entity(
	`PRODUCT_DEFINITION_CONTEXT('part definition',${application},'design')`
);
const definition = entity(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
const shape = entity(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
entity(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);
put(
	'cad/sample-bracket.step',
	`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Original synthetic steel plate'),'2;1');\nFILE_NAME('sample-bracket.step','2026-10-10T00:00:00',('Kwantflow'),(''),'Kwantflow test fixture','Kwantflow','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n${entities.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`
);

// IGES 5.3 planar B-spline surfaces with complete fixed-width records.
const igesRecord = (text, section, sequence) =>
	`${text.padEnd(72)}${section}${String(sequence).padStart(7)}\n`;
const global =
	'1H,,1H;,9HKwantflow,12Hbracket.iges,9HKwantflow,3H1.0,32,38,6,308,15,9HKwantflow,1.0,2,2HMM,1,0.01,15H20261010.000000,1.E-6,100.,4HTest,0H,11,0,15H20261010.000000;';
const globalLines = global.match(/.{1,72}/g);
const rectangle = [
	[0, 0, 0, 80, 0, 0],
	[80, 0, 0, 80, 60, 0],
	[80, 60, 0, 0, 60, 0],
	[0, 60, 0, 0, 0, 0]
];
const surfaces = [
	[0, 1, 3, 2],
	[4, 5, 7, 6],
	[0, 1, 4, 5],
	[1, 2, 5, 6],
	[2, 3, 6, 7],
	[3, 0, 7, 4]
];
const parameters = surfaces.map(
	(indexes) =>
		[
			128,
			1,
			1,
			1,
			1,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			1,
			1,
			0,
			0,
			1,
			1,
			1,
			1,
			1,
			1,
			...indexes.flatMap((index) => coordinates[index]),
			0,
			1,
			0,
			1
		].join(',') + ';'
);
let iges = igesRecord('Original synthetic structural steel bracket surface model', 'S', 1);
iges += globalLines.map((text, i) => igesRecord(text, 'G', i + 1)).join('');
let parameterIndex = 1;
const parameterLines = [];
for (let i = 0; i < parameters.length; i++) {
	const chunks = parameters[i].match(/.{1,64}/g);
	iges += igesRecord(
		[128, parameterIndex, 0, 0, 0, 0, 0, 0, 0].map((value) => String(value).padStart(8)).join(''),
		'D',
		i * 2 + 1
	);
	iges += igesRecord(
		[128, 0, 0, chunks.length, 0].map((value) => String(value).padStart(8)).join('') +
			' '.repeat(16) +
			'BRACKET ' +
			String(i + 1).padStart(8),
		'D',
		i * 2 + 2
	);
	for (const text of chunks)
		parameterLines.push(
			igesRecord(text.padEnd(64) + String(i * 2 + 1).padStart(8), 'P', parameterIndex++)
		);
}
iges += parameterLines.join('');
iges += igesRecord(
	`S${String(1).padStart(7)}G${String(globalLines.length).padStart(7)}D${String(surfaces.length * 2).padStart(7)}P${String(parameterLines.length).padStart(7)}`,
	'T',
	1
);
put('cad/sample-bracket.iges', iges);

// R2000 model-space ownership, layer and style tables let the DWG converter
// retain these entities after native parsing, rather than only counting objects.
const dxfPairs = [
	0,
	'SECTION',
	2,
	'HEADER',
	9,
	'$ACADVER',
	1,
	'AC1015',
	9,
	'$HANDSEED',
	5,
	'FF',
	9,
	'$INSUNITS',
	70,
	4,
	0,
	'ENDSEC',
	0,
	'SECTION',
	2,
	'TABLES'
];
dxfPairs.push(
	0,
	'TABLE',
	2,
	'LTYPE',
	5,
	'5',
	100,
	'AcDbSymbolTable',
	70,
	1,
	0,
	'LTYPE',
	5,
	'F',
	330,
	'5',
	100,
	'AcDbSymbolTableRecord',
	100,
	'AcDbLinetypeTableRecord',
	2,
	'CONTINUOUS',
	70,
	0,
	3,
	'Solid line',
	72,
	65,
	73,
	0,
	40,
	0,
	0,
	'ENDTAB'
);
dxfPairs.push(
	0,
	'TABLE',
	2,
	'LAYER',
	5,
	'2',
	100,
	'AcDbSymbolTable',
	70,
	1,
	0,
	'LAYER',
	5,
	'10',
	330,
	'2',
	100,
	'AcDbSymbolTableRecord',
	100,
	'AcDbLayerTableRecord',
	2,
	'0',
	70,
	0,
	62,
	7,
	6,
	'CONTINUOUS',
	0,
	'ENDTAB'
);
dxfPairs.push(
	0,
	'TABLE',
	2,
	'STYLE',
	5,
	'3',
	100,
	'AcDbSymbolTable',
	70,
	1,
	0,
	'STYLE',
	5,
	'11',
	330,
	'3',
	100,
	'AcDbSymbolTableRecord',
	100,
	'AcDbTextStyleTableRecord',
	2,
	'Standard',
	70,
	0,
	40,
	0,
	41,
	1,
	50,
	0,
	71,
	0,
	42,
	3,
	3,
	'KwantflowOpenCad.shx',
	4,
	'',
	0,
	'ENDTAB'
);
dxfPairs.push(0, 'TABLE', 2, 'BLOCK_RECORD', 5, '1', 100, 'AcDbSymbolTable', 70, 2);
for (const [handle, name] of [
	['1F', '*Model_Space'],
	['1E', '*Paper_Space']
]) {
	dxfPairs.push(
		0,
		'BLOCK_RECORD',
		5,
		handle,
		330,
		'1',
		100,
		'AcDbSymbolTableRecord',
		100,
		'AcDbBlockTableRecord',
		2,
		name,
		70,
		0
	);
}
dxfPairs.push(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'BLOCKS');
for (const [handle, endHandle, owner, name] of [
	['20', '21', '1F', '*Model_Space'],
	['22', '23', '1E', '*Paper_Space']
]) {
	dxfPairs.push(
		0,
		'BLOCK',
		5,
		handle,
		330,
		owner,
		100,
		'AcDbEntity',
		8,
		'0',
		100,
		'AcDbBlockBegin',
		2,
		name,
		70,
		0,
		10,
		0,
		20,
		0,
		30,
		0,
		3,
		name,
		1,
		'',
		0,
		'ENDBLK',
		5,
		endHandle,
		330,
		owner,
		100,
		'AcDbEntity',
		8,
		'0',
		100,
		'AcDbBlockEnd'
	);
}
dxfPairs.push(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
for (const [index, [x1, y1, z1, x2, y2, z2]] of rectangle.entries()) {
	dxfPairs.push(
		0,
		'LINE',
		5,
		(0x24 + index).toString(16),
		330,
		'1F',
		100,
		'AcDbEntity',
		8,
		'0',
		100,
		'AcDbLine',
		10,
		x1,
		20,
		y1,
		30,
		z1,
		11,
		x2,
		21,
		y2,
		31,
		z2
	);
}
dxfPairs.push(
	0,
	'TEXT',
	5,
	'28',
	330,
	'1F',
	100,
	'AcDbEntity',
	8,
	'0',
	100,
	'AcDbText',
	10,
	0,
	20,
	80,
	30,
	0,
	40,
	3,
	1,
	'Structural steel connection bracket: 80x60x10 mm plate',
	7,
	'Standard',
	0,
	'ENDSEC',
	0,
	'EOF'
);
put('cad/sample-drawing.dxf', `${dxfPairs.join('\n')}\n`);

put(
	'documents/sample.csv',
	'Item,Qty,Unit,Rate\nSteel beam assembly,4,each,250.00\nBolt M12,100,each,1.50\nWelding,8,hours,85.00\n'
);
const docx = new JSZip();
const zip = (name, value) => docx.file(name, value, { date });
zip(
	'[Content_Types].xml',
	'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
);
zip(
	'_rels/.rels',
	'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
);
zip(
	'word/document.xml',
	'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic RFQ: fabricate four steel beam assemblies. Pricing reference: 250 each, plus M12 bolts and eight hours welding at 85 per hour.</w:t></w:r></w:p></w:body></w:document>'
);
put(
	'documents/sample.docx',
	await docx.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
	workbook,
	XLSX.utils.aoa_to_sheet([
		['Company', 'Email'],
		['Example Customer A', 'a@example.invalid'],
		['Example Customer B', 'b@example.invalid']
	]),
	'Unrelated customers'
);
put('documents/sample.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

const pdf = await PDFDocument.create();
pdf.setTitle('Synthetic structural steel canopy specification');
pdf.setAuthor('Kwantflow test fixture');
pdf.setCreationDate(date);
pdf.setModificationDate(date);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([595, 842]);
for (const [index, line] of [
	'SYNTHETIC TEST RFQ',
	'Structural steel canopy for a warehouse extension',
	'Fabricate and install one steel canopy, 6 m x 3 m.',
	'Include columns, beams, roof framing and protective finish.',
	'Confirm connections and site measurements before ordering.'
].entries())
	page.drawText(line, { x: 40, y: 780 - index * 26, size: 14, font });
put('pdf/sample-specification.pdf', await pdf.save());
put(
	'images/sample.svg',
	'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>Synthetic decorative pattern</title><rect width="128" height="128" fill="#e6f0fa"/><circle cx="64" cy="64" r="40" fill="#2870aa"/><path d="M20 64h88M64 20v88" stroke="#ffffff" stroke-width="4"/></svg>\n'
);

function pngChunk(name, bytes) {
	const type = Buffer.from(name);
	let crc = 0xffffffff;
	for (const byte of Buffer.concat([type, bytes])) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const size = Buffer.alloc(4);
	size.writeUInt32BE(bytes.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	return Buffer.concat([size, type, bytes, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(128, 0);
header.writeUInt32BE(128, 4);
header[8] = 8;
header[9] = 2;
const pixels = Buffer.alloc(128 * (128 * 3 + 1));
for (let y = 0; y < 128; y++)
	for (let x = 0; x < 128; x++) {
		const pip = [32, 96].some((px) =>
			[32, 64, 96].some((py) => (px - x) ** 2 + (py - y) ** 2 < 64)
		);
		const black = pip || x < 4 || y < 4 || x >= 124 || y >= 124;
		const offset = y * 385 + 1 + x * 3;
		pixels.fill(black ? 0 : 255, offset, offset + 3);
	}
put(
	'images/sample.png',
	Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', header),
		pngChunk('IDAT', deflateSync(pixels)),
		pngChunk('IEND', Buffer.alloc(0))
	])
);
