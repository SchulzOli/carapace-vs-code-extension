import * as vscode from "vscode";

import type { TurtleError } from "../core/analyse";
import type { AnalysisCache } from "./analysisCache";
import { diagnosticsEnabled } from "./config";
import { isTurtleDocument } from "./documents";

const DELAY = 250;

/** Turns an N3 parser error into a diagnostic spanning the offending line. */
export function toDiagnostic(error: TurtleError, document: vscode.TextDocument): vscode.Diagnostic {
	const message = error.message.replace(/\s+on line \d+\.?$/, "").trim() || error.message;
	const line = error.line != null ? Math.min(Math.max(error.line - 1, 0), document.lineCount - 1) : 0;
	const textLine = document.lineAt(line);
	const range = new vscode.Range(
		line,
		textLine.firstNonWhitespaceCharacterIndex,
		line,
		Math.max(textLine.range.end.character, textLine.firstNonWhitespaceCharacterIndex + 1)
	);
	const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
	diagnostic.source = "carapace";
	return diagnostic;
}

/** Reports Turtle syntax errors of open documents in the Problems panel. */
export class TurtleDiagnostics implements vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection("carapace");
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly disposables: vscode.Disposable[] = [this.collection];

	constructor(private readonly cache: AnalysisCache) {
		this.disposables.push(
			vscode.workspace.onDidOpenTextDocument((doc) => this.validate(doc)),
			vscode.workspace.onDidChangeTextDocument((event) => this.schedule(event.document)),
			vscode.workspace.onDidCloseTextDocument((doc) => {
				this.clearTimer(doc.uri);
				this.collection.delete(doc.uri);
				this.cache.delete(doc.uri);
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("carapace.diagnostics")) this.validateAll();
			})
		);
		this.validateAll();
	}

	validateAll() {
		for (const doc of vscode.workspace.textDocuments) this.validate(doc);
	}

	validate(document: vscode.TextDocument) {
		if (!isTurtleDocument(document)) return;
		if (!diagnosticsEnabled(document.uri)) {
			this.collection.delete(document.uri);
			return;
		}
		const { error } = this.cache.get(document);
		this.collection.set(document.uri, error ? [toDiagnostic(error, document)] : []);
	}

	private schedule(document: vscode.TextDocument) {
		if (!isTurtleDocument(document)) return;
		this.clearTimer(document.uri);
		this.timers.set(
			document.uri.toString(),
			setTimeout(() => {
				this.timers.delete(document.uri.toString());
				this.validate(document);
			}, DELAY)
		);
	}

	private clearTimer(uri: vscode.Uri) {
		const timer = this.timers.get(uri.toString());
		if (timer) clearTimeout(timer);
		this.timers.delete(uri.toString());
	}

	dispose() {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		vscode.Disposable.from(...this.disposables).dispose();
	}
}
