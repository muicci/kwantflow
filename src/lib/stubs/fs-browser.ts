// Stub for Node.js 'fs' module — Emscripten checks `typeof fs !== 'undefined'`
// to decide whether to use NodeFS vs MEMFS. Making fs undefined forces MEMFS.
export default undefined;
