import { describe, expect, it } from "vitest";

import { analyseTurtle } from "../../src/core/analyse";
import { buildGraph } from "../../src/core/graph";
import { buildOutline, shortenUri } from "../../src/core/outline";
import { SAMPLE_TURTLE } from "../../src/core/sample";
import { defaultGraphSettings, normaliseGraphSettings } from "../../src/core/settings";
import { resolveTerm, termAt } from "../../src/core/terms";

const EX = "http://example.org/test#";

function lineOf(text: string, needle: string): number {
	return text.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

describe("analyseTurtle", () => {
	it("parses the sample ontology without errors", () => {
		const analysis = analyseTurtle(SAMPLE_TURTLE);
		expect(analysis.error).toBeNull();
		expect(analysis.triples.length).toBeGreaterThan(20);
		expect(analysis.prefixMap[EX]).toBe("ex");
	});

	it("maps subjects to the line that starts their statement", () => {
		const analysis = analyseTurtle(SAMPLE_TURTLE);
		expect(analysis.lineMapping.uriToLine.get(EX + "Employee")).toBe(lineOf(SAMPLE_TURTLE, "ex:Employee rdf:type"));
		expect(analysis.lineMapping.uriToLine.get(EX + "AliceSmith")).toBe(
			lineOf(SAMPLE_TURTLE, "ex:AliceSmith rdf:type")
		);
	});

	it("maps every line of a statement back to its subject", () => {
		const analysis = analyseTurtle(SAMPLE_TURTLE);
		const rangeLine = lineOf(SAMPLE_TURTLE, "rdfs:range ex:Department");
		expect(analysis.lineMapping.lineToUris.get(rangeLine)).toContain(EX + "worksIn");
	});

	it("reports syntax errors with their line", () => {
		const text = "@prefix ex: <http://e/> .\nex:a ex:b ex:c .\nex:a ex:b ex:c ;\n  foo:x ex:d .\n";
		const analysis = analyseTurtle(text);
		expect(analysis.error).not.toBeNull();
		expect(analysis.error!.line).toBe(4);
		expect(analysis.error!.message).toMatch(/foo/);
	});

	it("reports lexer errors such as unterminated strings", () => {
		const analysis = analyseTurtle('@prefix ex: <http://e/> .\nex:a ex:b "unterminated .\n');
		expect(analysis.error).not.toBeNull();
		expect(analysis.error!.line).toBe(2);
	});

	it("treats an empty document as valid", () => {
		const analysis = analyseTurtle("");
		expect(analysis.error).toBeNull();
		expect(analysis.triples).toHaveLength(0);
	});
});

describe("buildGraph on the sample ontology", () => {
	it("classifies OWL entities and hides the ontology header", () => {
		const analysis = analyseTurtle(SAMPLE_TURTLE);
		const { nodes, edges } = buildGraph(
			analysis.triples,
			defaultGraphSettings(),
			[],
			analysis.prefixMap,
			analysis.lineMapping
		);
		const byUri = new Map(nodes.map((n) => [n.uri, n]));

		expect(byUri.get(EX + "Employee")?.nodeType).toBe("class");
		expect(byUri.get(EX + "worksIn")?.nodeType).toBe("objectProperty");
		expect(byUri.get(EX + "hasSalary")?.nodeType).toBe("dataProperty");
		expect(byUri.get(EX + "SalaryInteger")?.nodeType).toBe("datatype");
		expect(byUri.get(EX + "AliceSmith")?.nodeType).toBe("instance");
		expect(byUri.has("http://example.org/test")).toBe(false);

		// rdfs:label is the node name predicate by default: used as label, not drawn as an edge
		expect(byUri.get(EX + "AliceSmith")?.label).toBe("Alice Smith");
		expect(edges.some((e) => e.label.includes("rdfs:label"))).toBe(false);
		expect(edges.some((e) => e.source.uri === EX + "AliceSmith" && e.target.uri === EX + "EngineeringDept")).toBe(
			true
		);
	});

	it("respects hidden entity types", () => {
		const analysis = analyseTurtle(SAMPLE_TURTLE);
		const settings = {
			...defaultGraphSettings(),
			hiddenEntityTypes: ["blank" as const, "literal" as const, "instance" as const]
		};
		const { nodes } = buildGraph(analysis.triples, settings, [], analysis.prefixMap);
		expect(nodes.some((n) => n.nodeType === "instance" || n.nodeType === "literal")).toBe(false);
	});

	it("keeps cached positions for known nodes", () => {
		const analysis = analyseTurtle(SAMPLE_TURTLE);
		const { nodes } = buildGraph(
			analysis.triples,
			defaultGraphSettings(),
			[{ uri: EX + "Employee", x: 1234, y: -567 }],
			analysis.prefixMap
		);
		const employee = nodes.find((n) => n.uri === EX + "Employee")!;
		expect([employee.x, employee.y]).toEqual([1234, -567]);
	});
});

describe("buildOutline", () => {
	it("lists subjects in document order with their types and spans", () => {
		const outline = buildOutline(analyseTurtle(SAMPLE_TURTLE));
		const names = outline.map((e) => e.name);
		expect(names.indexOf("ex:Employee")).toBeLessThan(names.indexOf("ex:worksIn"));
		expect(names.indexOf("ex:worksIn")).toBeLessThan(names.indexOf("ex:AliceSmith"));

		const worksIn = outline.find((e) => e.name === "ex:worksIn")!;
		expect(worksIn.nodeType).toBe("objectProperty");
		expect(worksIn.typeLabel).toBe("Object Property");
		expect(worksIn.label).toBe("works in");
		expect(worksIn.startLine).toBe(lineOf(SAMPLE_TURTLE, "ex:worksIn rdf:type"));
		expect(worksIn.endLine).toBe(lineOf(SAMPLE_TURTLE, 'rdfs:label "works in"'));
	});

	it("shortens IRIs with the longest matching namespace", () => {
		expect(shortenUri("http://a/b/c", { "http://a/": "a", "http://a/b/": "ab" })).toBe("ab:c");
		expect(shortenUri("http://z/c", { "http://a/": "a" })).toBe("http://z/c");
	});
});

describe("terms", () => {
	it("finds prefixed names and IRIs under the cursor", () => {
		const line = "ex:AliceSmith ex:worksIn <http://example.org/x> .";
		expect(termAt(line, 3)?.text).toBe("ex:AliceSmith");
		expect(termAt(line, 16)?.text).toBe("ex:worksIn");
		expect(termAt(line, 30)?.text).toBe("<http://example.org/x>");
		expect(termAt(line, line.length - 1)).toBeNull();
	});

	it("does not swallow the statement terminator", () => {
		expect(termAt("ex:a ex:b ex:c.", 12)?.text).toBe("ex:c");
	});

	it("resolves terms against declared and built-in prefixes", () => {
		const prefixes = { [EX]: "ex" };
		expect(resolveTerm("ex:Employee", prefixes)).toBe(EX + "Employee");
		expect(resolveTerm("rdfs:label", prefixes)).toBe("http://www.w3.org/2000/01/rdf-schema#label");
		expect(resolveTerm("<http://x/y>", prefixes)).toBe("http://x/y");
		expect(resolveTerm("nope:x", prefixes)).toBeNull();
	});
});

describe("normaliseGraphSettings", () => {
	it("fills missing fields with defaults and drops invalid values", () => {
		const settings = normaliseGraphSettings({
			hiddenNamespaces: ["http://x/", 3 as unknown as string],
			duplicateExternalNodes: "yes" as unknown as boolean
		});
		expect(settings.hiddenNamespaces).toEqual(["http://x/"]);
		expect(settings.duplicateExternalNodes).toBe(false);
		expect(settings.nodeNamePredicate).toBe(defaultGraphSettings().nodeNamePredicate);
	});
});
