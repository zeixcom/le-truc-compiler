import { createCell } from '@zeix/le-truc'
import { TplChip } from './tpl-chip.tsx'

export const i18n = {
	greeting: 'Hello',
	count: '{n, plural, one {# item} other {# items}}',
	empty: 'Nothing here',
	none: 'No note',
	open: 'Open',
	close: 'Close',
} as const

export function TplShowcaseR({
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
})
	@{
		const heading = `${title} (${mode ?? 'plain'})`
		const open = createCell(hidden === false)
		expose({ open: open.get })
		<tpl-showcase-r data-mode={mode}>
			<h2 id={`${title}-heading`} class="title">{heading}</h2>
			<a href={href} hidden={hidden} class={mode}>{t.greeting}</a>
			<p class="count">{t.count({ n: items.length })}</p>
			@if (note) {
				<p class="note">{note}</p>
			} @else {
				<p class="none">{t.none}</p>
			}
			<ul>
				@for (const item of items) {
					const key = `item-${item.id}`
					<li data-key={key} data-first={item.id === '1'}>{item.name}</li>
				} @empty {
					<li class="empty">{t.empty}</li>
				}
			</ul>
			<TplChip label={title} class="chip" data-kind={mode} />
			@if (open.get()) {
				<section class="panel" aria-expanded={() => open.get()}>
					<span class="title">{title}</span>
					<button type="button" class="close" onClick={() => open.set(false)}>{t.close}</button>
				</section>
			} @else {
				<button type="button" class="opener" onClick={() => open.set(true)}>{t.open}</button>
			}
			<style>@scope {
	:where(:scope) {
		display: block;
	}
}</style>
		</tpl-showcase-r>
	}
