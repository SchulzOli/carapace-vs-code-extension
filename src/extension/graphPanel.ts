import * as vscode from "vscode";

import type {
	GraphCommand,
	GraphStatus,
	HostToWebviewMessage,
	WebviewSavedState,
	WebviewToHostMessage
} from "../shared/protocol";
import { readDefaultGraphSettings, readUpdateDelay, readViewConfig } from "./config";
import { displayName } from "./documents";
import type { GraphStateStore } from "./stateStore";
import { webviewHtml } from "./webviewHtml";

export const GRAPH_VIEW_TYPE = "terrapin.graph";

/** How long an editor selection we caused ourselves is ignored, to avoid graph -> editor -> graph echoes. */
const ECHO_SUPPRESSION_MS = 600;

/** One graph preview webview, bound to a single Turtle document. */
export class GraphPanel implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private updateTimer: ReturnType<typeof setTimeout> | null = null;
	private ready = false;
	private lastSentText: string | null = null;
	private suppressCursor: { line: number; until: number } | null = null;
	private nextRequestId = 1;
	private readonly pendingReveals = new Map<number, (found: boolean) => void>();
	private disposed = false;

	status: GraphStatus | null = null;

	constructor(
		readonly panel: vscode.WebviewPanel,
		private uri: vscode.Uri,
		extensionUri: vscode.Uri,
		private readonly store: GraphStateStore,
		private readonly onDidDispose: (panel: GraphPanel) => void,
		private readonly onDidChangeStatus: (panel: GraphPanel) => void
	) {
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")]
		};
		this.updateTitle();
		panel.iconPath = {
			light: vscode.Uri.joinPath(extensionUri, "media", "graph-light.svg"),
			dark: vscode.Uri.joinPath(extensionUri, "media", "graph-dark.svg")
		};
		panel.webview.html = webviewHtml(panel.webview, extensionUri, panel.title);

		this.disposables.push(
			panel.onDidDispose(() => this.dispose()),
			panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => this.handleMessage(message)),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === this.uri.toString()) this.scheduleUpdate(event.document);
			}),
			vscode.workspace.onDidOpenTextDocument((document) => {
				if (document.uri.toString() === this.uri.toString()) this.scheduleUpdate(document, 0);
			}),
			vscode.window.onDidChangeTextEditorSelection((event) => this.onSelectionChanged(event)),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("terrapin")) {
					this.post({
						type: "config",
						config: readViewConfig(this.uri),
						defaultSettings: readDefaultGraphSettings(this.uri)
					});
				}
			})
		);
	}

	get documentUri(): vscode.Uri {
		return this.uri;
	}

	get isDisposed(): boolean {
		return this.disposed;
	}

	reveal(viewColumn?: vscode.ViewColumn, preserveFocus = false) {
		this.panel.reveal(viewColumn, preserveFocus);
	}

	rename(uri: vscode.Uri) {
		this.uri = uri;
		this.updateTitle();
		this.post({ type: "fileName", fileName: displayName(uri) });
	}

	runCommand(command: GraphCommand) {
		this.post({ type: "command", command });
	}

	/** Asks the graph to select and centre the node defined on `line` (0-based). */
	revealLine(line: number): Promise<boolean> {
		if (!this.ready) return Promise.resolve(false);
		const requestId = this.nextRequestId++;
		return new Promise((resolve) => {
			this.pendingReveals.set(requestId, resolve);
			this.post({ type: "revealLine", line: line + 1, requestId });
			setTimeout(() => {
				if (this.pendingReveals.delete(requestId)) resolve(false);
			}, 5000);
		});
	}

	private updateTitle() {
		this.panel.title = `Graph: ${displayName(this.uri)}`;
	}

	private post(message: HostToWebviewMessage) {
		if (this.disposed || (!this.ready && message.type !== "init")) return;
		void this.panel.webview.postMessage(message);
	}

	private findDocument(): vscode.TextDocument | undefined {
		return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === this.uri.toString());
	}

	private async loadDocument(): Promise<vscode.TextDocument | undefined> {
		try {
			return this.findDocument() ?? (await vscode.workspace.openTextDocument(this.uri));
		} catch {
			return undefined;
		}
	}

	private async sendInit() {
		const document = await this.loadDocument();
		const text = document?.getText() ?? "";
		this.lastSentText = text;
		this.post({
			type: "init",
			documentUri: this.uri.toString(),
			fileName: displayName(this.uri),
			text,
			state: this.store.get(this.uri),
			defaultSettings: readDefaultGraphSettings(this.uri),
			config: readViewConfig(this.uri)
		});
		if (!document) {
			void vscode.window.showWarningMessage(`Terrapin: could not open ${displayName(this.uri)}.`);
		}
	}

	private scheduleUpdate(document: vscode.TextDocument, delay = readUpdateDelay(this.uri)) {
		if (this.updateTimer) clearTimeout(this.updateTimer);
		this.updateTimer = setTimeout(() => {
			this.updateTimer = null;
			const text = document.getText();
			if (text === this.lastSentText) return;
			this.lastSentText = text;
			this.post({ type: "update", text });
		}, delay);
	}

	private onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent) {
		if (event.textEditor.document.uri.toString() !== this.uri.toString()) return;
		if (readViewConfig(this.uri).followCursor === "off") return;
		const line = event.selections[0]?.active.line;
		if (line == null) return;

		if (this.suppressCursor && Date.now() < this.suppressCursor.until && this.suppressCursor.line === line) return;
		this.suppressCursor = null;
		this.post({ type: "cursor", line: line + 1 });
	}

	private async revealSource(line: number, focusEditor: boolean) {
		const document = await this.loadDocument();
		if (!document) return;
		const zeroBased = Math.min(Math.max(line - 1, 0), document.lineCount - 1);
		const character = document.lineAt(zeroBased).firstNonWhitespaceCharacterIndex;
		const selection = new vscode.Selection(zeroBased, character, zeroBased, character);
		this.suppressCursor = { line: zeroBased, until: Date.now() + ECHO_SUPPRESSION_MS };

		const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === this.uri.toString());
		if (visible && !focusEditor) {
			visible.selection = selection;
			visible.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			return;
		}

		const viewColumn =
			visible?.viewColumn ??
			(this.panel.viewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Beside : vscode.ViewColumn.One);
		const editor = await vscode.window.showTextDocument(document, {
			viewColumn,
			preserveFocus: !focusEditor,
			selection
		});
		editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}

	private async exportGraph(format: "svg" | "png", data: string) {
		const baseName = displayName(this.uri).replace(/\.[^.]+$/, "") || "graph";
		const folder =
			this.uri.scheme === "file"
				? vscode.Uri.joinPath(this.uri, "..")
				: vscode.workspace.workspaceFolders?.[0]?.uri;
		const defaultUri = folder ? vscode.Uri.joinPath(folder, `${baseName}.${format}`) : undefined;
		const target = await vscode.window.showSaveDialog({
			defaultUri,
			filters: format === "svg" ? { "SVG image": ["svg"] } : { "PNG image": ["png"] },
			saveLabel: `Export ${format.toUpperCase()}`
		});
		if (!target) return;

		const bytes = format === "svg" ? new TextEncoder().encode(data) : Buffer.from(data, "base64");
		await vscode.workspace.fs.writeFile(target, bytes);
		const open = await vscode.window.showInformationMessage(`Graph exported to ${displayName(target)}.`, "Open");
		if (open) await vscode.commands.executeCommand("vscode.open", target, vscode.ViewColumn.Beside);
	}

	private handleMessage(message: WebviewToHostMessage) {
		switch (message.type) {
			case "ready":
				this.ready = true;
				void this.sendInit();
				break;
			case "revealSource":
				void this.revealSource(message.line, message.focusEditor);
				break;
			case "saveState":
				void this.store.set(this.uri, message.state);
				break;
			case "export":
				void this.exportGraph(message.format, message.data).catch((error: unknown) =>
					vscode.window.showErrorMessage(`Terrapin: export failed: ${String(error)}`)
				);
				break;
			case "status":
				this.status = message.status;
				this.onDidChangeStatus(this);
				break;
			case "revealLineResult": {
				const resolve = this.pendingReveals.get(message.requestId);
				this.pendingReveals.delete(message.requestId);
				resolve?.(message.found);
				break;
			}
			case "notify": {
				const text = `Terrapin: ${message.message}`;
				if (message.level === "error") void vscode.window.showErrorMessage(text);
				else if (message.level === "warning") void vscode.window.showWarningMessage(text);
				else void vscode.window.showInformationMessage(text);
				break;
			}
		}
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		if (this.updateTimer) clearTimeout(this.updateTimer);
		for (const resolve of this.pendingReveals.values()) resolve(false);
		this.pendingReveals.clear();
		this.panel.dispose();
		vscode.Disposable.from(...this.disposables).dispose();
		this.onDidDispose(this);
	}
}

