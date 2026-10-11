import type { FactoryContext } from '@zeix/le-truc'
import { createCell } from '@zeix/le-truc'
import { css } from '@zeix/le-truc-compiler/macros'
import { TplChip } from './tpl-chip.tsx'

export const i18n = {
	greeting: 'Hello',
	count: '{n, plural, one {# item} other {# items}}',
	empty: 'Nothing here',
	none: 'No note',
	open: 'Open',
	close: 'Close',
} as const

export function TplShowcase(
	{
		title,
		href,
		hidden = false,
		items = [],
		mode,
		note,
		i18n: { t },
	}: {
		title: string
		href?: string
		hidden?: boolean
		items?: Array<{ id: string; name: string }>
		mode?: 'a' | 'b'
		note?: string
		i18n: I18n<typeof i18n>
	},
	{ expose }: FactoryContext<{ open: boolean }>,
) {
	const heading = `${title} (${mode ?? 'plain'})`
	const open = createCell(hidden === false)
	expose({ open: open.get })
	return (
		<tpl-showcase data-mode={mode}>
			<h2 id={`${title}-heading`} class="title">
				{heading}
			</h2>
			<a href={href} hidden={hidden} class={mode}>
				{t.greeting}
			</a>
			<p class="count">{t.count({ n: items.length })}</p>
			{note ? <p class="note">{note}</p> : <p class="none">{t.none}</p>}
			<ul>
				{items.length === 0 ? (
					<li class="empty">{t.empty}</li>
				) : (
					items.map(item => {
						const key = `item-${item.id}`
						return (
							<li data-key={key} data-first={item.id === '1'}>
								{item.name}
							</li>
						)
					})
				)}
			</ul>
			<TplChip label={title} class="chip" data-kind={mode} />
			{open.get() ? (
				<section class="panel" aria-expanded={() => open.get()}>
					<span class="title">{title}</span>
					<button type="button" class="close" onClick={() => open.set(false)}>
						{t.close}
					</button>
				</section>
			) : (
				<button type="button" class="opener" onClick={() => open.set(true)}>
					{t.open}
				</button>
			)}
			<style>{css`@scope {
	:where(:scope) {
		display: block;
	}
}`}</style>
		</tpl-showcase>
	)
}
