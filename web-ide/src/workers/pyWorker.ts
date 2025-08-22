/// <reference lib="WebWorker" />
import { loadPyodide } from 'pyodide';
import type { PyodideInterface } from 'pyodide';
import type { WorkerRequest, WorkerResponse, TraceEvent } from '../types';

let pyodide: PyodideInterface | null = null;

async function ensurePyodideLoaded() {
	if (pyodide) return pyodide;
	pyodide = await loadPyodide({
		indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
	});
	return pyodide;
}

function post(message: WorkerResponse) {
	self.postMessage(message);
}

async function runCode(code: string) {
	const p = await ensurePyodideLoaded();
	const script = `\nimport sys, io, contextlib\n_stdout, _stderr = io.StringIO(), io.StringIO()\nwith contextlib.redirect_stdout(_stdout), contextlib.redirect_stderr(_stderr):\n\ttry:\n\t\t__name__ = '__main__'\n\t\texec(compile(${JSON.stringify(code)}, '<input>', 'exec'), globals(), globals())\n\t\texc = None\n\texcept Exception as e:\n\t\texc = e\nstdout, stderr = _stdout.getvalue(), _stderr.getvalue()\n`;
	try {
		await p.runPythonAsync(script);
		const stdout = p.globals.get('stdout') as unknown as string;
		const stderr = p.globals.get('stderr') as unknown as string;
		const exc = p.globals.get('exc') as any;
		post({ type: 'runResult', stdout, stderr, error: exc ? String(exc) : undefined });
	} catch (e: any) {
		post({ type: 'error', error: String(e) });
	}
}

async function traceCode(code: string) {
	const p = await ensurePyodideLoaded();
	const py = String.raw;
	const wrapper = py`\nimport sys, io, contextlib, json, types\n_stdout, _stderr = io.StringIO(), io.StringIO()\n_events = []\n\nclass _Tracer:\n\tdef __init__(self):\n\t\tself.enabled = True\n\n\tdef __call__(self, frame, event, arg):\n\t\tif event != 'line':\n\t\t\treturn self.__call__\n\t\tco = frame.f_code\n\t\tfile = co.co_filename\n\t\tline = frame.f_lineno\n\t\tfunc = co.co_name\n\t\tlocs = {}\n\t\tfor k, v in frame.f_locals.items():\n\t\t\ttry:\n\t\t\t\tlocs[k] = repr(v)\n\t\t\texcept Exception:\n\t\t\t\tlocs[k] = '<unrepr>'\n\t\t_events.append((file, line, func, locs))\n\t\treturn self.__call__\n\n_tracer = _Tracer()\n\nwith contextlib.redirect_stdout(_stdout), contextlib.redirect_stderr(_stderr):\n\ttry:\n\t\t__name__ = '__main__'\n\t\tsys.settrace(_tracer)\n\t\texec(compile(${JSON.stringify(code)}, '<input>', 'exec'), globals(), globals())\n\t\texc = None\n\texcept Exception as e:\n\t\texc = e\n\tfinally:\n\t\tsys.settrace(None)\nstdout, stderr = _stdout.getvalue(), _stderr.getvalue()\n`;
	try {
		await p.runPythonAsync(wrapper);
		const stdout = p.globals.get('stdout') as unknown as string;
		const stderr = p.globals.get('stderr') as unknown as string;
		const exc = p.globals.get('exc') as any;
		const eventsTuple = p.globals.get('_events') as any;
		const events: TraceEvent[] = [];
		for (const tup of eventsTuple.toJs({ create_proxies: true }) as any[]) {
			const [file, line, func, locs] = tup;
			const localsObj: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(locs.toJs())) {
				localsObj[k] = v as string;
			}
			events.push({ file: String(file), line: Number(line), functionName: String(func), locals: localsObj });
		}
		post({ type: 'traceResult', stdout, stderr, events, error: exc ? String(exc) : undefined });
	} catch (e: any) {
		post({ type: 'error', error: String(e) });
	}
}

async function runTests(code: string, tests: string) {
	const p = await ensurePyodideLoaded();
	const program = JSON.stringify(code);
	const testsSrc = JSON.stringify(tests);
	const script = `\nimport sys, io, contextlib, types, unittest\n_stdout, _stderr = io.StringIO(), io.StringIO()\nreport = io.StringIO()\n\n# Create a module for the user's code\nuser_mod = types.ModuleType('user_code')\nsetattr(user_mod, '__file__', '<input>')\n\nwith contextlib.redirect_stdout(_stdout), contextlib.redirect_stderr(_stderr):\n\ttry:\n\t\texec(compile(${program}, '<input>', 'exec'), user_mod.__dict__, user_mod.__dict__)\n\t\texc = None\n\texcept Exception as e:\n\t\texc = e\n\n# Create a test module and run unittest against it\ntest_mod = types.ModuleType('test_user_code')\nns = {'user_code': user_mod}\nexec(compile(${testsSrc}, '<tests>', 'exec'), ns, ns)\n\nclass _StreamResult(unittest.TextTestResult):\n\tdef addFailure(self, test, err):\n\t\tsuper().addFailure(test, err)\n\t\tprint(self.failures[-1][1], file=report)\n\tdef addError(self, test, err):\n\t\tsuper().addError(test, err)\n\t\tprint(self.errors[-1][1], file=report)\n\nrunner = unittest.TextTestRunner(stream=report, verbosity=2, resultclass=_StreamResult)\nloader = unittest.TestLoader()\n# Discover tests from the created namespace\nsuite = unittest.TestSuite()\nfor name, obj in ns.items():\n\tpass\n# Collect TestCase subclasses from ns\nfor obj in ns.values():\n\tif isinstance(obj, type) and issubclass(obj, unittest.TestCase):\n\t\tsuite.addTests(loader.loadTestsFromTestCase(obj))\n\nres = runner.run(suite)\nstdout, stderr = _stdout.getvalue(), _stderr.getvalue()\npassed = res.testsRun - len(res.failures) - len(res.errors)\nfailed = len(res.failures)\nerrors = len(res.errors)\ntotal = res.testsRun\nrep_str = report.getvalue()\n`;
	try {
		await p.runPythonAsync(script);
		const stdout = p.globals.get('stdout') as unknown as string;
		const stderr = p.globals.get('stderr') as unknown as string;
		const rep = p.globals.get('rep_str') as unknown as string;
		const passed = Number(p.globals.get('passed'));
		const failed = Number(p.globals.get('failed'));
		const errors = Number(p.globals.get('errors'));
		const total = Number(p.globals.get('total'));
		const exc = p.globals.get('exc') as any;
		post({ type: 'testsResult', stdout, stderr, passed, failed, errors, total, report: rep, errorText: exc ? String(exc) : undefined });
	} catch (e: any) {
		post({ type: 'error', error: String(e) });
	}
}

self.addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
	const data = ev.data;
	switch (data.type) {
		case 'init':
			ensurePyodideLoaded().then(() => post({ type: 'ready' }));
			break;
		case 'run':
			runCode(data.code);
			break;
		case 'trace':
			traceCode(data.code);
			break;
		case 'tests':
			runTests(data.code, data.tests);
			break;
		default:
			post({ type: 'error', error: 'Unknown request type' });
	}
});