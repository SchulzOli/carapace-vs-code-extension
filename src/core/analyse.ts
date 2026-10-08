import type { Quad } from "n3";

import { computeLineMapping } from "./lines";
import type { LineMapping } from "./lines";
import { parseTurtle } from "./turtle";

export type TurtleError = {
	message: string;
	/** 1-based line number, if known. */
	line: number | null;
};

export type TurtleAnalysis = {
	triples: Quad[];
	/** namespace IRI -> prefix */
	prefixMap: Record<string, string>;
	lineMapping: LineMapping;
	error: TurtleError | null;
};

/**
 * Parses Turtle and computes the node <-> line mapping, mirroring what Carapace does on every edit.
 * Never throws: syntax errors are reported through `error`.
 */
export function analyseTurtle(content: string): TurtleAnalysis {
	const result = parseTurtle(content);
	const error = result.parseError ? { message: result.parseError, line: result.parseErrorLine } : null;

	let lineMapping = result.lineMapping;
	if (result.triples.length > 0) {
		try {
			lineMapping = computeLineMapping(content, result.prefixMap, result.lineMapping, result.tokens);
		} catch {
			lineMapping = { uriToLine: new Map(), lineToUris: new Map() };
		}
	}

	return { triples: result.triples, prefixMap: result.prefixMap, lineMapping, error };
}
