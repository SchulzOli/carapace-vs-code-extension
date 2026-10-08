import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as oniguruma from "vscode-oniguruma";
import * as textmate from "vscode-textmate";

const root = join(__dirname, "../..");
let grammar: textmate.IGrammar;

beforeAll(async () => {
	const wasm = readFileSync(join(root, "node_modules/vscode-oniguruma/release/onig.wasm"));
	await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
	const registry = new textmate.Registry({
		onigLib: Promise.resolve({
			createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
			createOnigString: (s: string) => new oniguruma.OnigString(s)
		}),
		loadGrammar: async () =>
			textmate.parseRawGrammar(readFileSync(join(root, "syntaxes/turtle.tmLanguage.json"), "utf8"), "turtle.json")
	});
	grammar = (await registry.loadGrammar("source.turtle"))!;
});

/** Returns [text, innermost scope] pairs for each token of each line. */
function tokenize(text: string): Array<[string, string]> {
	let state = textmate.INITIAL;
	const result: Array<[string, string]> = [];
	for (const line of text.split("\n")) {
		const { tokens, ruleStack } = grammar.tokenizeLine(line, state);
		state = ruleStack;
		for (const token of tokens) {
			const value = line.slice(token.startIndex, token.endIndex);
			if (value.trim()) result.push([value.trim(), token.scopes[token.scopes.length - 1]]);
		}
	}
	return result;
}

function scopeOf(tokens: Array<[string, string]>, text: string): string | undefined {
	return tokens.find(([value]) => value === text)?.[1];
}

describe("turtle grammar", () => {
	it("highlights directives, prefixes and IRIs", () => {
		const tokens = tokenize("@prefix ex: <http://example.org/> .\nPREFIX owl: <http://www.w3.org/2002/07/owl#>");
		expect(scopeOf(tokens, "@prefix")).toBe("keyword.other.directive.turtle");
		expect(scopeOf(tokens, "PREFIX")).toBe("keyword.other.directive.turtle");
		expect(scopeOf(tokens, "ex")).toBe("entity.name.namespace.turtle");
		expect(scopeOf(tokens, "http://example.org/")).toBe("string.other.iri.turtle");
	});

	it("highlights triples", () => {
		const tokens = tokenize(
			'ex:Alice a owl:NamedIndividual ;\n  ex:age 42 ;\n  ex:name "Bob"@en , """multi\nline"""^^xsd:string ;\n  ex:ok true ;\n  ex:knows [ ex:id _:b1 ] . # done'
		);
		expect(scopeOf(tokens, "Alice")).toBe("entity.name.tag.local.turtle");
		expect(scopeOf(tokens, "a")).toBe("keyword.other.type.turtle");
		expect(scopeOf(tokens, "42")).toBe("constant.numeric.turtle");
		expect(scopeOf(tokens, "Bob")).toBe("string.quoted.double.turtle");
		expect(scopeOf(tokens, "en")).toBe("constant.language.language-tag.turtle");
		expect(scopeOf(tokens, "line")).toBe("string.quoted.triple.double.turtle");
		expect(scopeOf(tokens, "^^")).toBe("keyword.operator.datatype.turtle");
		expect(scopeOf(tokens, "true")).toBe("constant.language.boolean.turtle");
		expect(scopeOf(tokens, "b1")).toBe("variable.other.blank-node.turtle");
		expect(scopeOf(tokens, "done")).toBe("comment.line.number-sign.turtle");
		expect(scopeOf(tokens, ";")).toBe("punctuation.separator.predicate.turtle");
	});

	it("does not treat 'a' inside names as the type keyword", () => {
		const tokens = tokenize("ex:a ex:hasA ex:b .");
		expect(tokens.filter(([, scope]) => scope === "keyword.other.type.turtle")).toHaveLength(0);
	});
});
