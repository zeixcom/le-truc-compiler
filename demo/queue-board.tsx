import {
	asNumber,
	asParser,
	asString,
	createCell,
	createList,
} from '@zeix/le-truc'
import { css, harvest } from '@zeix/le-truc-compiler/macros'
import { connectBoard } from './_common/live.ts'
import type { BoardLane } from './types.ts'

export type BoardTask = {
	id: string
	title: string
	area: string
	lane: BoardLane
	order: number
	badges: string
	hint: string
}

declare global {
	interface HTMLElementTagNameMap {
		'queue-board': HTMLElement
	}
}

export function QueueBoard({
	waiting,
	ready,
	inProgress,
	reviewPending,
	inReview,
	done,
	title = 'Task queue',
	generatedAt = '',
	problems = '',
}: {
	waiting?: BoardTask[]
	ready?: BoardTask[]
	inProgress?: BoardTask[]
	reviewPending?: BoardTask[]
	inReview?: BoardTask[]
	done?: BoardTask[]
	title?: string
	generatedAt?: string
	/** Pre-joined store problems; empty when the store is clean. */
	problems?: string
}) {
	const heading = createCell(title)
	const updated = createCell(generatedAt)
	const issues = createCell(problems)

	// The lane field's parser, shared by all six harvests
	const parseLane = asParser(
		(value): BoardLane =>
			value === 'waiting' ||
			value === 'ready' ||
			value === 'in-progress' ||
			value === 'review-pending' ||
			value === 'in-review' ||
			value === 'done'
				? value
				: 'waiting',
	)

	// One seeded list per lane, mapped directly below
	const waitingList = createList<BoardTask>(
		harvest(waiting ?? [], {
			id: asString(),
			title: asString(),
			area: asString(),
			lane: parseLane,
			order: asNumber(),
			badges: asString(),
			hint: asString(),
		}),
		{ keyConfig: task => task.id },
	)
	const readyList = createList<BoardTask>(
		harvest(ready ?? [], {
			id: asString(),
			title: asString(),
			area: asString(),
			lane: parseLane,
			order: asNumber(),
			badges: asString(),
			hint: asString(),
		}),
		{ keyConfig: task => task.id },
	)
	const inProgressList = createList<BoardTask>(
		harvest(inProgress ?? [], {
			id: asString(),
			title: asString(),
			area: asString(),
			lane: parseLane,
			order: asNumber(),
			badges: asString(),
			hint: asString(),
		}),
		{ keyConfig: task => task.id },
	)
	const reviewPendingList = createList<BoardTask>(
		harvest(reviewPending ?? [], {
			id: asString(),
			title: asString(),
			area: asString(),
			lane: parseLane,
			order: asNumber(),
			badges: asString(),
			hint: asString(),
		}),
		{ keyConfig: task => task.id },
	)
	const inReviewList = createList<BoardTask>(
		harvest(inReview ?? [], {
			id: asString(),
			title: asString(),
			area: asString(),
			lane: parseLane,
			order: asNumber(),
			badges: asString(),
			hint: asString(),
		}),
		{ keyConfig: task => task.id },
	)
	const doneList = createList<BoardTask>(
		harvest(done ?? [], {
			id: asString(),
			title: asString(),
			area: asString(),
			lane: parseLane,
			order: asNumber(),
			badges: asString(),
			hint: asString(),
		}),
		{ keyConfig: task => task.id },
	)

	connectBoard({
		lanes: {
			waiting: waitingList,
			ready: readyList,
			inProgress: inProgressList,
			reviewPending: reviewPendingList,
			inReview: inReviewList,
			done: doneList,
		},
		heading,
		updated,
		issues,
	})

	return (
		<queue-board>
			<header class="meta">
				<h1>{() => heading.get()}</h1>
				<p class="updated">{() => updated.get()}</p>
			</header>
			<pre class="problems">{() => issues.get()}</pre>
			<div class="board">
				<section class="lane" data-lane="waiting">
					<h2>
						Waiting{' '}
						<span class="count" data-count="waiting">
							{() => String(waitingList.length)}
						</span>
					</h2>
					<ul class="cards" data-cards="waiting">
						{waitingList.map(task => (
							<li
								class="card"
								data-title={() => task.get().title}
								data-area={() => task.get().area}
								data-lane={() => task.get().lane}
								data-order={() => String(task.get().order)}
								data-badges={() => task.get().badges}
								data-hint={() => task.get().hint}
							>
								<header>
									<span class="id">{() => task.get().id}</span>
									<span class="badges">{() => task.get().badges}</span>
								</header>
								<h3 class="title">{() => task.get().title}</h3>
								<p class="hint">{() => task.get().hint}</p>
								<footer>
									<span class="area">{() => task.get().area}</span>
								</footer>
							</li>
						))}
					</ul>
				</section>
				<section class="lane" data-lane="ready">
					<h2>
						Ready{' '}
						<span class="count" data-count="ready">
							{() => String(readyList.length)}
						</span>
					</h2>
					<ul class="cards" data-cards="ready">
						{readyList.map(task => (
							<li
								class="card"
								data-title={() => task.get().title}
								data-area={() => task.get().area}
								data-lane={() => task.get().lane}
								data-order={() => String(task.get().order)}
								data-badges={() => task.get().badges}
								data-hint={() => task.get().hint}
							>
								<header>
									<span class="id">{() => task.get().id}</span>
									<span class="badges">{() => task.get().badges}</span>
								</header>
								<h3 class="title">{() => task.get().title}</h3>
								<p class="hint">{() => task.get().hint}</p>
								<footer>
									<span class="area">{() => task.get().area}</span>
								</footer>
							</li>
						))}
					</ul>
				</section>
				<section class="lane" data-lane="in-progress">
					<h2>
						In progress{' '}
						<span class="count" data-count="in-progress">
							{() => String(inProgressList.length)}
						</span>
					</h2>
					<ul class="cards" data-cards="in-progress">
						{inProgressList.map(task => (
							<li
								class="card"
								data-title={() => task.get().title}
								data-area={() => task.get().area}
								data-lane={() => task.get().lane}
								data-order={() => String(task.get().order)}
								data-badges={() => task.get().badges}
								data-hint={() => task.get().hint}
							>
								<header>
									<span class="id">{() => task.get().id}</span>
									<span class="badges">{() => task.get().badges}</span>
								</header>
								<h3 class="title">{() => task.get().title}</h3>
								<p class="hint">{() => task.get().hint}</p>
								<footer>
									<span class="area">{() => task.get().area}</span>
								</footer>
							</li>
						))}
					</ul>
				</section>
				<section class="lane" data-lane="review-pending">
					<h2>
						Review pending{' '}
						<span class="count" data-count="review-pending">
							{() => String(reviewPendingList.length)}
						</span>
					</h2>
					<ul class="cards" data-cards="review-pending">
						{reviewPendingList.map(task => (
							<li
								class="card"
								data-title={() => task.get().title}
								data-area={() => task.get().area}
								data-lane={() => task.get().lane}
								data-order={() => String(task.get().order)}
								data-badges={() => task.get().badges}
								data-hint={() => task.get().hint}
							>
								<header>
									<span class="id">{() => task.get().id}</span>
									<span class="badges">{() => task.get().badges}</span>
								</header>
								<h3 class="title">{() => task.get().title}</h3>
								<p class="hint">{() => task.get().hint}</p>
								<footer>
									<span class="area">{() => task.get().area}</span>
								</footer>
							</li>
						))}
					</ul>
				</section>
				<section class="lane" data-lane="in-review">
					<h2>
						In review{' '}
						<span class="count" data-count="in-review">
							{() => String(inReviewList.length)}
						</span>
					</h2>
					<ul class="cards" data-cards="in-review">
						{inReviewList.map(task => (
							<li
								class="card"
								data-title={() => task.get().title}
								data-area={() => task.get().area}
								data-lane={() => task.get().lane}
								data-order={() => String(task.get().order)}
								data-badges={() => task.get().badges}
								data-hint={() => task.get().hint}
							>
								<header>
									<span class="id">{() => task.get().id}</span>
									<span class="badges">{() => task.get().badges}</span>
								</header>
								<h3 class="title">{() => task.get().title}</h3>
								<p class="hint">{() => task.get().hint}</p>
								<footer>
									<span class="area">{() => task.get().area}</span>
								</footer>
							</li>
						))}
					</ul>
				</section>
				<section class="lane" data-lane="done">
					<h2>
						Done{' '}
						<span class="count" data-count="done">
							{() => String(doneList.length)}
						</span>
					</h2>
					<ul class="cards" data-cards="done">
						{doneList.map(task => (
							<li
								class="card"
								data-title={() => task.get().title}
								data-area={() => task.get().area}
								data-lane={() => task.get().lane}
								data-order={() => String(task.get().order)}
								data-badges={() => task.get().badges}
								data-hint={() => task.get().hint}
							>
								<header>
									<span class="id">{() => task.get().id}</span>
									<span class="badges">{() => task.get().badges}</span>
								</header>
								<h3 class="title">{() => task.get().title}</h3>
								<p class="hint">{() => task.get().hint}</p>
								<footer>
									<span class="area">{() => task.get().area}</span>
								</footer>
							</li>
						))}
					</ul>
				</section>
			</div>

			<style>{css`
			@scope {
				:where(:scope) {
					--qb-bg: #10141b;
					--qb-panel: #161c26;
					--qb-card: #1c232f;
					--qb-border: #2a3342;
					--qb-text: #e8ecf3;
					--qb-muted: #8b95a7;
					--qb-accent: #6ea8fe;
					--qb-rework: #e0a458;
					--qb-blocked: #e05252;
					--qb-reviewed: #58b368;
					--qb-closed: #6b7280;

					display: flex;
					flex-direction: column;
					gap: 1rem;
					container-type: inline-size;
					color: var(--qb-text);
					font-family:
						system-ui,
						sans-serif;
				}

				.meta {
					display: flex;
					align-items: baseline;
					justify-content: space-between;
					gap: 1rem;

					& h1 {
						font-size: 1.25rem;
						margin: 0;
					}

					& .updated {
						color: var(--qb-muted);
						font-size: 0.75rem;
						margin: 0;
						font-variant-numeric: tabular-nums;
					}
				}

				.problems {
					margin: 0;
					padding: 0.5rem 0.75rem;
					border: 1px solid var(--qb-blocked);
					border-radius: 0.375rem;
					background: color-mix(
						in oklab,
						var(--qb-blocked) 12%,
						transparent
					);
					color: var(--qb-text);
					font-size: 0.75rem;
					white-space: pre-wrap;

					&:empty {
						display: none;
					}
				}

				.board {
					display: grid;
					grid-template-columns: repeat(6, minmax(11rem, 1fr));
					gap: 0.75rem;
					align-items: start;
				}

				.lane {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
					min-width: 0;

					& h2 {
						font-size: 0.75rem;
						font-weight: 600;
						text-transform: uppercase;
						letter-spacing: 0.04em;
						color: var(--qb-muted);
						margin: 0;
					}

					& .count {
						font-variant-numeric: tabular-nums;
						color: var(--qb-text);
					}
				}

				.cards {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
					list-style: none;
					margin: 0;
					padding: 0;

					&:empty::after {
						content: '';
						display: block;
						min-height: 3rem;
						border: 1px dashed var(--qb-border);
						border-radius: 0.5rem;
					}
				}

				.card {
					display: flex;
					flex-direction: column;
					gap: 0.25rem;
					padding: 0.5rem 0.625rem;
					background: var(--qb-card);
					border: 1px solid var(--qb-border);
					border-left: 3px solid var(--qb-muted);
					border-radius: 0.5rem;

					& header {
						display: flex;
						justify-content: space-between;
						gap: 0.5rem;
						font-size: 0.7rem;
						color: var(--qb-muted);
						font-variant-numeric: tabular-nums;
					}

					& .badges:empty {
						display: none;
					}

					& .title {
						font-size: 0.8rem;
						font-weight: 500;
						margin: 0;
					}

					& .hint {
						font-size: 0.7rem;
						color: var(--qb-muted);
						margin: 0;

						&:empty {
							display: none;
						}
					}

					& footer .area {
						font-size: 0.7rem;
						color: var(--qb-accent);
					}

					&[data-badges~='rework'] {
						border-left-color: var(--qb-rework);
					}

					&[data-badges~='blocked'] {
						border-left-color: var(--qb-blocked);
					}

					&[data-badges~='reviewed'] {
						border-left-color: var(--qb-reviewed);
					}

					&[data-badges~='closed'] {
						border-left-color: var(--qb-closed);
						opacity: 0.7;
					}
				}

				@container (width < 70rem) {
					.board {
						grid-template-columns: repeat(3, minmax(11rem, 1fr));
					}
				}

				@container (width < 45rem) {
					.board {
						grid-template-columns: repeat(2, minmax(11rem, 1fr));
					}
				}
			}`}</style>
		</queue-board>
	)
}
