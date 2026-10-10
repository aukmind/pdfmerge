// qpdf (WebAssembly) for encryption, which pdf-lib can't do. Loaded on first use.
const BASE = 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/';

let runtime = null;

function loadRuntime() {
    if (!runtime) {
        runtime = (async () => {
            const [wasmModule] = await Promise.all([
                WebAssembly.compileStreaming(fetch(`${BASE}qpdf.wasm`)).catch(() => {
                    throw new Error('Could not download the PDF security module');
                }),
                new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = `${BASE}qpdf.js`;
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Could not download the PDF security module'));
                    document.head.appendChild(script);
                }),
            ]);
            // The emscripten bundle publishes its factory as a global named Module.
            const factory = window.Module;
            // Compile once; each run only instantiates, since qpdf's main() isn't safe to call twice.
            // emscripten has no way to report a failed instantiateWasm, so reject ourselves instead of hanging.
            return () => new Promise((resolve, reject) => {
                factory({
                    instantiateWasm(imports, receive) {
                        WebAssembly.instantiate(wasmModule, imports).then(instance => receive(instance, wasmModule), reject);
                        return {};
                    },
                }).then(resolve, reject);
            });
        })().catch(err => {
            runtime = null;
            throw err;
        });
    }
    return runtime;
}

async function run(args, input) {
    const create = await loadRuntime();
    const qpdf = await create();
    qpdf.FS.writeFile('/in.pdf', input);
    let code;
    try {
        code = qpdf.callMain(args);
    } catch (err) {
        code = err?.status ?? 2;
    }
    // Exit code 3 means "succeeded with warnings".
    if (code !== 0 && code !== 3) return null;
    return qpdf.FS.readFile('/out.pdf');
}

export async function decryptPdf(bytes, password) {
    const out = await run([`--password=${password}`, '--decrypt', '/in.pdf', '/out.pdf'], bytes);
    if (!out) throw new Error(password ? 'Wrong password' : 'This PDF needs a password to open');
    return out;
}

export async function encryptPdf(bytes, { userPassword, ownerPassword, allowPrint, allowCopy, allowModify }) {
    const out = await run([
        // Named flags: a positional password starting with "-" would be read as an option.
        '--encrypt', `--user-password=${userPassword}`, `--owner-password=${ownerPassword}`, '--bits=256',
        `--print=${allowPrint ? 'full' : 'none'}`,
        `--extract=${allowCopy ? 'y' : 'n'}`,
        `--modify=${allowModify ? 'all' : 'none'}`,
        '--', '/in.pdf', '/out.pdf',
    ], bytes);
    if (!out) throw new Error('Could not encrypt this PDF');
    return out;
}
