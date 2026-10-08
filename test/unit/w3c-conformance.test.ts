import { Parser } from "n3";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyseTurtle } from "../../src/core/analyse";

/**
 * Runs the official W3C Turtle 1.1 and 1.2 test suites (https://github.com/w3c/rdf-tests) through the extension's
 * parser. Point W3C_RDF_TESTS at a checkout of that repository to enable it (CI does): `npm run test:w3c`.
 */
const ROOT = process.env.W3C_RDF_TESTS ? resolve(process.env.W3C_RDF_TESTS) : undefined;
const SUITES = ["rdf/rdf11/rdf-turtle/manifest.ttl", "rdf/rdf12/rdf-turtle/manifest.ttl"];

const MF = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#";
const RDFT = "http://www.w3.org/ns/rdftest#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

type TestCase = { id: string; type: string; action: string; result?: string };

function readManifest(path: string, seen = new Set<string>()): TestCase[] {
	if (seen.has(path)) return [];
	seen.add(path);
	const quads = new Parser({ baseIRI: `file://${path}` }).parse(readFileSync(path, "utf8"));
	const objectOf = (subject: string, predicate: string) =>
		quads.find((q) => q.subject.value === subject && q.predicate.value === predicate)?.object.value;
	const tests: TestCase[] = [];

	for (const include of quads.filter((q) => q.predicate.value === MF + "include")) {
		for (let node = include.object.value; node && node !== RDF + "nil"; node = objectOf(node, RDF + "rest") ?? "") {
			const manifest = objectOf(node, RDF + "first");
			if (manifest) tests.push(...readManifest(fileURLToPath(manifest), seen));
		}
	}
	for (const typed of quads.filter(
		(q) => q.predicate.value === RDF + "type" && q.object.value.startsWith(RDFT + "TestTurtle")
	)) {
		const subject = typed.subject.value;
		const result = objectOf(subject, MF + "result");
		tests.push({
			id: subject.slice(subject.lastIndexOf("#") + 1),
			type: typed.object.value.slice(RDFT.length),
			action: fileURLToPath(objectOf(subject, MF + "action")!),
			result: result ? fileURLToPath(result) : undefined
		});
	}
	return tests;
}

/** Number of distinct triples, treating blank nodes as interchangeable (enough to catch dropped/extra triples). */
function distinctTriples(quads: { subject: unknown; predicate: unknown; object: unknown }[]): number {
	const key = (term: unknown): string => {
		const t = term as { termType: string; value: string; language?: string; datatype?: { value: string } };
		if (t.termType === "BlankNode") return "_";
		if (t.termType === "Quad") {
			const q = term as { subject: unknown; predicate: unknown; object: unknown };
			return `<<(${key(q.subject)} ${key(q.predicate)} ${key(q.object)})>>`;
		}
		return `${t.termType}:${t.value}@${t.language ?? ""}^${t.datatype?.value ?? ""}`;
	};
	return new Set(quads.map((q) => `${key(q.subject)} ${key(q.predicate)} ${key(q.object)}`)).size;
}

describe.skipIf(!ROOT)("W3C Turtle conformance", () => {
	for (const suite of SUITES) {
		const manifest = ROOT ? join(ROOT, suite) : "";
		describe.skipIf(!existsSync(manifest))(suite, () => {
			const tests = existsSync(manifest) ? readManifest(manifest) : [];

			it("has tests", () => expect(tests.length).toBeGreaterThan(100));

			for (const test of tests) {
				it(`${test.type} ${test.id}`, () => {
					const analysis = analyseTurtle(readFileSync(test.action, "utf8"));
					if (test.type === "TestTurtleNegativeSyntax" || test.type === "TestTurtleNegativeEval") {
						expect(analysis.error, "invalid Turtle must be rejected").not.toBeNull();
						return;
					}
					expect(analysis.error).toBeNull();
					if (test.type === "TestTurtleEval" && test.result) {
						const expected = new Parser({ format: "N-Triples" }).parse(readFileSync(test.result, "utf8"));
						expect(distinctTriples(analysis.triples)).toBe(distinctTriples(expected));
					}
				});
			}
		});
	}
});
