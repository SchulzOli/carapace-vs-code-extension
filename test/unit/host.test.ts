import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { SAMPLE_TURTLE } from "../../src/core/sample";
import { expandBuiltinPrefix, readDefaultGraphSettings } from "../../src/extension/config";
import { activate } from "../../src/extension/extension";
import * as vscode from "./vscodeFake";

type SymbolProvider = { provideDocumentSymbols(doc: unknown): vscode.DocumentSymbol[] };
type DefinitionProvider = { provideDefinition(doc: unknown, pos: vscode.Position): vscode.Location | undefined };
type HoverProvider = { provideHover(doc: unknown, pos: vscode.Position): vscode.Hover | undefined };

const manifest = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));
const sample = new vscode.FakeDocument(vscode.Uri.file("/ws/sample.ttl"), SAMPLE_TURTLE);
const broken = new vscode.FakeDocument(
	vscode.Uri.file("/ws/broken.ttl"),
	"@prefix ex: <http://e/> .\nex:a ex:b ex:c .\nex:d ex:e ;\n"
);

function lineOf(doc: vscode.FakeDocument, needle: string) {
	return doc
		.getText()
		.split("\n")
		.findIndex((l) => l.includes(needle));
}

beforeAll(() => {
	vscode.textDocuments.push(sample, broken);
	const memento = new Map<string, unknown>();
	activate({
		subscriptions: [],
		extensionUri: vscode.Uri.file("/ext"),
		workspaceState: {
			get: (k: string) => memento.get(k),
			update: async (k: string, v: unknown) => void memento.set(k, v)
		}
	} as never);
});

describe("activation", () => {
	it("registers every command declared in package.json", () => {
		const declared: string[] = manifest.contributes.commands.map((c: { command: string }) => c.command);
		for (const command of declared) expect(vscode.registeredCommands.has(command), command).toBe(true);
	});

	it("only references declared commands in menus and keybindings", () => {
		const declared = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
		const referenced = [
			...Object.values(manifest.contributes.menus as Record<string, { command: string }[]>).flat(),
			...manifest.contributes.keybindings
		].map((entry) => entry.command);
		for (const command of referenced) expect(declared.has(command), command).toBe(true);
	});

	it("declares every configuration key the extension reads", () => {
		const source = ["config.ts", "diagnostics.ts", "graphPanel.ts"]
			.map((f) => readFileSync(join(__dirname, "../../src/extension", f), "utf8"))
			.join("\n");
		const keys = [...source.matchAll(/get<[^>]+>\("([\w.]+)"/g)].map((m) => `terrapin.${m[1]}`);
		expect(keys.length).toBeGreaterThan(5);
		for (const key of keys) expect(manifest.contributes.configuration.properties, key).toHaveProperty([key]);
	});
});

describe("diagnostics", () => {
	it("flags the offending line of an invalid document and clears valid ones", () => {
		const items = vscode.diagnostics.get(broken.uri.toString())!;
		expect(items).toHaveLength(1);
		expect(items[0].range.start.line).toBe(2);
		expect(items[0].source).toBe("terrapin");
		expect(items[0].message).not.toMatch(/on line/);
		expect(vscode.diagnostics.get(sample.uri.toString())).toEqual([]);
	});
});

describe("language features", () => {
	it("provides document symbols", () => {
		const symbols = (vscode.providers.symbols as SymbolProvider).provideDocumentSymbols(sample);
		const employee = symbols.find((s) => s.name === "ex:Employee")!;
		expect(employee.kind).toBe(vscode.SymbolKind.Class);
		expect(employee.detail).toBe("Class · Employee");
		expect(employee.range.start.line).toBe(lineOf(sample, "ex:Employee rdf:type"));
		expect(symbols.find((s) => s.name === "ex:hasSalary")?.kind).toBe(vscode.SymbolKind.Field);
	});

	it("resolves definitions of prefixed names", () => {
		const line = lineOf(sample, "rdfs:domain ex:Employee");
		const character = sample.lineAt(line).text.indexOf("ex:Employee") + 3;
		const location = (vscode.providers.definition as DefinitionProvider).provideDefinition(
			sample,
			new vscode.Position(line, character)
		);
		expect(location?.range.start.line).toBe(lineOf(sample, "ex:Employee rdf:type"));
	});

	it("explains IRIs on hover, including external ones", () => {
		const provider = vscode.providers.hover as HoverProvider;
		const hover = (doc: unknown, pos: vscode.Position) => provider.provideHover(doc, pos);
		const line = lineOf(sample, "ex:worksIn rdf:type");
		const own = hover(sample, new vscode.Position(line, 4))!;
		expect(own.contents.value).toContain("http://example.org/test#worksIn");
		expect(own.contents.value).toContain("Object Property");
		expect(own.contents.value).toContain("works in");

		const typeColumn = sample.lineAt(line).text.indexOf("owl:ObjectProperty") + 5;
		const external = hover(sample, new vscode.Position(line, typeColumn))!;
		expect(external.contents.value).toContain("http://www.w3.org/2002/07/owl#ObjectProperty");
		expect(external.contents.value).toContain("(external)");
	});
});

describe("configuration", () => {
	it("expands built-in prefixes in graph settings", () => {
		expect(expandBuiltinPrefix("rdfs:label")).toBe("http://www.w3.org/2000/01/rdf-schema#label");
		expect(expandBuiltinPrefix("http://x/y")).toBe("http://x/y");
		expect(expandBuiltinPrefix("unknown:x")).toBe("unknown:x");

		vscode.configuration["terrapin.graph.hiddenInstanceOf"] = ["owl:Ontology", "owl:Restriction"];
		vscode.configuration["terrapin.graph.nodeNamePredicate"] = "skos:prefLabel";
		const settings = readDefaultGraphSettings();
		expect(settings.hiddenInstanceOfUris).toEqual([
			"http://www.w3.org/2002/07/owl#Ontology",
			"http://www.w3.org/2002/07/owl#Restriction"
		]);
		expect(settings.nodeNamePredicate).toBe("skos:prefLabel");
	});
});
