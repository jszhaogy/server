import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import Editor from '@monaco-editor/react'
import type { WorkerResponse, TestsResultMessage, TraceEvent } from './types'

function usePyWorker() {
	const workerRef = useRef<Worker | null>(null)
	const [ready, setReady] = useState(false)
	const listenersRef = useRef<((msg: WorkerResponse) => void)[]>([])

	useEffect(() => {
		const w = new Worker(new URL('./workers/pyWorker.ts', import.meta.url), { type: 'module' })
		workerRef.current = w
		w.onmessage = (e: MessageEvent<WorkerResponse>) => {
			if (e.data.type === 'ready') setReady(true)
			for (const cb of listenersRef.current) cb(e.data)
		}
		w.postMessage({ type: 'init' })
		return () => {
			w.terminate()
		}
	}, [])

	const post = useCallback((req: any) => {
		workerRef.current?.postMessage(req)
	}, [])

	const on = useCallback((cb: (msg: WorkerResponse) => void) => {
		listenersRef.current.push(cb)
		return () => {
			listenersRef.current = listenersRef.current.filter((x) => x !== cb)
		}
	}, [])

	return { ready, post, on }
}

function App() {
	const { ready, post, on } = usePyWorker()
	const [code, setCode] = useState<string>(`def add(a, b):\n    return a + b\n\nif __name__ == '__main__':\n    print('sum=', add(2, 3))\n`)
	const [tests, setTests] = useState<string>(`import unittest\nfrom user_code import add\n\nclass TestAdd(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n        self.assertEqual(add(-1, 1), 0)\n`)
	const [stdout, setStdout] = useState('')
	const [stderr, setStderr] = useState('')
	const [trace, setTrace] = useState<TraceEvent[]>([])
	const [testsResult, setTestsResult] = useState<TestsResultMessage | null>(null)
	const [tab, setTab] = useState<'output' | 'trace' | 'tests'>('output')
	const [running, setRunning] = useState(false)

	useEffect(() => {
		return on((msg) => {
			if (msg.type === 'runResult') {
				setRunning(false)
				setStdout(msg.stdout)
				setStderr(msg.stderr + (msg.error ? `\n${msg.error}` : ''))
			}
			if (msg.type === 'traceResult') {
				setRunning(false)
				setStdout(msg.stdout)
				setStderr(msg.stderr + (msg.error ? `\n${msg.error}` : ''))
				setTrace(msg.events)
				setTab('trace')
			}
			if (msg.type === 'testsResult') {
				setRunning(false)
				setStdout(msg.stdout)
				setStderr(msg.stderr + (msg.errorText ? `\n${msg.errorText}` : ''))
				setTestsResult(msg)
				setTab('tests')
			}
			if (msg.type === 'error') {
				setRunning(false)
				setStderr((s) => s + `\nWorker error: ${msg.error}`)
			}
		})
	}, [on])

	const run = useCallback(() => {
		setRunning(true)
		setStdout('')
		setStderr('')
		post({ type: 'run', code })
	}, [code, post])

	const runTrace = useCallback(() => {
		setRunning(true)
		setStdout('')
		setStderr('')
		setTrace([])
		post({ type: 'trace', code })
	}, [code, post])

	const runTests = useCallback(() => {
		setRunning(true)
		setStdout('')
		setStderr('')
		setTestsResult(null)
		post({ type: 'tests', code, tests })
	}, [code, tests, post])

	const traceList = useMemo(() => trace.map((e, idx) => `${idx + 1}. ${e.file}:${e.line} in ${e.functionName} locals=${JSON.stringify(e.locals)}`).join('\n'), [trace])

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
			<header style={{ padding: '8px', borderBottom: '1px solid #ddd', display: 'flex', gap: 8, alignItems: 'center' }}>
				<strong>Py Web IDE</strong>
				<button onClick={run} disabled={!ready || running}>Run</button>
				<button onClick={runTrace} disabled={!ready || running}>Trace</button>
				<button onClick={runTests} disabled={!ready || running}>Run Tests</button>
				<span style={{ marginLeft: 'auto', fontSize: 12 }}>{ready ? 'Pyodide ready' : 'Loading Pyodide...'}</span>
			</header>
			<div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
				<div style={{ flex: 1, minWidth: 0 }}>
					<Editor
						height="100%"
						defaultLanguage="python"
						value={code}
						onChange={(v) => setCode(v ?? '')}
						options={{ fontSize: 14, minimap: { enabled: false } }}
					/>
				</div>
				<div style={{ width: 520, borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
					<div style={{ padding: 8, display: 'flex', gap: 8 }}>
						<button onClick={() => setTab('output')} disabled={tab === 'output'}>Output</button>
						<button onClick={() => setTab('trace')} disabled={tab === 'trace'}>Trace</button>
						<button onClick={() => setTab('tests')} disabled={tab === 'tests'}>Tests</button>
					</div>
					<div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
						{tab === 'output' && (
							<div>
								<h4>Stdout</h4>
								<pre style={{ whiteSpace: 'pre-wrap' }}>{stdout || '(empty)'}</pre>
								<h4>Stderr</h4>
								<pre style={{ whiteSpace: 'pre-wrap', color: '#b00' }}>{stderr || '(empty)'}</pre>
							</div>
						)}
						{tab === 'trace' && (
							<div>
								<h4>Trace Events</h4>
								<pre style={{ whiteSpace: 'pre-wrap' }}>{traceList || '(no events)'}</pre>
							</div>
						)}
						{tab === 'tests' && (
							<div>
								<h4>Tests</h4>
								<div style={{ marginBottom: 8 }}>
									<Editor height="200px" defaultLanguage="python" value={tests} onChange={(v) => setTests(v ?? '')} options={{ fontSize: 13, minimap: { enabled: false } }} />
								</div>
								{testsResult && (
									<div>
										<p>Passed: {testsResult.passed} / {testsResult.total} | Failed: {testsResult.failed} | Errors: {testsResult.errors}</p>
										<h4>Report</h4>
										<pre style={{ whiteSpace: 'pre-wrap' }}>{testsResult.report || '(empty)'}</pre>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

export default App
