import { describe, expect, it } from "vitest";

import { analyseTurtle } from "../../src/core/analyse";
import { rdfXmlToTurtle } from "../../src/extension/rdfxml";

const RDF_XML = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
         xmlns:owl="http://www.w3.org/2002/07/owl#"
         xmlns:ex="http://example.org/zoo#">
  <owl:Class rdf:about="http://example.org/zoo#Animal">
    <rdfs:label>Animal</rdfs:label>
  </owl:Class>
  <owl:Class rdf:about="http://example.org/zoo#Turtle">
    <rdfs:subClassOf rdf:resource="http://example.org/zoo#Animal"/>
  </owl:Class>
</rdf:RDF>`;

describe("rdfXmlToTurtle", () => {
	it("converts RDF/XML to Turtle that keeps the document's prefixes", async () => {
		const turtle = await rdfXmlToTurtle(RDF_XML, "http://example.org/zoo");
		expect(turtle).toContain("@prefix ex: <http://example.org/zoo#>");
		expect(turtle).toMatch(/ex:Turtle/);

		const analysis = analyseTurtle(turtle);
		expect(analysis.error).toBeNull();
		expect(analysis.triples).toHaveLength(4);
	});

	it("rejects malformed XML", async () => {
		await expect(rdfXmlToTurtle("not xml at all <<<", "http://x/")).rejects.toThrow();
	});
});
