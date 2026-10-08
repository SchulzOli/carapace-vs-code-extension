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
	describe("graph of reifiers and annotations", () => {
		const ANNOTATED = `PREFIX : <http://example/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
:alice a :Person ; :age 42 .
:alice :knows :bob {| :since "2019-04-01"^^xsd:date ; :source :wiki |} .
<< :alice :age 42 ~ :ageClaim >> :confidence 0.7 .
:carol :believes <<( :alice :livesIn :paris )>> .
:typedClaim a :Claim .
<< :bob :knows :alice ~ :typedClaim >> .`;

		function graph(hidden?: Parameters<typeof buildGraph>[1]["hiddenEntityTypes"]) {
			const analysis = analyseTurtle(ANNOTATED);
			expect(analysis.error).toBeNull();
			const settings = hidden ? { ...defaultGraphSettings(), hiddenEntityTypes: hidden } : defaultGraphSettings();
			return buildGraph(analysis.triples, settings, [], analysis.prefixMap, analysis.lineMapping);
		}

		it("draws annotations on the triple term instead of a hidden blank reifier", () => {
			const { nodes, edges } = graph();
			const statement = nodes.find((n) => n.label === "<<( :alice :knows :bob )>>")!;
			expect(statement).toBeDefined();

			const since = edges.find((e) => e.source === statement && e.label === "since");
			expect(since?.target.nodeType).toBe("literal");
			expect(since?.target.label).toBe("2019-04-01");
			expect(
				edges.some((e) => e.source === statement && e.label === "source" && e.target.uri === EX + "wiki")
			).toBe(true);

			expect(nodes.some((n) => n.blank)).toBe(false);
			expect(edges.some((e) => e.label === "rdf:reifies" && e.source.blank)).toBe(false);
		});

		it("links triple terms to the nodes of their subject and object", () => {
			const { nodes, edges } = graph();
			const linked = (label: string) =>
				edges
					.filter((e) => e.termEdge && e.source.label === label)
					.map((e) => e.target.uri)
					.sort();

			expect(linked("<<( :alice :knows :bob )>>")).toEqual([EX + "alice", EX + "bob"]);
			// the literal object is the node of the asserted triple :alice :age 42
			const age = nodes.find((n) => n.nodeType === "literal" && n.label === "42")!;
			expect(linked("<<( :alice :age 42 )>>")).toEqual([EX + "alice", age.uri].sort());
			// :paris only occurs inside the triple term, so there is no node to link to
			expect(linked("<<( :alice :livesIn :paris )>>")).toEqual([EX + "alice"]);

			const termEdges = edges.filter((e) => e.termEdge);
			expect(termEdges.every((e) => e.label === "" && e.source.nodeType === "tripleTerm")).toBe(true);
		});

		it("lays out triple terms as cards with a subject, predicate and object row", () => {
			const { nodes, edges } = graph();
			const statement = nodes.find((n) => n.label === "<<( :alice :age 42 )>>")!;
			const rows = statement.statement!;
			expect(rows.map((r) => r.role)).toEqual(["subject", "predicate", "object"]);
			// parts with a node show its label and colour, others their Turtle form
			expect(rows.map((r) => r.lines.join(" "))).toEqual(["alice", ":age", "42"]);
			expect(rows.map((r) => r.colour)).toEqual(["blue", null, "overlay-0"]);
			// rows stack below the header and the card grows to hold them
			expect(rows[1].y).toBe(rows[0].y + rows[0].height);
			expect(statement.height).toBeGreaterThan(rows[2].y + rows[2].height);
			expect(rows.every((r) => r.portY > r.y && r.portY < r.y + r.height)).toBe(true);

			// each connector starts at the row of the part it links to
			const roles = edges
				.filter((e) => e.source === statement && e.termEdge)
				.map((e) => [e.termRole, e.target.label]);
			expect(roles).toEqual([
				["subject", "alice"],
				["object", "42"]
			]);
		});

		it("classifies named reifiers as instances unless they are typed", () => {
			const { nodes } = graph();
			expect(nodes.find((n) => n.uri === EX + "ageClaim")?.nodeType).toBe("instance");
			expect(nodes.find((n) => n.uri === EX + "typedClaim")?.nodeType).toBe("instance");
			const typedAs = analyseTurtle(ANNOTATED).triples.find(
				(q) => q.subject.value === EX + "typedClaim" && q.object.value === EX + "Claim"
			);
			expect(typedAs).toBeDefined();
		});

		it("hides annotations together with triple terms", () => {
			const { nodes, edges } = graph(["blank", "tripleTerm"]);
			expect(nodes.some((n) => n.nodeType === "tripleTerm")).toBe(false);
			expect(edges.some((e) => e.termEdge || e.label === "since")).toBe(false);
			expect(nodes.some((n) => n.label === "2019-04-01")).toBe(false);
		});

		it("still draws a named blank reifier normally when blank nodes are shown", () => {
			const analysis = analyseTurtle(
				"PREFIX : <http://example/>\n_:r1 :note 1 .\n_:r1 <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> <<( :a :b :c )>> , <<( :d :e :f )>> ."
			);
			const settings = { ...defaultGraphSettings(), hiddenEntityTypes: [] };
			const { nodes, edges } = buildGraph(analysis.triples, settings, [], analysis.prefixMap);
			// reifying two statements: no collapse, the blank node stays and points at both
			expect(edges.filter((e) => e.label === "rdf:reifies" && e.source.blank)).toHaveLength(2);
			expect(nodes.filter((n) => n.nodeType === "tripleTerm")).toHaveLength(2);
		});
	});
});
