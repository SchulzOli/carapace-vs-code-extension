import { XSD_NS } from "./namespaces";
import { resolveLocalName, resolvePrefix } from "./ontology";

/**
 * Structural view of an RDF term including RDF 1.2 triple terms (`termType: "Quad"`) and base directions, which the
 * N3.js typings predate.
 */
export type RdfTerm = {
	termType: string;
	value: string;
	language?: string;
	direction?: string;
	datatype?: { value: string };
	subject?: RdfTerm;
	predicate?: RdfTerm;
	object?: RdfTerm;
};

export function isTripleTerm(term: { termType: string }): boolean {
	return term.termType === "Quad";
}

const SHORTHAND_LITERALS = new Map<string, RegExp>([
	[XSD_NS + "integer", /^[+-]?\d+$/],
	[XSD_NS + "decimal", /^[+-]?\d*\.\d+$/],
	[XSD_NS + "double", /^[+-]?(\d+\.?\d*|\.\d+)[eE][+-]?\d+$/],
	[XSD_NS + "boolean", /^(true|false)$/]
]);

/** Blank node labels change on every parse (`b12_x`); keep only the part written in the document. */
function stableBlankLabel(value: string): string {
	const match = /^b\d+_(.+)$/.exec(value);
	return match ? match[1] : "";
}

function shortIri(iri: string, prefixes: Record<string, string>): string {
	const prefix = resolvePrefix(iri, prefixes);
	return prefix !== null ? `${prefix}:${resolveLocalName(iri)}` : `<${iri}>`;
}

/**
 * Identity of an RDF 1.2 triple term (`<<( s p o )>>`): equal triple terms are the same RDF term, so they share a
 * graph node. Built from full IRIs so it does not depend on prefixes.
 */
export function tripleTermKey(term: RdfTerm): string {
	switch (term.termType) {
		case "Quad":
			return `<<(${tripleTermKey(term.subject!)} ${tripleTermKey(term.predicate!)} ${tripleTermKey(term.object!)})>>`;
		case "Literal": {
			const lang = term.language ? `@${term.language}${term.direction ? `--${term.direction}` : ""}` : "";
			return `${JSON.stringify(term.value)}${lang || `^^${term.datatype?.value ?? ""}`}`;
		}
		case "BlankNode":
			return `_:${stableBlankLabel(term.value)}`;
		default:
			return `<${term.value}>`;
	}
}

/** Human readable Turtle form of a term, using the document's prefixes, e.g. `<<( ex:earth ex:shape ex:flat )>>`. */
export function formatTerm(term: RdfTerm, prefixes: Record<string, string>): string {
	switch (term.termType) {
		case "Quad":
			return `<<( ${formatTerm(term.subject!, prefixes)} ${formatTerm(term.predicate!, prefixes)} ${formatTerm(term.object!, prefixes)} )>>`;
		case "Literal": {
			const value = JSON.stringify(term.value);
			if (term.language) return `${value}@${term.language}${term.direction ? `--${term.direction}` : ""}`;
			const datatype = term.datatype?.value ?? XSD_NS + "string";
			if (datatype === XSD_NS + "string") return value;
			// Turtle's shorthand for numbers and booleans
			if (SHORTHAND_LITERALS.get(datatype)?.test(term.value)) return term.value;
			return `${value}^^${shortIri(datatype, prefixes)}`;
		}
		case "BlankNode": {
			const label = stableBlankLabel(term.value);
			return label ? `_:${label}` : "[]";
		}
		default:
			return shortIri(term.value, prefixes);
	}
}

/**
 * A literal split for display: its value as written, and its language (`@en`) or datatype (`zoo:Age`) as a tag.
 * Plain strings and literals Turtle writes without a datatype (`42`, `true`) get no tag.
 */
export function literalParts(term: RdfTerm, prefixes: Record<string, string>): { value: string; tag: string | null } {
	if (term.language)
		return { value: term.value, tag: `@${term.language}${term.direction ? `--${term.direction}` : ""}` };
	const datatype = term.datatype?.value ?? XSD_NS + "string";
	if (datatype === XSD_NS + "string" || SHORTHAND_LITERALS.get(datatype)?.test(term.value)) {
		return { value: term.value, tag: null };
	}
	return { value: term.value, tag: shortIri(datatype, prefixes) };
}
