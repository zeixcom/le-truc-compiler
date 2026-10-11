import { type AstNode, forEachFreeIdentifier } from './ast-utils'
import { childrenInsertionsOf } from './children-region'
import { dedentCss, parseComponentSheet } from './css'
import { type ContractFinding, checkSheetContract } from './css-scope'
import type { LocalDiagnostic, Site, StyleBlockRefusal } from './diagnostics'
import { diagnostic } from './diagnostics'
import type { ExtractContext } from './extract-context'
import {
	collectMatchingElements,
	inOptionalBranch,
	inReactiveArm,
	inReconcileItem,
	namesCustomElementTag,
	namesDeclaredRole,
	reportStaticIds,
	shareExclusiveIf,
} from './first-refs'
import { claimMarker } from './imports'
import type {
	ComponentSheet,
	FirstRefDecl,
	FirstRefStage,
	ForIR,
	TemplateNode,
} from './ir'
import type { SetupExtraction } from './setup-extraction'
import { wordingOf } from './surface'
import { walkTemplate } from './walk'

export type StylesheetRead = string | StyleBlockRefusal

/** Template-output resolution: the root, the style block, the CSS and the parsed sheet. */
export type ResolvedTemplate = {
	root: TemplateNode & { kind: 'element' }
	styleChild: (TemplateNode & { kind: 'element' }) | null
	css: string
	sheetText: string | null
	/** The parsed stylesheet, null when absent or unparseable. */
	sheet: ComponentSheet | null
	firstRefs: Map<string, FirstRefDecl>
}

