// No-output check. GROOVIX_DEPENDENCIES can point to an existing sibling project
// for offline dependency resolution when this checkout's node_modules is absent.
const ts = require(process.env.GROOVIX_TYPESCRIPT || 'typescript');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const options = {
    noEmit: true, strict: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true, allowSyntheticDefaultImports: true, types: [],
};
const host = ts.createCompilerHost(options);
host.resolveModuleNames = (names, containingFile) => names.map(name => {
    const local = ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
    if (local || !process.env.GROOVIX_DEPENDENCIES || name.startsWith('.')) return local;
    return ts.resolveModuleName(name, path.join(process.env.GROOVIX_DEPENDENCIES, 'check.ts'), options, host).resolvedModule;
});
const compareHead = process.argv.includes('--compare-head');
const roots = process.argv.slice(2).filter(arg => arg !== '--compare-head').map(file => path.resolve(root, file));
const rootNames = roots.length ? roots : ['src/screens/HomeScreen.tsx', 'src/screens/ProfileScreen.tsx', 'src/screens/TrackList.tsx', 'src/components/PlayerWidget.tsx'].map(file => path.join(root, file));
const program = ts.createProgram(rootNames, options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
let reported = diagnostics;
if (compareHead) {
    const readFile = host.readFile.bind(host);
    const tracked = new Set(execFileSync('git', ['ls-files', 'src'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/));
    const content = new Map();
    host.readFile = file => {
        const relative = path.relative(root, file).replace(/\\/g, '/');
        if (!tracked.has(relative)) return readFile(file);
        if (!content.has(relative)) content.set(relative, execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, encoding: 'utf8' }));
        return content.get(relative);
    };
    const baseline = ts.getPreEmitDiagnostics(ts.createProgram(rootNames, options, host));
    const fingerprint = diagnostic => `${diagnostic.file?.fileName}:${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
    const known = new Set(baseline.map(fingerprint));
    reported = diagnostics.filter(diagnostic => !known.has(fingerprint(diagnostic)));
    console.log(`HEAD diagnostics: ${baseline.length}; current diagnostics: ${diagnostics.length}; new diagnostics: ${reported.length}`);
    if (baseline.length) console.log('Baseline dependency/type errors remain; this is a regression comparison, not a full clean typecheck.');
}
console.log(ts.formatDiagnosticsWithColorAndContext(reported, {
    getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => '\n',
}));
console.log(`TypeScript reported diagnostics: ${reported.length} (no files emitted)`);
process.exitCode = reported.length ? 1 : 0;
