import { BUILTIN_PREFIX_TO_NS } from "./namespaces";

export type TermMatch = { text: string; start: number; end: number };

// <iri> | prefixed:name | :name  (approximation of the Turtle PNAME / IRIREF productions)
const TERM_PATTERN = /<[^<>"{}|^`\\\s]*>|(?:[A-Za-z][\w-]*(?:\.[\w-]+)*)?:(?:[\w:%-]|\.(?=[\w:%-]))*/g;

/** Finds the IRI reference or prefixed name in `lineText` that covers `character` (0-based). */
export function termAt(lineText: string, character: number): TermMatch | null {
	TERM_PATTERN.lastIndex = 0;
	for (const match of lineText.matchAll(TERM_PATTERN)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (character >= start && character <= end && match[0] !== ":") return { text: match[0], start, end };
		if (start > character) break;
	}
	return null;
}

/**
 * Resolves an IRI reference (`<...>`) or prefixed name to a full IRI.
 * `prefixMap` maps namespace IRI -> prefix, as produced by the parser.
 */
export function resolveTerm(text: string, prefixMap: Record<string, string>): string | null {
	if (text.startsWith("<") && text.endsWith(">")) return text.slice(1, -1);

	const colon = text.indexOf(":");
	if (colon < 0) return null;
	const prefix = text.slice(0, colon);
	const local = text.slice(colon + 1);
	if (local.startsWith("//")) return null;

	for (const [ns, p] of Object.entries(prefixMap)) {
		if (p === prefix) return ns + local;
	}
	const builtin = BUILTIN_PREFIX_TO_NS[prefix];
	return builtin ? builtin + local : null;
}
