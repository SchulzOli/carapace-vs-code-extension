import { Writer } from "n3";
import type { Quad } from "n3";
import { RdfXmlParser } from "rdfxml-streaming-parser";

import { BUILTIN_PREFIX_TO_NS } from "../core/namespaces";

function extractXmlPrefixes(content: string): Record<string, string> {
	const prefixes: Record<string, string> = {};
	const xmlnsRegex = /xmlns(:\w[\w.-]*)?\s*=\s*(["'])(.*?)\2/g;
	for (const match of content.matchAll(xmlnsRegex)) {
		const prefix = match[1]?.slice(1) ?? "";
		if (prefix !== "xml") prefixes[prefix] = match[3];
	}
	return prefixes;
}

/** Converts an RDF/XML (.rdf/.owl) document to Turtle, keeping its namespace prefixes (port of Carapace's importer). */
export function rdfXmlToTurtle(content: string, baseIRI: string): Promise<string> {
	const quads: Quad[] = [];

	return new Promise((resolve, reject) => {
		const parser = new RdfXmlParser({ baseIRI });
		parser.on("data", (quad: Quad) => quads.push(quad));
		parser.on("error", reject);
		parser.on("end", () => {
			const writer = new Writer({ prefixes: { ...BUILTIN_PREFIX_TO_NS, ...extractXmlPrefixes(content) } });
			writer.addQuads(quads);
			writer.end((error, ttl) => (error ? reject(error) : resolve(ttl)));
		});
		parser.end(content);
	});
}
