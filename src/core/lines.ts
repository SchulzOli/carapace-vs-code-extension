import { Lexer, type Token } from "n3";

import { RDF_NS } from "./namespaces";

export type LineMapping = {
	uriToLine: Map<string, number>;
	lineToUris: Map<number, string[]>;
};

const DECLARATION_TYPES = new Set(["@prefix", "@base", "PREFIX", "BASE"]);
const BLANK_START_TYPES = new Set(["blank", "[", "("]);

export function computeLineMapping(
	content: string,
	prefixMap: Record<string, string>,
	lineMapping?: LineMapping,
	tokens?: Token[]
): LineMapping {
	const uriToLine = lineMapping?.uriToLine ?? new Map<string, number>();
	const lineToUris = lineMapping?.lineToUris ?? new Map<number, string[]>();
	const namespaceByPrefix = reversePrefixMap(prefixMap);

	let subject: string | null = null;
	let predicate: string | null = null;
	let inDeclaration = false;
	let suppressSubject = false;

	let currentBasePrefix = "";

	const addToUri = (line: number, uri: string) => {
		if (!uriToLine.has(uri)) uriToLine.set(uri, line);
	};

	const addToLine = (line: number, uri: string | null) => {
		if (!uri) return;

		const uris = lineToUris.get(line);
		if (uris) {
			if (uris[uris.length - 1] !== uri) uris.push(uri);
		} else {
			lineToUris.set(line, [uri]);
		}
	};

	const resolveUri = (token: Token): string => {
		if (token.type === "IRI") {
			const value = token.value ?? "";
			return currentBasePrefix ? new URL(value, currentBasePrefix).href : value;
		}
		return "" + namespaceByPrefix.get(token.prefix ?? "") + token.value;
	};

	// RDF 1.2: `<< s p o ~ r >>` reified triples, `<<( s p o )>>` triple terms, `{| ... |}` annotation blocks
	let reifiedDepth = 0;
	let tripleTermDepth = 0;
	let annotationDepth = 0;
	let statementIsReified = false;
	let expectReifier = false;
	const savedPredicates: (string | null)[] = [];

	const ts = tokens ?? Array.from(new Lexer({ n3: false }).tokenize(content));
	for (let i = 0; i < ts.length; i++) {
		const token = ts[i];
		const isTerm = token.type === "prefixed" || token.type === "IRI";

		if (expectReifier) {
			expectReifier = false;
			if (isTerm) {
				// a named reifier is the subject of its rdf:reifies triple
				const uri = resolveUri(token);
				addToUri(token.line, uri);
				if (statementIsReified && reifiedDepth === 1 && !subject) {
					subject = uri;
					suppressSubject = false;
				}
				addToLine(token.line, subject);
				continue;
			}
		}

		if (token.type === "<<") {
			if (reifiedDepth === 0 && tripleTermDepth === 0 && annotationDepth === 0 && !subject) {
				statementIsReified = true;
			}
			reifiedDepth++;
		} else if (token.type === ">>") {
			reifiedDepth = Math.max(0, reifiedDepth - 1);
			// an unnamed reifier is a blank node: what follows belongs to it, not to a named subject
			if (reifiedDepth === 0 && statementIsReified && !subject) suppressSubject = true;
		} else if (token.type === "<<(") {
			tripleTermDepth++;
		} else if (token.type === ")>>") {
			tripleTermDepth = Math.max(0, tripleTermDepth - 1);
		} else if (token.type === "~") {
			expectReifier = true;
		} else if (token.type === "{|") {
			savedPredicates.push(predicate);
			annotationDepth++;
		} else if (token.type === "|}") {
			annotationDepth = Math.max(0, annotationDepth - 1);
			predicate = savedPredicates.pop() ?? null;
		} else if (reifiedDepth > 0 || tripleTermDepth > 0 || annotationDepth > 0) {
			// terms inside quoted/annotated triples do not describe the statement's subject
		} else if (token.type === ";") {
			predicate = null;
		} else if (token.type === ".") {
			addToLine(token.line, subject);
			subject = null;
			predicate = null;
			suppressSubject = false;
			statementIsReified = false;
			reifiedDepth = tripleTermDepth = annotationDepth = 0;
			savedPredicates.length = 0;
		} else if (DECLARATION_TYPES.has(token.type)) {
			inDeclaration = true;
			if (token.type === "@base" || token.type === "BASE") {
				currentBasePrefix = ts[i + 1]?.value ?? "";
			}
		} else if (BLANK_START_TYPES.has(token.type) && !subject) {
			suppressSubject = true;
		} else if (token.type === "abbreviation" && token.value === "a") {
			if (!suppressSubject && subject && !predicate) predicate = RDF_NS + "type";
		} else if (isTerm) {
			if (inDeclaration) {
				inDeclaration = false;
			} else if (!suppressSubject) {
				const uri = resolveUri(token);
				if (!subject) {
					subject = uri;
					addToUri(token.line, uri);
				} else if (!predicate) {
					predicate = uri;
				}
			}
		} else if (token.type === "literal") {
			if (subject && predicate) {
				addToUri(token.line, `${subject}|${predicate}|${token.value}`);
			}
		}

		addToLine(token.line, subject);
	}

	return { uriToLine, lineToUris };
}

function reversePrefixMap(prefixMap: Record<string, string>): Map<string, string> {
	const map = new Map<string, string>();
	for (const [iri, prefix] of Object.entries(prefixMap)) {
		map.set(prefix, iri);
	}
	return map;
}

export function lineForNodeUri(uri: string | null, mapping: LineMapping | null): number | null {
	if (!mapping || !uri) return null;

	return mapping.uriToLine.get(uri) ?? null;
}
