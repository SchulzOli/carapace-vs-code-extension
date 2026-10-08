import * as vscode from "vscode";

import { SAMPLE_TURTLE } from "../core/sample";
import type { GraphCommand, GraphStatus } from "../shared/protocol";
import { AnalysisCache } from "./analysisCache";
import { TurtleDiagnostics } from "./diagnostics";
import { TURTLE_LANGUAGE_ID, displayName, isTurtleDocument } from "./documents";
import { GraphPanelManager } from "./graphPanel";
import { TurtleLanguageFeatures } from "./languageFeatures";
import { rdfXmlToTurtle } from "./rdfxml";
import { GraphStateStore } from "./stateStore";

/** Resolves the Turtle document a command applies to: explicit argument, active editor, or the focused graph. */
function resolveTargetUri(manager: GraphPanelManager, arg?: unknown): vscode.Uri | undefined {
	if (arg instanceof vscode.Uri) return arg;
	const editor = vscode.window.activeTextEditor;
	if (editor && isTurtleDocument(editor.document)) return editor.document.uri;
	return manager.target()?.documentUri;
}

export function activate(context: vscode.ExtensionContext) {
	const store = new GraphStateStore(context.workspaceState);
	const manager = new GraphPanelManager(context.extensionUri, store);
	const cache = new AnalysisCache();
	const features = new TurtleLanguageFeatures(cache);

	const showGraph = (toSide: boolean) => (arg?: unknown) => {
		const uri = resolveTargetUri(manager, arg);
		if (!uri) {
			void vscode.window.showInformationMessage("Carapace: open a Turtle (.ttl) file to show its graph.");
			return;
		}
		const column = toSide
			? vscode.ViewColumn.Beside
			: (vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active);
		manager.show(uri, column, toSide);
	};

	const forwardToGraph = (command: GraphCommand) => () => {
		const panel = manager.target();
		if (!panel) {
			void vscode.window.showInformationMessage("Carapace: no graph is open.");
			return;
		}
		// commands that move keyboard focus into the graph need the panel to be focused
		if (command === "find" || command === "toggleSettings") panel.reveal(undefined, false);
		panel.runCommand(command);
	};

	context.subscriptions.push(
		manager,
		new TurtleDiagnostics(cache),
		features.register(),

		vscode.commands.registerCommand("carapace.showGraph", showGraph(false)),
		vscode.commands.registerCommand("carapace.showGraphToSide", showGraph(true)),
		vscode.commands.registerCommand("carapace.fitView", forwardToGraph("fit")),
		vscode.commands.registerCommand("carapace.relayout", forwardToGraph("relayout")),
		vscode.commands.registerCommand("carapace.toggleLock", forwardToGraph("toggleLock")),
		vscode.commands.registerCommand("carapace.find", forwardToGraph("find")),
		vscode.commands.registerCommand("carapace.toggleSettings", forwardToGraph("toggleSettings")),
		vscode.commands.registerCommand("carapace.exportSvg", forwardToGraph("exportSvg")),
		vscode.commands.registerCommand("carapace.exportPng", forwardToGraph("exportPng")),
		vscode.commands.registerCommand("carapace.resetGraphSettings", forwardToGraph("resetSettings")),
		vscode.commands.registerCommand("carapace.clearSavedLayout", async () => {
			const panel = manager.target();
			if (!panel) return;
			await store.delete(panel.documentUri);
			panel.runCommand("clearLayout");
		}),

		vscode.commands.registerCommand("carapace.revealNodeAtCursor", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !isTurtleDocument(editor.document)) return;
			const panel = manager.show(editor.document.uri, vscode.ViewColumn.Beside, true);
			// a freshly opened panel needs a moment to parse and lay out before it can answer
			for (let attempt = 0; attempt < 40; attempt++) {
				if (panel.status?.initialised && !panel.status.loading) break;
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			const found = await panel.revealLine(editor.selection.active.line);
			if (!found) {
				void vscode.window.showInformationMessage(
					"Carapace: no visible node is defined on this line (it may be hidden by the graph settings)."
				);
			}
		}),

		vscode.commands.registerCommand("carapace.newSampleOntology", async () => {
			const document = await vscode.workspace.openTextDocument({
				language: TURTLE_LANGUAGE_ID,
				content: SAMPLE_TURTLE
			});
			await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
			manager.show(document.uri, vscode.ViewColumn.Beside, true);
		}),

		vscode.commands.registerCommand("carapace.convertRdfXml", async (arg?: unknown) => {
			let uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
			if (!uri || !/\.(rdf|owl|xml)$/i.test(uri.path)) {
				const picked = await vscode.window.showOpenDialog({
					canSelectMany: false,
					filters: { "RDF/XML": ["rdf", "owl", "xml"] },
					openLabel: "Convert to Turtle"
				});
				uri = picked?.[0];
			}
			if (!uri) return;

			try {
				const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
				const turtle = await rdfXmlToTurtle(content, uri.toString());
				const document = await vscode.workspace.openTextDocument({
					language: TURTLE_LANGUAGE_ID,
					content: turtle
				});
				await vscode.window.showTextDocument(document);
				void vscode.window.showInformationMessage(
					`Carapace: converted ${displayName(uri)} to Turtle. Save it as a .ttl file to keep it.`
				);
			} catch (error) {
				void vscode.window.showErrorMessage(
					`Carapace: could not convert ${displayName(uri)}: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}),

		// Internal: lets integration tests and other extensions inspect a graph's state.
		vscode.commands.registerCommand("carapace._graphStatus", (arg?: unknown): GraphStatus | null => {
			const uri = typeof arg === "string" ? vscode.Uri.parse(arg) : arg instanceof vscode.Uri ? arg : undefined;
			const panel = uri ? manager.get(uri) : manager.target();
			return panel?.status ?? null;
		})
	);
}

export function deactivate() {
	// everything is disposed through context.subscriptions
}
