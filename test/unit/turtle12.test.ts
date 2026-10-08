import { describe, expect, it } from "vitest";

import { analyseTurtle } from "../../src/core/analyse";
import { buildGraph } from "../../src/core/graph";
import { buildOutline } from "../../src/core/outline";
import { defaultGraphSettings } from "../../src/core/settings";
import { resolveTerm, termAt } from "../../src/core/terms";

const EX = "http://example/";
const RDF_REIFIES = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";

const DOC = `VERSION "1.2"
PREFIX : <http://example/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

:alice :knows :bob {| :since 2020 |} .

<< :bob :likes :carol ~ :claim1 >>
    :certainty 0.8 .

:dave :said <<( :earth :shape :flat )>> .
:erin :said <<( :earth :shape :flat )>> .

:x rdfs:label "hello"@en--ltr .
`;

function lineOf(needle: string): number {
	return DOC.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

describe("Turtle 1.2", () => {
	it("parses version directives, reified triples, triple terms, annotations and base directions", () => {
		const analysis = analyseTurtle(DOC);
		expect(analysis.error).toBeNull();

		const reifies = analysis.triples.filter((q) => q.predicate.value === RDF_REIFIES);
		expect(reifies).toHaveLength(2); // the annotation and the reified triple
		expect(reifies.every((q) => (q.object.termType as string) === "Quad")).toBe(true);
		expect(reifies.some((q) => q.subject.value === EX + "claim1")).toBe(true);

		const label = analysis.triples.find((q) => q.subject.value === EX + "x")!.object as unknown as {
			language: string;
			direction: string;
		};
		expect(label.language).toBe("en");
		expect(label.direction).toBe("ltr");
	});

	it("accepts @version and both version string quotes", () => {
		for (const directive of ['@version "1.2" .', "@version '1.2' .", "VERSION '1.2-basic'"]) {
			expect(analyseTurtle(`${directive}\n<http://a> <http://b> <http://c> .`).error).toBeNull();
		}
	});

	it("rejects N3-only syntax that is not valid Turtle", () => {
		for (const n3 of [
			"{ <http://a> <http://b> <http://c> } => { <http://a> <http://b> <http://d> } .",
			"<http://a> = <http://b> .",
			"@keywords a .",
			"<http://a> <http://b> ?x ."
		]) {
			expect(analyseTurtle(n3).error, n3).not.toBeNull();
		}
	});

	it("still parses classic Turtle 1.1 documents", () => {
		const analysis = analyseTurtle(
			'@base <http://example/> .\n@prefix ex: <http://example/> .\n<s> ex:p "x"@en, """multi\nline""", 1.5e3, true, ( 1 2 ), [ ex:q _:b ] .'
		);
		expect(analysis.error).toBeNull();
		expect(analysis.triples.length).toBeGreaterThan(5);
	});

	it("draws triple terms as their own nodes, shared between identical terms", () => {
		const analysis = analyseTurtle(DOC);
		const { nodes, edges } = buildGraph(
			analysis.triples,
			defaultGraphSettings(),
			[],
			analysis.prefixMap,
			analysis.lineMapping
		);

		const tripleTerms = nodes.filter((n) => n.nodeType === "tripleTerm");
		const flat = tripleTerms.find((n) => n.label === "<<( :earth :shape :flat )>>");
		expect(flat).toBeDefined();
		expect(tripleTerms.find((n) => n.label === "<<( :bob :likes :carol )>>")).toBeDefined();
		expect(nodes.some((n) => n.uri === "")).toBe(false);

		// :dave and :erin point at the very same triple term
		const saidTargets = edges.filter((e) => e.label === "said").map((e) => e.target.id);
		expect(saidTargets).toHaveLength(2);
		expect(new Set(saidTargets)).toEqual(new Set([flat!.id]));

		expect(edges.some((e) => e.source.uri === EX + "claim1" && e.label === "rdf:reifies")).toBe(true);
	});

	it("hides triple terms when the entity type is hidden", () => {
		const analysis = analyseTurtle(DOC);
		const settings = { ...defaultGraphSettings(), hiddenEntityTypes: ["blank" as const, "tripleTerm" as const] };
		const { nodes } = buildGraph(analysis.triples, settings, [], analysis.prefixMap);
		expect(nodes.some((n) => n.nodeType === "tripleTerm")).toBe(false);
	});

	it("maps reifiers rather than the quoted subject to the statement line", () => {
		const { lineMapping } = analyseTurtle(DOC);
		const reifiedLine = lineOf("<< :bob :likes :carol ~ :claim1 >>");

		expect(lineMapping.uriToLine.get(EX + "claim1")).toBe(reifiedLine);
		expect(lineMapping.lineToUris.get(reifiedLine)).toEqual([EX + "claim1"]);
		expect(lineMapping.lineToUris.get(reifiedLine + 1)).toEqual([EX + "claim1"]);
		// :bob is first defined as an object of :alice, never as a subject of its own
		expect(lineMapping.uriToLine.has(EX + "bob")).toBe(false);
	});

	it("keeps the outer predicate across annotation blocks", () => {
		const { lineMapping } = analyseTurtle(`PREFIX : <http://example/>
:a :p :b {| :src :x ; :when 1 |} ;
   :q "after" .`);
		expect(lineMapping.uriToLine.get(EX + "a")).toBe(2);
		expect(lineMapping.uriToLine.get(`${EX}a|${EX}q|after`)).toBe(3);
		expect(lineMapping.lineToUris.get(3)).toEqual([EX + "a"]);
	});

	it("lists named reifiers in the outline", () => {
		const outline = buildOutline(analyseTurtle(DOC));
		expect(outline.map((e) => e.name)).toContain(":claim1");
	});

	it("finds Unicode prefixed names for hover and go to definition", () => {
		const line = "ex:Straße ex:größe émoji:café .";
		expect(termAt(line, 4)?.text).toBe("ex:Straße");
		expect(termAt(line, 12)?.text).toBe("ex:größe");
		expect(termAt(line, 22)?.text).toBe("émoji:café");
		expect(resolveTerm("émoji:café", { "http://e/": "émoji" })).toBe("http://e/café");
	});
});
