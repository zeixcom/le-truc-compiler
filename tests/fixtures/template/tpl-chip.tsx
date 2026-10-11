import { css } from '@zeix/le-truc-compiler/macros'

export const i18n = { suffix: 'chip' } as const

export function TplChip({
	label,
	i18n: { t },
}: {
	label?: string
	i18n: I18n<typeof i18n>
}) {
	return (
		<tpl-chip>
			<span class="label">{label}</span>
			<small>{t.suffix}</small>
			<style>{css`@scope {
	:where(:scope) {
		display: inline-block;
	}
}`}</style>
		</tpl-chip>
	)
}
