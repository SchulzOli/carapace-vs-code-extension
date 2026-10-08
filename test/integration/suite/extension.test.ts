import * as assert from "node:assert";
import * as vscode from "vscode";

type GraphStatus = {
	initialised: boolean;
	nodes: number;
	edges: number;
	loading: boolean;
	locked: boolean;
	error: string | null;
	selectedUris: string[];
};

const EX = "http://example.org/test#";
const fixtures = () => vscode.workspace.workspaceFolders![0].uri;
const fixture = (name: string) => vscode.Uri.joinPath(fixtures(), name);

async function waitFor<T>(
	probe: () => T | PromiseLike<T>,
	accept: (value: T) => boolean,
	what: string,
	timeout = 20_000
): Promise<T> {
	const deadline = Date.now() + timeout;
	let last: T = await probe();
	while (!accept(last)) {
		if (Date.now() > deadline) assert.fail(`Timed out waiting for ${what}; last value: ${JSON.stringify(last)}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
		last = await probe();
	}
	return last;
}

const graphStatus = (uri: vscode.Uri) =>
	vscode.commands.executeCommand<GraphStatus | null>("carapace._graphStatus", uri.toString());

async function openFixture(name: string) {
	const document = await vscode.workspace.openTextDocument(fixture(name));
	const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
	return { document, editor };
}

function lineOf(document: vscode.TextDocument, needle: string): number {
	for (let i = 0; i < document.lineCount; i++) if (document.lineAt(i).text.includes(needle)) return i;
	throw new Error(`"${needle}" not found`);
}

describe("Carapace extension", () => {
	afterEach(async () => {
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
	});

	it("registers .ttl files as Turtle and activates", async () => {
		const { document } = await openFixture("sample.ttl");
		assert.strictEqual(document.languageId, "turtle");

		const extension = vscode.extensions.all.find((e) => e.packageJSON.name === "carapace-vscode");
		assert.ok(extension, "extension is installed");
		await waitFor(() => extension.isActive, Boolean, "activation");

		const commands = await vscode.commands.getCommands(true);
		for (const command of [
			"carapace.showGraph",
			"carapace.showGraphToSide",
			"carapace.exportSvg",
			"carapace.convertRdfXml"
		]) {
			assert.ok(commands.includes(command), `${command} is registered`);
		}
	});

	it("reports syntax errors as diagnostics", async () => {
		const { document } = await openFixture("broken.ttl");
		const diagnostics = await waitFor(
			() => vscode.languages.getDiagnostics(document.uri),
			(d) => d.length > 0,
			"diagnostics"
		);
		assert.strictEqual(diagnostics.length, 1);
		assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
		assert.strictEqual(diagnostics[0].source, "carapace");
		assert.strictEqual(diagnostics[0].range.start.line, lineOf(document, "ex:Other ex:relatesTo"));

		const clean = await openFixture("sample.ttl");
		await new Promise((resolve) => setTimeout(resolve, 500));
		assert.deepStrictEqual(vscode.languages.getDiagnostics(clean.document.uri), []);
	});

	it("provides an outline of the ontology", async () => {
		const { document } = await openFixture("sample.ttl");
		const symbols = await waitFor(
			() =>
				vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
					"vscode.executeDocumentSymbolProvider",
					document.uri
				),
			(s) => Array.isArray(s) && s.length > 0,
			"document symbols"
		);
		const worksIn = symbols.find((s) => s.name === "ex:worksIn");
		assert.ok(worksIn, "ex:worksIn is listed");
		assert.strictEqual(worksIn.kind, vscode.SymbolKind.Property);
		assert.match(worksIn.detail, /Object Property/);
		assert.strictEqual(worksIn.range.start.line, lineOf(document, "ex:worksIn rdf:type"));
		assert.strictEqual(symbols.find((s) => s.name === "ex:Employee")?.kind, vscode.SymbolKind.Class);
	});

	it("jumps to definitions and shows hovers for prefixed names", async () => {
		const { document } = await openFixture("sample.ttl");
		const usageLine = lineOf(document, "rdfs:range ex:Department");
		const position = new vscode.Position(usageLine, document.lineAt(usageLine).text.indexOf("ex:Department") + 4);

		const locations = await vscode.commands.executeCommand<vscode.Location[]>(
			"vscode.executeDefinitionProvider",
			document.uri,
			position
		);
		assert.strictEqual(locations.length, 1);
		assert.strictEqual(locations[0].range.start.line, lineOf(document, "ex:Department rdf:type"));

		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			"vscode.executeHoverProvider",
			document.uri,
			position
		);
		const text = hovers.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).join("\n");
		assert.match(text, /http:\/\/example\.org\/test#Department/);
		assert.match(text, /Class/);
	});

	it("opens a live graph next to the editor", async () => {
		const { document, editor } = await openFixture("sample.ttl");
		await vscode.commands.executeCommand("carapace.showGraphToSide");

		const initial = await waitFor(
			() => graphStatus(document.uri),
			(s) => !!s && !s.loading && s.nodes > 0,
			"graph"
		);
		assert.strictEqual(initial!.error, null);
		assert.strictEqual(initial!.nodes, 10);

		await editor.edit((edit) =>
			edit.insert(
				new vscode.Position(document.lineCount, 0),
				"\nex:Manager rdf:type owl:Class ;\n    rdfs:subClassOf ex:Employee .\n"
			)
		);
		await waitFor(
			() => graphStatus(document.uri),
			(s) => !!s && s.nodes === initial!.nodes + 1,
			"graph update"
		);

		await editor.edit((edit) => edit.insert(new vscode.Position(document.lineCount, 0), "ex:Broken ex:p ;"));
		const broken = await waitFor(
			() => graphStatus(document.uri),
			(s) => !!s?.error,
			"parse error"
		);
		assert.strictEqual(broken!.nodes, initial!.nodes + 1, "the last valid graph stays visible");

		await vscode.commands.executeCommand("workbench.action.files.revert");
	});

	it("reveals the node at the cursor", async () => {
		const { document, editor } = await openFixture("sample.ttl");
		await vscode.commands.executeCommand("carapace.showGraphToSide");
		await waitFor(
			() => graphStatus(document.uri),
			(s) => !!s && !s.loading && s.nodes > 0,
			"graph"
		);

		await vscode.window.showTextDocument(document, editor.viewColumn);
		const line = lineOf(document, "rdfs:range ex:Department");
		editor.selection = new vscode.Selection(line, 4, line, 4);
		await vscode.commands.executeCommand("carapace.revealNodeAtCursor");

		await waitFor(
			() => graphStatus(document.uri),
			(s) => !!s && s.selectedUris.length === 1 && s.selectedUris[0] === EX + "worksIn",
			"selected node"
		);
	});

	it("toggles the layout lock from the command palette", async () => {
		const { document } = await openFixture("sample.ttl");
		await vscode.commands.executeCommand("carapace.showGraphToSide");
		await waitFor(
			() => graphStatus(document.uri),
			(s) => !!s && !s.loading && s.nodes > 0,
			"graph"
		);

		await vscode.commands.executeCommand("carapace.toggleLock");
		await waitFor(
			() => graphStatus(document.uri),
			(s) => !!s?.locked,
			"locked"
		);
		await vscode.commands.executeCommand("carapace.toggleLock");
		await waitFor(
			() => graphStatus(document.uri),
			(s) => s?.locked === false,
			"unlocked"
		);
	});

	it("creates a sample ontology with its graph", async () => {
		await vscode.commands.executeCommand("carapace.newSampleOntology");
		const editor = await waitFor(
			() =>
				vscode.window.visibleTextEditors.find(
					(e) => e.document.isUntitled && e.document.languageId === "turtle"
				),
			Boolean,
			"sample editor"
		);
		await waitFor(
			() => graphStatus(editor!.document.uri),
			(s) => !!s && !s.loading && s.nodes > 0,
			"sample graph"
		);
	});

	it("converts RDF/XML to Turtle", async () => {
		await vscode.commands.executeCommand("carapace.convertRdfXml", fixture("zoo.rdf"));
		const editor = await waitFor(
			() => vscode.window.activeTextEditor,
			(e) => !!e && e.document.languageId === "turtle",
			"converted document"
		);
		const text = editor!.document.getText();
		assert.match(text, /@prefix zoo: <http:\/\/example\.org\/zoo#>/);
		assert.match(text, /zoo:Turtle/);
		await waitFor(
			() => vscode.languages.getDiagnostics(editor!.document.uri),
			(d) => d.length === 0,
			"no diagnostics"
		);
	});
});
