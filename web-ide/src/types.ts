export type WorkerRequest =
	| { type: 'init' }
	| { type: 'run'; code: string }
	| { type: 'trace'; code: string }
	| { type: 'tests'; code: string; tests: string };

export type TraceEvent = {
	file: string;
	line: number;
	functionName: string;
	locals: Record<string, unknown>;
};

export type RunResultMessage = {
	type: 'runResult';
	stdout: string;
	stderr: string;
	error?: string;
};

export type TraceResultMessage = {
	type: 'traceResult';
	stdout: string;
	stderr: string;
	events: TraceEvent[];
	error?: string;
};

export type TestsResultMessage = {
	type: 'testsResult';
	stdout: string;
	stderr: string;
	passed: number;
	failed: number;
	errors: number;
	total: number;
	report: string;
	errorText?: string;
};

export type ReadyMessage = { type: 'ready' };
export type ErrorMessage = { type: 'error'; error: string };

export type WorkerResponse =
	| ReadyMessage
	| RunResultMessage
	| TraceResultMessage
	| TestsResultMessage
	| ErrorMessage;