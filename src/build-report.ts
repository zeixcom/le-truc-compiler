import type { ClassifiedDiagnostic, SimDiagnostic } from './simulation/contract'

/* === Types === */

/** One build report: the corpus's diagnostics, partitioned. */
export type SimReport = {
	/** Standing entries — listed with their reason, never a failure. */
	classified: Array<{
		diagnostic: SimDiagnostic
		classification: ClassifiedDiagnostic
	}>
	/** New entries — each one fails the gate until fixed or classified. */
	unclassified: SimDiagnostic[]
}

/* === Internal Functions === */

/** The component a warning names, or the honest stand-in when none is known. */
const attribution = (diagnostic: SimDiagnostic): string =>
	diagnostic.component ?? 'unattributed'

/** Where the diagnostic happened, phrased for the attribution at hand. */
const location = (diagnostic: SimDiagnostic): string =>
	diagnostic.component === undefined
		? 'a simulated connect outside any render window'
		: 'its simulated connect'

/* === Exported Functions === */

export const classifyDiagnostic = (
	diagnostic: SimDiagnostic,
	classification: ClassifiedDiagnostic,
): boolean =>
	diagnostic.kind === classification.kind &&
	(classification.component === undefined ||
		diagnostic.component === classification.component) &&
	classification.message.test(diagnostic.message)

export const classificationFor = (
	diagnostic: SimDiagnostic,
	classifications: readonly ClassifiedDiagnostic[],
): ClassifiedDiagnostic | undefined =>
	classifications.find(classification =>
		classifyDiagnostic(diagnostic, classification),
	)

export const formatSimDiagnostic = (diagnostic: SimDiagnostic): string => {
	const who = attribution(diagnostic)
	const where = location(diagnostic)
	const detail = diagnostic.message
	switch (diagnostic.kind) {
		case 'jsdom-error':
			return (
				`${who}: jsdom reported an error during ${where}: ${detail} — fix ` +
				'the call if it can affect the serialized markup. Otherwise ' +
				'classify it in `CLASSIFIED_DIAGNOSTICS` with a reason.'
			)
		case 'console': {
			const source =
				diagnostic.level === undefined
					? 'the realm console'
					: `console.${diagnostic.level}`
			return (
				`${who}: ${source} logged during ${where}: ${detail} — fix the ` +
				'reported problem, or remove the call. If it cannot affect the ' +
				'serialized markup, classify it in `CLASSIFIED_DIAGNOSTICS` with a reason.'
			)
		}
		case 'network':
			return `${who}: ${detail}`
		case 'unhandled-rejection':
			return (
				`${who}: an unhandled rejection occurred during ${where} (${detail}) — ` +
				'the build cannot know whether it affected the serialized markup. ' +
				'Handle the rejection in the component, or declare the work as a ' +
				'resolution-phase dependency.'
			)
		case 'component-throw':
			return (
				`${who}: threw during ${where}: ${detail} — the component keeps its ` +
				'server-rendered markup. Fix the throw so the component can enhance ' +
				'it at connect.'
			)
		case 'non-quiescent':
			return `${who}: ${detail}`
	}
}

export const reportDiagnostics = (
	diagnostics: readonly SimDiagnostic[],
	classifications: readonly ClassifiedDiagnostic[],
): SimReport => {
	const classified: SimReport['classified'] = []
	const unclassified: SimDiagnostic[] = []
	for (const diagnostic of diagnostics) {
		const classification = classificationFor(diagnostic, classifications)
		if (classification) classified.push({ diagnostic, classification })
		else unclassified.push(diagnostic)
	}
	return { classified, unclassified }
}

export const formatSimReport = (report: SimReport): string => {
	const lines = report.unclassified.map(formatSimDiagnostic)
	for (const { diagnostic, classification } of report.classified)
		lines.push(
			`${formatSimDiagnostic(diagnostic)}\n    classified (standing): ${classification.reason}`,
		)
	return lines.join('\n')
}
