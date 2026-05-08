/**
 * Catch-all shim for `node:*` built-in imports.
 *
 * The pre-built `@supernote/*` packages reference Node modules (path, fs,
 * crypto, …) inside their barrel exports because the same package is shared
 * by the Electron main process. The renderer never executes these code
 * paths, but the bundler still has to resolve every import statement.
 *
 * We export a single Proxy-backed namespace that returns a no-op for every
 * accessed property. Calling any function returns `undefined`; reading any
 * property returns the same proxy (so chained access like
 * `path.posix.relative` keeps working without throwing).
 *
 * If a shimmed function is *actually* invoked at runtime in the browser,
 * the call returns `undefined` instead of throwing — most call sites then
 * handle that with their own error path. If you discover a renderer code
 * path that needs a real implementation, extract just that method here
 * rather than swapping in a polyfill bundle.
 */

const handler: ProxyHandler<object> = {
  get(_target, prop) {
    if (prop === "default" || prop === "__esModule") return proxy;
    if (prop === Symbol.toPrimitive) return () => "";
    // Return the proxy itself so chained property access works.
    // Calling any function-shaped property returns `undefined`.
    return proxy;
  },
  apply() {
    return undefined;
  },
};

// `apply` requires the target to be a function for invocation to be valid.
const proxy: any = new Proxy(function noopShim() {} as any, handler);

// Export every commonly-accessed surface of the node built-ins. The Proxy
// already responds to any property access, but named exports make sure
// `import { X } from "node:path"` resolves correctly even after tree-shaking.
export default proxy;
export const posix = proxy;
export const win32 = proxy;
export const sep = "/";
export const delimiter = ":";

// `node:path` callers
export const join = proxy;
export const resolve = proxy;
export const relative = proxy;
export const isAbsolute = proxy;
export const dirname = proxy;
export const basename = proxy;
export const extname = proxy;
export const normalize = proxy;
export const parse = proxy;
export const format = proxy;
export const toNamespacedPath = proxy;

// `node:fs`/`node:fs/promises` callers
export const readFile = proxy;
export const writeFile = proxy;
export const stat = proxy;
export const mkdir = proxy;
export const readdir = proxy;
export const unlink = proxy;
export const rm = proxy;
export const access = proxy;
export const existsSync = proxy;
export const readFileSync = proxy;
export const writeFileSync = proxy;
export const promises = proxy;

// `node:os`
export const platform = proxy;
export const homedir = proxy;
export const tmpdir = proxy;
export const userInfo = proxy;
export const cpus = proxy;
export const totalmem = proxy;

// `node:crypto`
export const randomUUID = () => Math.random().toString(36).slice(2);
export const createHash = proxy;
export const randomBytes = proxy;
export const webcrypto = typeof crypto !== "undefined" ? crypto : proxy;

// `node:url`
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export const fileURLToPath = proxy;
export const pathToFileURL = proxy;

// `node:child_process`, `node:vm`, `node:stream`, etc. — all hit the Proxy
// for any imports we haven't enumerated above.
export const exec = proxy;
export const spawn = proxy;
export const Buffer = (globalThis as { Buffer?: unknown }).Buffer ?? proxy;
