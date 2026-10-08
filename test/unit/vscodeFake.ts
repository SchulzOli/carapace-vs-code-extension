/**
 * A minimal in-memory stand-in for the `vscode` module, enough to activate the extension and exercise its
 * language features in plain Node. Real-VS Code behaviour is covered by test/integration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Listener<T> = (event: T) => unknown;

const manifestDefaults: Record<string, unknown> = Object.fromEntries(
	Object.entries(
		JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")).contributes.configuration
			.properties as Record<string, { default?: unknown }>
	).map(([key, schema]) => [key, schema.default])
);

export class Disposable {
	constructor(private readonly fn: () => void = () => {}) {}
	static from(...items: { dispose(): unknown }[]) {
		return new Disposable(() => items.forEach((i) => i.dispose()));
	}
	dispose() {
		this.fn();
	}
}

export class EventEmitter<T> {
	private listeners = new Set<Listener<T>>();
	event = (listener: Listener<T>) => {
		this.listeners.add(listener);
		return new Disposable(() => this.listeners.delete(listener));
	};
	fire(value: T) {
		this.listeners.forEach((l) => l(value));
	}
	dispose() {
		this.listeners.clear();
	}
}

function event<T>() {
	const emitter = new EventEmitter<T>();
	return Object.assign(emitter.event, { fire: (value: T) => emitter.fire(value) });
}

export class Uri {
	private constructor(
		readonly scheme: string,
		readonly path: string
	) {}
	static file(path: string) {
		return new Uri("file", path);
	}
	static parse(value: string) {
		const match = /^(\w+):\/\/(.*)$/.exec(value);
		return match ? new Uri(match[1], match[2]) : new Uri("file", value);
	}
	static joinPath(base: Uri, ...segments: string[]) {
		return new Uri(base.scheme, [base.path, ...segments].join("/"));
	}
	toString() {
		return `${this.scheme}://${this.path}`;
	}
}

export class Position {
	constructor(
		readonly line: number,
		readonly character: number
	) {}
}

export class Range {
	readonly start: Position;
	readonly end: Position;
	constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
		this.start = typeof a === "number" ? new Position(a, b as number) : a;
		this.end = typeof a === "number" ? new Position(c!, d!) : (b as Position);
	}
}

export class Selection extends Range {
	get active() {
		return this.end;
	}
}

export class Location {
	readonly range: Range;
	constructor(
		readonly uri: Uri,
		position: Position | Range
	) {
		this.range = position instanceof Range ? position : new Range(position, position);
	}
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3
}

export class Diagnostic {
	source?: string;
	constructor(
		readonly range: Range,
		readonly message: string,
		readonly severity: DiagnosticSeverity
	) {}
}

export enum SymbolKind {
	Key = 19,
	Field = 7,
	Class = 4,
	Property = 6,
	Variable = 12,
	String = 14,
	Array = 17,
	Struct = 22,
	Object = 18,
	TypeParameter = 25
}

export class DocumentSymbol {
	constructor(
		readonly name: string,
		readonly detail: string,
		readonly kind: SymbolKind,
		readonly range: Range,
		readonly selectionRange: Range
	) {}
}

export class MarkdownString {
	value = "";
	appendMarkdown(text: string) {
		this.value += text;
		return this;
	}
	appendCodeblock(code: string, language = "") {
		this.value += `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
		return this;
	}
}

export class Hover {
	constructor(
		readonly contents: MarkdownString,
		readonly range?: Range
	) {}
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2
}

export enum TextEditorRevealType {
	InCenterIfOutsideViewport = 2
}

export const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
export const providers: Record<string, unknown> = {};
export const diagnostics = new Map<string, Diagnostic[]>();
export const textDocuments: FakeDocument[] = [];
export const configuration: Record<string, unknown> = {};

export const commands = {
	registerCommand(id: string, fn: (...args: unknown[]) => unknown) {
		registeredCommands.set(id, fn);
		return new Disposable(() => registeredCommands.delete(id));
	},
	executeCommand: async (id: string, ...args: unknown[]) => registeredCommands.get(id)?.(...args)
};

export const languages = {
	createDiagnosticCollection: () => ({
		set: (uri: Uri, items: Diagnostic[]) => diagnostics.set(uri.toString(), items),
		delete: (uri: Uri) => diagnostics.delete(uri.toString()),
		dispose: () => diagnostics.clear()
	}),
	registerDocumentSymbolProvider: (_: unknown, provider: unknown) => (
		(providers.symbols = provider),
		new Disposable()
	),
	registerDefinitionProvider: (_: unknown, provider: unknown) => (
		(providers.definition = provider),
		new Disposable()
	),
	registerHoverProvider: (_: unknown, provider: unknown) => ((providers.hover = provider), new Disposable())
};

export const workspace = {
	textDocuments,
	workspaceFolders: undefined,
	onDidOpenTextDocument: event<FakeDocument>(),
	onDidChangeTextDocument: event<{ document: FakeDocument }>(),
	onDidCloseTextDocument: event<FakeDocument>(),
	onDidChangeConfiguration: event<unknown>(),
	onDidRenameFiles: event<unknown>(),
	getConfiguration: (section: string) => ({
		get: <T>(key: string, fallback?: T) =>
			((configuration[`${section}.${key}`] ?? manifestDefaults[`${section}.${key}`]) as T | undefined) ?? fallback
	})
};

export const window = {
	activeTextEditor: undefined,
	visibleTextEditors: [],
	onDidChangeTextEditorSelection: event<unknown>(),
	registerWebviewPanelSerializer: () => new Disposable(),
	showInformationMessage: async () => undefined,
	showWarningMessage: async () => undefined,
	showErrorMessage: async () => undefined
};

export class FakeDocument {
	version = 1;
	languageId = "turtle";
	constructor(
		readonly uri: Uri,
		private text: string
	) {}
	getText() {
		return this.text;
	}
	setText(text: string) {
		this.text = text;
		this.version++;
	}
	get lineCount() {
		return this.text.split("\n").length;
	}
	lineAt(line: number) {
		const text = this.text.split("\n")[line];
		return {
			text,
			range: new Range(line, 0, line, text.length),
			firstNonWhitespaceCharacterIndex: text.length - text.trimStart().length
		};
	}
}