export const resolveTemplateOutput = (
	ctx: ExtractContext,
	filename: string,
	extraction: SetupExtraction,
	lowered: TemplateNode[],
	stylesheetOf: (ctx: ExtractContext, node: AstNode) => StylesheetRead,
	outputShapeLabel: string,
	fors: ReadonlyMap<AstNode, ForIR> = new Map(),
): ResolvedTemplate | null => {
	const source = ctx.source
	const root = lowered.find(
		(n): n is TemplateNode & { kind: 'element' } => n.kind === 'element',
	)
	if (!root) {
		ctx.diagnostics.push(
			diagnostic.invalidSource(
				ctx.source,
				undefined,
				`${filename}: no root element found in ${outputShapeLabel}.`,
			),
		)
		return null
	}
	if (!root.tag.includes('-')) {
		ctx.diagnostics.push(
			diagnostic.invalidSource(
				ctx.source,
				root.node,
				`${filename}: the root element must be the component's custom element tag (got \`${root.tag}\`).`,
			),
		)
		return null
	}

	// Hoist the `<style>` block out of the root's children: it is the component's stylesheet, never rendered markup. First direct `style` child wins.
	const styleIndex = root.children.findIndex(
		(n): n is TemplateNode & { kind: 'element' } =>
			n.kind === 'element' && n.tag === 'style',
	)
	const styleChild =
		styleIndex >= 0
			? (root.children.splice(styleIndex, 1)[0] as TemplateNode & {
					kind: 'element'
				})
			: null
	// LTC073: the hoisted child is the only accepted `<style>` — any left in the tree, a second direct child or one nested in a descendant (composed content included), would render empty, its CSS silently dropped.
	walkTemplate(root, (node, parent) => {
		if (node.kind === 'element' && node.tag === 'style') {
			ctx.diagnostics.push(
				diagnostic.misplacedStyleBlock(source, node.node, parent !== root),
			)
			// Its `css` tag is this refusal's, not a stray marker.
			forEachFreeIdentifier(node.node, identifier =>
				claimMarker(ctx, identifier),
			)
		}
	})

	// LTC078: the hoisted child's content must be a stylesheet spelling — anything else would read as an empty sheet, the component shipping no CSS without a word.
	const sheetRead = styleChild ? stylesheetOf(ctx, styleChild.node) : ''
	let sheetText = ''
	if (typeof sheetRead === 'string') sheetText = sheetRead
	else
		ctx.diagnostics.push(
			diagnostic.unreadableStyleBlock(source, sheetRead, wordingOf(ctx)),
		)

	// Resolve `first(selector, required)` element references now that `root` exists. The reach-in check (LTC083) needs the `{children}` insertions once per template.
	const insertions = childrenInsertionsOf(root)
	const insertsChildren =
		insertions.holders.size > 0 ||
		insertions.forwards.size > 0 ||
		insertions.unmarked
	const firstRefs = new Map<string, FirstRefDecl>()
	for (const [
		refName,
		{ selectorText, reasonText, maybe, node },
	] of extraction.elementRefs) {
		const resolve = (stage: FirstRefStage): void => {
			firstRefs.set(refName, {
				name: refName,
				selector: selectorText,
				required: !maybe,
				reason: reasonText,
				stage,
				at: { start: node.start, end: node.end },
			})
		}
		const { elements } = collectMatchingElements(root, selectorText)
		if (elements.length === 0 && namesCustomElementTag(selectorText)) {
			// A selector naming a custom-element tag that matched no raw element may still address a COMPOSED child, whose tag this single-file pass cannot know — defer the whole decision (match, no match, ambiguity) to the pass that has the compose registry.
			resolve('deferred')
			continue
		}
		if (elements.length === 0) {
			// The reach-in check (LTC083): a selector that matches nothing here, in a template that inserts `{children}`, can only resolve inside the content a parent passes — unless its subject names a declared role, the one surface the child may address that content through. Fires for required and optional references alike. An unreadable roles declaration changes the fix, not the verdict: the compiler cannot claim a role the author may have declared in it is missing.
			const roles = ctx.childrenContract?.roles
			const declared = namesDeclaredRole(
				selectorText,
				new Set(roles?.keys() ?? []),
			)
			if (insertsChildren && declared === false) {
				ctx.diagnostics.push(
					diagnostic.childrenReachIn(
						source,
						node,
						'first',
						refName,
						selectorText,
						ctx.childrenContract?.unreadable === true,
					),
				)
				resolve('rejected')
				continue
			}
			if (insertsChildren && declared === true) {
				resolve('unmatched')
				continue
			}
			// An OPTIONAL ref is allowed to match nothing here: "may be absent" includes "the page, not this template, authors it" — the structural proof LTC026 rests on (counting matches in the IR is counting matches in the DOM) has nothing to say about markup the component didn't render, so the client queries the authored selector as-is.
			if (maybe) {
				resolve('unmatched')
				continue
			}
			ctx.diagnostics.push(
				diagnostic.firstSelectorNotFound(source, node, refName, selectorText),
			)
			resolve('rejected')
			continue
		}
		const inArm = elements.find(el => inReactiveArm(root, el))
		if (inArm) {
			ctx.diagnostics.push(
				diagnostic.unsupported(
					source,
					node,
					`A \`first()\` reference to <${inArm.tag}> inside a reactive conditional's arm`,
					"The arm's elements are cloned anew each time the arm renders, so a reference taken at connect goes stale — bind the element from inside the arm instead (an event handler or a reactive attribute on it).",
				),
			)
			resolve('rejected')
			continue
		}
		// The same staleness inside a reactive-list item: an item's elements exist once per item and are recreated on every reconcile — the host-level reference would bind the first item's.
		const itemOutputs = [...fors.values()]
			.filter(l => l.kind === 'reconcile')
			.map(l => l.output)
		const inItem = elements.find(el => inReconcileItem(itemOutputs, el))
		if (inItem) {
			ctx.diagnostics.push(
				diagnostic.unsupported(
					source,
					node,
					`A \`first()\` reference to <${inItem.tag}> inside a reactive-list loop body`,
					"The item's elements exist once per item and are recreated on every reconcile, so a reference taken at connect goes stale — bind the element from inside the item instead (an event handler or a reactive attribute on it).",
				),
			)
			resolve('rejected')
			continue
		}
		if (!maybe && elements.every(el => inOptionalBranch(root, el)))
			ctx.diagnostics.push(
				diagnostic.deadRequiredReason(source, node, refName, selectorText),
			)
		if (elements.length > 1 && !shareExclusiveIf(root, elements)) {
			ctx.diagnostics.push(
				diagnostic.firstSelectorAmbiguous(
					source,
					node,
					refName,
					selectorText,
					elements.length,
					wordingOf(ctx),
				),
			)
			resolve('rejected')
			continue
		}
		// Two `first()` names resolving to the same element is a mistake the IR cannot represent: `attrs` is a list, but every consumer reads the ref with `.find()`, so the second name would silently never become a query.
		const claimed = elements.flatMap(el => el.attrs).find(a => a.kind === 'ref')
		if (claimed) {
			ctx.diagnostics.push(
				diagnostic.firstSelectorDuplicate(
					source,
					node,
					refName,
					selectorText,
					claimed.name,
					extraction.elementRefs.get(claimed.name)?.node,
				),
			)
			resolve('rejected')
			continue
		}
		for (const element of elements)
			element.attrs.push({
				kind: 'ref',
				name: refName,
				selector: selectorText,
			})
		resolve('matched')
	}

	// LTC042: a constant `id` in a template duplicates as soon as a page places the component twice. Runs here, beside LTC039 — the walk needs `root`.
	reportStaticIds(root, source, ctx.diagnostics)

	// CSS: verbatim, dedented for emission, and parsed into the sheet the IR carries — with the spec-grammar faces of LTC064/LTC065 reported against the authored source.
	let sheet: ComponentSheet | null = null
	if (styleChild) {
		if (sheetText.trim()) {
			const parsed = parseComponentSheet(sheetText)
			// The sheet text is a verbatim slice of the source (the template literal's raw slice on `.tsx`, the tag's inner text on `.tsrx`), so the sheet offset maps onto the authored offset — undefined only if the slice cannot be relocated.
			const sheetStart = source.indexOf(sheetText, styleChild.node.start)
			for (const sheetError of parsed.errors) {
				const authoredOffset = authoredRange(sheetStart, sheetError)
				switch (sheetError.face) {
					case 'syntax':
						ctx.diagnostics.push(
							diagnostic.malformedStyleSheet(
								source,
								authoredOffset,
								sheetError.detail,
							),
						)
						break
					case 'unknown-property':
						ctx.diagnostics.push(
							diagnostic.unknownCssProperty(
								source,
								authoredOffset,
								sheetError.property ?? '',
							),
						)
						break
					case 'invalid-value':
						ctx.diagnostics.push(
							diagnostic.invalidCssValue(
								source,
								authoredOffset,
								sheetError.property ?? '',
								sheetError.value ?? '',
							),
						)
						break
				}
			}
			sheet = parsed.sheet
			// The platform-CSS authored form: the checks run over the parsed sheet only — a sheet lightningcss refused is already LTC064's — and report against the authored source.
			if (sheet) {
				const findings = checkSheetContract(sheet, sheetText, root.tag)
				for (const finding of findings)
					ctx.diagnostics.push(
						contractDiagnostic(source, sheetStart, finding, root.tag),
					)
			}
		}
	}
	const css = styleChild ? dedentCss(sheetText) : ''
	const hasSheet = sheetText.trim() !== '' && sheet !== null

	return {
		root,
		styleChild,
		css,
		sheetText: hasSheet ? sheetText : null,
		sheet,
		firstRefs,
	}
}