/** Creates, restores and tracks graph panels (one per document). */
export class GraphPanelManager implements vscode.WebviewPanelSerializer<WebviewSavedState>, vscode.Disposable {
	private readonly panels = new Map<string, GraphPanel>();
	private lastActive: GraphPanel | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly statusEmitter = new vscode.EventEmitter<GraphPanel>();
	readonly onDidChangeStatus = this.statusEmitter.event;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly store: GraphStateStore
	) {
		this.disposables.push(
			this.statusEmitter,
			vscode.window.registerWebviewPanelSerializer(GRAPH_VIEW_TYPE, this),
			vscode.workspace.onDidRenameFiles((event) => {
				for (const { oldUri, newUri } of event.files) void this.handleRename(oldUri, newUri);
			})
		);
	}

	/** Opens (or reveals) the graph for `uri`. */
	show(uri: vscode.Uri, viewColumn: vscode.ViewColumn, preserveFocus: boolean): GraphPanel {
		const existing = this.panels.get(uri.toString());
		if (existing) {
			existing.reveal(viewColumn, preserveFocus);
			return existing;
		}
		const panel = vscode.window.createWebviewPanel(
			GRAPH_VIEW_TYPE,
			`Graph: ${uri.path.split("/").pop()}`,
			{ viewColumn, preserveFocus },
			{ enableScripts: true, retainContextWhenHidden: true, enableFindWidget: false }
		);
		return this.track(panel, uri);
	}

	async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: WebviewSavedState | undefined) {
		if (!state?.documentUri) {
			webviewPanel.dispose();
			return;
		}
		const uri = vscode.Uri.parse(state.documentUri);
		if (this.panels.has(uri.toString())) {
			webviewPanel.dispose();
			return;
		}
		this.track(webviewPanel, uri);
	}

	private track(webviewPanel: vscode.WebviewPanel, uri: vscode.Uri): GraphPanel {
		const panel = new GraphPanel(
			webviewPanel,
			uri,
			this.extensionUri,
			this.store,
			(disposed) => {
				if (this.panels.get(disposed.documentUri.toString()) === disposed) {
					this.panels.delete(disposed.documentUri.toString());
				}
				if (this.lastActive === disposed) this.lastActive = undefined;
				this.updateContext();
			},
			(changed) => this.statusEmitter.fire(changed)
		);
		this.panels.set(uri.toString(), panel);
		this.lastActive = panel;
		webviewPanel.onDidChangeViewState(({ webviewPanel: p }) => {
			if (p.active) this.lastActive = panel;
		});
		this.updateContext();
		return panel;
	}

	private async handleRename(oldUri: vscode.Uri, newUri: vscode.Uri) {
		await this.store.move(oldUri, newUri);
		const panel = this.panels.get(oldUri.toString());
		if (!panel) return;
		this.panels.delete(oldUri.toString());
		this.panels.set(newUri.toString(), panel);
		panel.rename(newUri);
	}

	private updateContext() {
		void vscode.commands.executeCommand("setContext", "terrapin.graphOpen", this.panels.size > 0);
	}

	get(uri: vscode.Uri): GraphPanel | undefined {
		return this.panels.get(uri.toString());
	}

	/** The graph panel commands should act on: the focused one, else the one for the active editor, else the last used. */
	target(): GraphPanel | undefined {
		for (const panel of this.panels.values()) if (panel.panel.active) return panel;
		const editorUri = vscode.window.activeTextEditor?.document.uri;
		const forEditor = editorUri ? this.panels.get(editorUri.toString()) : undefined;
		return forEditor ?? this.lastActive ?? this.panels.values().next().value;
	}

	all(): GraphPanel[] {
		return [...this.panels.values()];
	}

	dispose() {
		for (const panel of this.all()) panel.dispose();
		vscode.Disposable.from(...this.disposables).dispose();
	}
}
