import { DataFactory, Lexer, Parser } from "n3";
import type { ParserOptions, Quad, Token } from "n3";

import type { LineMapping } from "./lines";

export function parseTurtle(content: string): {
	triples: Quad[];
	prefixMap: Record<string, string>;
	parseError: string;
	parseErrorLine: number | null;
	lineMapping: LineMapping;
	tokens: Token[];
} {
	let parseError = "";
	let parseErrorLine: number | null = null;
	let triples: Quad[] = [];
	const prefixMap: Record<string, string> = {};
	const lineMapping: LineMapping = { uriToLine: new Map(), lineToUris: new Map() };
	let tokens: Token[] = [];
	try {
		tokens = new Lexer().tokenize(content);
	} catch (e) {
		parseError = e instanceof Error ? e.message : "Invalid TTL";
		parseErrorLine = errorLine(e);
	}

	const parser = makeLineMappingParser(tokens, lineMapping);
	try {
		triples = parser.parse(content);
	} catch (e) {
		parseError = e instanceof Error ? e.message : "Invalid TTL";
		parseErrorLine = errorLine(e);
	}

	const prefixes = (parser as unknown as { _prefixes?: Record<string, string> })._prefixes;
	if (prefixes) {
		for (const [prefix, iri] of Object.entries(prefixes)) {
			prefixMap[iri] = prefix;
		}
	}

	return { triples, prefixMap, parseError, parseErrorLine, lineMapping, tokens };
}

/** 1-based line of an N3 lexer/parser error, if it can be determined. */
function errorLine(e: unknown): number | null {
	const context = (e as { context?: { line?: unknown } } | null)?.context;
	if (context && typeof context.line === "number") return context.line;

	const match = e instanceof Error ? /on line (\d+)/.exec(e.message) : null;
	return match ? Number(match[1]) : null;
}

function makeLineMappingParser(tokens: Token[], lineMapping: LineMapping): Parser {
	let currentLine = 1;

	const seedUri = (line: number, uri: string) => {
		if (!lineMapping.uriToLine.has(uri)) lineMapping.uriToLine.set(uri, line);
	};

	const seedLine = (line: number, uri: string) => {
		const uris = lineMapping.lineToUris.get(line);
		if (uris) {
			if (uris[uris.length - 1] !== uri) uris.push(uri);
		} else {
			lineMapping.lineToUris.set(line, [uri]);
		}
	};

	const lexer = {
		previousToken: null as Token | null,
		tokenize() {
			return {
				every(fn: (token: Token) => boolean) {
					let keepGoing = true;
					for (const token of tokens) {
						currentLine = token.line;
						lexer.previousToken = token;
						keepGoing = fn(token);
						if (!keepGoing) break;
					}
					return keepGoing;
				}
			};
		}
	};

	const factory = {
		...DataFactory,
		blankNode(name?: string) {
			const blank = DataFactory.blankNode(name);
			seedUri(currentLine, blank.value);
			seedLine(currentLine, blank.value);
			return blank;
		},
		quad(subject: Quad["subject"], predicate: Quad["predicate"], object: Quad["object"], graph: Quad["graph"]) {
			if (subject.termType === "BlankNode") {
				seedLine(currentLine, subject.value);
				if (object.termType === "Literal") {
					seedUri(currentLine, `${subject.value}|${predicate.value}|${object.value}`);
				}
			}
			return DataFactory.quad(subject, predicate, object, graph);
		}
	};

	return new Parser({ factory, lexer } as ParserOptions);
}
