import type { TurtleAnalysis } from "./analyse";
import { ENTITY_TYPE_DISPLAY } from "./entity";
import { classifyUriType } from "./ontology";
import { Preprocessor } from "./preprocess";
import type { GraphSettings } from "./settings";
import { defaultGraphSettings } from "./settings";
import type { EntityType } from "./types";

export type OutlineEntry = {
	uri: string;
	/** Prefixed name if a prefix is declared, otherwise the full IRI. */
	name: string;
	/** Human readable name taken from the node name predicate (e.g. rdfs:label), if any. */
	label: string | null;
	nodeType: EntityType;
	typeLabel: string;
	/** 1-based, inclusive. */
	startLine: number;
	/** 1-based, inclusive. */
	endLine: number;
};

const TYPE_LABELS = new Map<EntityType, string>(ENTITY_TYPE_DISPLAY.map(({ type, label }) => [type, label]));

export function shortenUri(uri: string, prefixMap: Record<string, string>): string {
	let best: { ns: string; prefix: string } | null = null;
	for (const [ns, prefix] of Object.entries(prefixMap)) {
		if (uri.startsWith(ns) && (!best || ns.length > best.ns.length)) best = { ns, prefix };
	}
	return best ? `${best.prefix}:${uri.slice(best.ns.length)}` : uri;
}

/** Lists the named subjects of a Turtle document with their entity type and line span, in document order. */
export function buildOutline(
	analysis: TurtleAnalysis,
	settings: GraphSettings = defaultGraphSettings()
): OutlineEntry[] {
	const preprocessor = new Preprocessor(settings);
	preprocessor.process(analysis.triples);

	const subjects = new Set<string>();
	for (const quad of analysis.triples) {
		if (quad.subject.termType === "NamedNode") subjects.add(quad.subject.value);
	}

	const linesByUri = new Map<string, number[]>();
	for (const [line, uris] of analysis.lineMapping.lineToUris) {
		for (const uri of uris) {
			if (!subjects.has(uri)) continue;
			let lines = linesByUri.get(uri);
			if (!lines) linesByUri.set(uri, (lines = []));
			lines.push(line);
		}
	}

	const entries: OutlineEntry[] = [];
	for (const uri of subjects) {
		const startLine = analysis.lineMapping.uriToLine.get(uri);
		if (startLine == null) continue;

		// extend over the contiguous block of lines belonging to this subject's statement
		const lines = new Set(linesByUri.get(uri) ?? []);
		let endLine = startLine;
		while (lines.has(endLine + 1)) endLine++;

		const descriptor = preprocessor.nodeDescriptors.get(uri);
		const nodeType = descriptor?.nodeType ?? classifyUriType(uri) ?? "class";
		const name = shortenUri(uri, analysis.prefixMap);
		const label = descriptor?.nameOverride ?? null;

		entries.push({
			uri,
			name,
			label: label && label !== name ? label : null,
			nodeType,
			typeLabel: TYPE_LABELS.get(nodeType) ?? nodeType,
			startLine,
			endLine
		});
	}

	return entries.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
}