export const authoredRange = (
	sheetStart: number,
	finding: { offset?: number | undefined; end?: number | undefined },
): Site =>
	sheetStart >= 0 && finding.offset !== undefined
		? {
				start: sheetStart + finding.offset,
				end: sheetStart + (finding.end ?? finding.offset),
			}
		: undefined

/** Map one stylesheet contract finding onto its diagnostic: the sheet offset lifts into the authored source when the slice relocated, and each face names its own builder. */
const contractDiagnostic = (
	source: string,
	sheetStart: number,
	finding: ContractFinding,
	tag: string,
): LocalDiagnostic => {
	const authoredOffset = authoredRange(sheetStart, finding)
	switch (finding.face) {
		case 'own-tag-led':
			return diagnostic.ownTagLedRule(source, authoredOffset, tag)
		case 'slotted':
			return diagnostic.slottedInLightDom(source, authoredOffset)
		case 'host-context':
			return diagnostic.hostContextSelector(source, authoredOffset)
		case 'host':
			return diagnostic.hostSelector(source, authoredOffset)
		case 'global':
			return diagnostic.globalSelector(source, authoredOffset)
		case 'dead-by-limit':
			return diagnostic.deadByLimit(
				source,
				authoredOffset,
				finding.selector,
				finding.limit ?? '',
			)
		case 'unscoped':
			return diagnostic.unscopedRule(
				source,
				authoredOffset,
				finding.selector,
				tag,
			)
	}
}
