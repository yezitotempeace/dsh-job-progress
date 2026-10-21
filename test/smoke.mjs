/**
 * Smoke test for the job-progress client bundle.
 *
 * The bundle is a browser module for `window.__ModuleLoader__`, so this harness
 * provides a fake loader, a React stub and a fake client context. It checks:
 *   - the bundle loads, declares its services and registers the header mount;
 *   - `parseProgress` reads the meters the common downloaders print
 *     (wget/apt/pip `NN%`, curl's table row, ANSI colour, CR-updated lines,
 *     byte ratios, speed and ETA), and leaves plain logs alone.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "client.js"), "utf8");

let failures = 0;
function check(name, condition, detail) {
	if (condition) {
		console.log(`  ok  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL ${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

globalThis.window = { __DSH_JOB_PROGRESS_DEBUG__: true };
globalThis.document = {
	head: { appendChild() {} },
	createElement() {
		return { dataset: {}, textContent: "", remove() {} };
	}
};

let loaderModule = null;
globalThis.window.__ModuleLoader__ = {
	load(definition) {
		loaderModule = definition;
	}
};

const requireStub = (id) => {
	switch (id) {
		case "react":
			return {
				useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
				useEffect: () => {},
				useMemo: (factory) => factory(),
				useReducer: () => [0, () => {}],
				useSyncExternalStore: (subscribe, get) => get()
			};
		case "react/jsx-runtime":
			return { jsx: () => null, jsxs: () => null, Fragment: Symbol("fragment") };
		case "react-dom":
			return { createPortal: (node) => node };
		case "@deepseek-ai/dsh-client-ui-primitives":
			return { IconChevronDownOutlineRegular: () => null, IconChevronUpOutlineRegular: () => null };
		default:
			throw new Error(`unexpected require: ${id}`);
	}
};

new Function("window", source)(globalThis.window);
if (loaderModule === null) {
	console.error("bundle did not call __ModuleLoader__.load");
	process.exit(1);
}
const plugin = loaderModule.factory(requireStub);
check("bundle exports inject + apply", Array.isArray(plugin.inject) && typeof plugin.apply === "function");
check("inject covers jobs, slots, locale", ["jobs", "slots", "locale"].every((name) => plugin.inject.includes(name)));

//#region registration
const registered = [];
const ctx = {
	effect(makeEffect) {
		return makeEffect();
	},
	locale: { register: () => () => {} },
	jobs: { state: {}, watchRows: () => () => {}, observe: () => () => {} },
	slots: {
		inject(_name, callback) {
			callback();
		},
		register(definition, component) {
			registered.push({ definition, component });
			return () => {};
		}
	}
};
plugin.apply(ctx);
check("registers the session header mount", registered.some((entry) => entry.definition.name === "conversation.session.header.actions"));
check("mount id is job-progress.card", registered.some((entry) => entry.definition.id === "job-progress.card"));
check("exposes the parse hook", typeof window.__dshJobProgress?.parseProgress === "function");
//#endregion

//#region parsing
const { parseProgress } = window.__dshJobProgress;

const wget = parseProgress("file.iso  45%[======>          ] 450.2M  2.10MB/s  eta 3m 20s");
check("wget percentage", wget.percent === 45, JSON.stringify(wget));
check("wget speed", wget.speed === "2.10MB/s", wget.speed);
check("wget eta", wget.eta === "3m 20s", wget.eta);

const apt = parseProgress("Get:1 http://deb.debian.org/debian bookworm/main amd64 linux-image 6.1.0 45% [Working]");
check("apt percentage", apt.percent === 45, JSON.stringify(apt));

const curlTable = parseProgress("  5 1024M    5 51.2M    0     0   512k      0  0:34:08  0:01:42  0:32:26  512k");
check("curl table percentage", curlTable.percent === 5, JSON.stringify(curlTable));

const curlBar = parseProgress("########## 62.5%");
check("curl bar percentage", curlBar.percent === 62.5, JSON.stringify(curlBar));

const pip = parseProgress("Downloading torch-2.3.0-cp311.whl (2.1 GB) ... 12%");
check("pip percentage", pip.percent === 12, JSON.stringify(pip));

const ansi = parseProgress("\u001b[32m100%\u001b[0m of 1.2 GB");
check("ansi percentage", ansi.percent === 100, JSON.stringify(ansi));

const carriage = parseProgress("10%\r55%\r90%");
check("carriage-return updates", carriage.percent === 90, JSON.stringify(carriage));

const ratio = parseProgress("1.2 GB / 3.4 GB 35%  eta 0:00:42");
check("byte ratio", ratio.bytes === "1.2 GB / 3.4 GB", JSON.stringify(ratio));
check("eta mm:ss", ratio.eta === "0:00:42", ratio.eta);

const plain = parseProgress("Building target release\nlinking…");
check("plain log has no percentage", plain.percent === null, JSON.stringify(plain));
check("plain log keeps the tail line", plain.line === "linking…", plain.line);

check("empty output", parseProgress("").percent === null);

const { clamp } = window.__dshJobProgress;
check("clamp keeps inside", clamp(120, 0, 100) === 100 && clamp(-8, 0, 100) === 0 && clamp(42, 0, 100) === 42);
check("clamp survives a zero-width viewport", clamp(10, 20, 20) === 20);
//#endregion

console.log(failures === 0 ? "[job-progress] PASS" : `[job-progress] FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
