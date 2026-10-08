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
			return datatype === XSD_NS + "string" ? value : `${value}^^${shortIri(datatype, prefixes)}`;
		}
		case "BlankNode": {
			const label = stableBlankLabel(term.value);
			return label ? `_:${label}` : "[]";
		}
		default:
			return shortIri(term.value, prefixes);
	}
}
