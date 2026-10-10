#!/usr/bin/env bun

/**
 * The queue board dev server — the task queue's live view (owner ruling
 * 2026-10-10).
 *
 *   bun run queue:serve        (default http://127.0.0.1:8433, PORT to override)
 *
 * The board replaces the TODO.md view the source repo generated: the
 * queue/TC-NNN.md files stay the source of truth, and this server renders
 * them as a kanban through the compiler's own output — the static shell
 * (server/generated/demo/, built by `bun run build:demo`) renders the initial
 * HTML server-side, and Server-Sent Events push a fresh snapshot whenever a
 * queue file changes. No page reload; the client reconciles lanes by task id.
 *
 * The split is the compiler's model in miniature: the components rarely
 * change (rebuild with build:demo and restart), the data changes constantly
 * (SSE, debounced). All queue semantics — lanes, order, badges, readiness —
 * are computed by the SAME store library the CLI picks with
 * (scripts/lib/queue-store.ts); this server only transports them, so the
 * board can never disagree with `start-task`.
 *
 * Routes: / the board page · /events the SSE channel · /snapshot.json the
 * raw payload · /client-entry.js + /queue-board.css the built shell.
 */
import { realpathSync, watch } from 'node:fs'
import { join } from 'node:path'
import type { BoardSnapshot } from '../demo/types.ts'
import { boardSnapshot, loadStore } from '../scripts/lib/queue-store.ts'

const ROOT = realpathSync(`${import.meta.dir}/..`)
const OUT = join(ROOT, 'server/generated/demo')
const QUEUE = join(ROOT, 'queue')
const PORT = Number(process.env.PORT ?? 8433)

const fail = (message: string): never => {
	console.error(message)
	process.exit(1)
}

// The board's static shell: the emitted server render module. It is a build
// product, not a source — refusing to start without it keeps the "tear down,
// recompile, restart" loop honest instead of serving a stale board silently.
type BoardArgs = {
	waiting?: BoardSnapshot['lanes'][number]['tasks']
	ready?: BoardSnapshot['lanes'][number]['tasks']
	inProgress?: BoardSnapshot['lanes'][number]['tasks']
	reviewPending?: BoardSnapshot['lanes'][number]['tasks']
	inReview?: BoardSnapshot['lanes'][number]['tasks']
	done?: BoardSnapshot['lanes'][number]['tasks']
	title?: string
	generatedAt?: string
	problems?: string
}
let renderQueueBoard: (args: BoardArgs) => string
try {
	const serverModule = await import(join(OUT, 'queue-board.server.ts'))
	renderQueueBoard = serverModule.renderQueueBoard as typeof renderQueueBoard
} catch (e) {
	fail(
		`server/generated/demo/queue-board.server.ts is missing or broken — run bun run build:demo first\n  ${e}`,
	)
}

const snapshot = (): BoardSnapshot => boardSnapshot(loadStore(ROOT))

const laneArgs = (current: BoardSnapshot): BoardArgs => {
	const byLane = new Map(current.lanes.map(lane => [lane.key, lane.tasks]))
	return {
		waiting: byLane.get('waiting'),
		ready: byLane.get('ready'),
		inProgress: byLane.get('in-progress'),
		reviewPending: byLane.get('review-pending'),
		inReview: byLane.get('in-review'),
		done: byLane.get('done'),
		title: current.meta.title,
		generatedAt: `${current.meta.generatedAt.replace('T', ' ').slice(0, 19)} UTC`,
		problems: current.meta.problems.join('\n'),
	}
}

const page = (current: BoardSnapshot): string =>
	`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${current.meta.title}</title>
<link rel="stylesheet" href="/queue-board.css">
<style>
	html { color-scheme: dark; }
	body {
		margin: 0;
		background: #0b0e13;
		color-scheme: dark;
		font-family: system-ui, sans-serif;
	}
	main {
		max-width: 100rem;
		margin: 0 auto;
		padding: 1.25rem 1.5rem 3rem;
	}
</style>
</head>
<body>
<main>
${renderQueueBoard(laneArgs(current))}
</main>
<script type="module" src="/client-entry.js"></script>
</body>
</html>
`

/* ── The SSE channel ─────────────────────────────────────────────────────── */

const encoder = new TextEncoder()
const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()

const frame = (payload: string): Uint8Array =>
	encoder.encode(`data: ${payload}\n\n`)

const push = (
	controller: ReadableStreamDefaultController<Uint8Array>,
	what: string,
) => {
	try {
		controller.enqueue(what === ': hb\n\n' ? encoder.encode(what) : frame(what))
	} catch {
		subscribers.delete(controller)
	}
}

const broadcast = (current: BoardSnapshot): void => {
	const payload = JSON.stringify(current)
	for (const controller of subscribers) push(controller, payload)
}

// Keep proxies and idle timeouts from reaping an otherwise quiet channel.
setInterval(() => {
	for (const controller of subscribers) push(controller, ': hb\n\n')
}, 30_000)

/* ── The watcher: queue/ changes refresh every connected board ───────────── */

let refreshTimer: ReturnType<typeof setTimeout> | null = null
const refresh = (): void => {
	refreshTimer = null
	broadcast(snapshot())
}
watch(QUEUE, { recursive: true }, () => {
	// Writes are atomic (temp + rename) and batched by tools; a short trailing
	// debounce coalesces a claim+annotate pair into one snapshot.
	if (refreshTimer === null) refreshTimer = setTimeout(refresh, 150)
})

/* ── The server ──────────────────────────────────────────────────────────── */

const file = (path: string, type: string): Response =>
	new Response(Bun.file(path), {
		headers: { 'content-type': type, 'cache-control': 'no-store' },
	})

Bun.serve({
	port: PORT,
	hostname: '127.0.0.1',
	idleTimeout: 255,
	fetch(request) {
		const { pathname } = new URL(request.url)
		switch (pathname) {
			case '/':
				return new Response(page(snapshot()), {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				})
			case '/events': {
				const current = snapshot()
				let mine: ReadableStreamDefaultController<Uint8Array> | null = null
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						mine = controller
						subscribers.add(controller)
						push(controller, JSON.stringify(current))
					},
					cancel() {
						if (mine) subscribers.delete(mine)
					},
				})
				return new Response(stream, {
					headers: {
						'content-type': 'text/event-stream',
						'cache-control': 'no-store',
						connection: 'keep-alive',
					},
				})
			}
			case '/snapshot.json':
				return new Response(JSON.stringify(snapshot()), {
					headers: { 'content-type': 'application/json' },
				})
			case '/client-entry.js':
				return file(join(OUT, 'client-entry.js'), 'text/javascript')
			case '/queue-board.css':
				return file(join(OUT, 'queue-board.css'), 'text/css')
			default:
				return new Response('not found', { status: 404 })
		}
	},
})

console.log(`🗂  queue board at http://127.0.0.1:${PORT}/ (watching queue/)`)
