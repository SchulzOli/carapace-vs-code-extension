import * as vscode from "vscode";

import type { TurtleAnalysis } from "../core/analyse";
import { ENTITY_TYPE_DISPLAY } from "../core/entity";
import { classifyUriType } from "../core/ontology";
import type { OutlineEntry } from "../core/outline";
import { buildOutline, shortenUri } from "../core/outline";
import { resolveTerm, termAt } from "../core/terms";
import type { EntityType } from "../core/types";
import type { AnalysisCache } from "./analysisCache";
import { readDefaultGraphSettings } from "./config";
import { TURTLE_LANGUAGE_ID } from "./documents";

const SYMBOL_KINDS: Record<EntityType, vscode.SymbolKind> = {
	class: vscode.SymbolKind.Class,
	datatype: vscode.SymbolKind.TypeParameter,
	objectProperty: vscode.SymbolKind.Property,
	dataProperty: vscode.SymbolKind.Field,
	annotationProperty: vscode.SymbolKind.Key,
	instance: vscode.SymbolKind.Object,
	literal: vscode.SymbolKind.String,
	blank: vscode.SymbolKind.Variable,
	list: vscode.SymbolKind.Array,
	tripleTerm: vscode.SymbolKind.Struct
};

const TYPE_LABELS = new Map<EntityType, string>(ENTITY_TYPE_DISPLAY.map(({ type, label }) => [type, label]));

/** Outline, go-to-definition and hover for Turtle documents, built on the Carapace engine. */
export class TurtleLanguageFeatures
	implements vscode.DocumentSymbolProvider, vscode.DefinitionProvider, vscode.HoverProvider
{
	private outlines = new WeakMap<TurtleAnalysis, Map<string, OutlineEntry>>();

	constructor(private readonly cache: AnalysisCache) {}

	register(): vscode.Disposable {
		const selector: vscode.DocumentSelector = [{ language: TURTLE_LANGUAGE_ID }, { pattern: "**/*.ttl" }];
		return vscode.Disposable.from(
			vscode.languages.registerDocumentSymbolProvider(selector, this, { label: "Carapace" }),
			vscode.languages.registerDefinitionProvider(selector, this),
			vscode.languages.registerHoverProvider(selector, this)
		);
	}

	private outline(document: vscode.TextDocument): { analysis: TurtleAnalysis; entries: Map<string, OutlineEntry> } {
		const analysis = this.cache.get(document);
		let entries = this.outlines.get(analysis);
		if (!entries) {
			const outline = buildOutline(analysis, readDefaultGraphSettings(document.uri));
			entries = new Map(outline.map((entry) => [entry.uri, entry]));
			this.outlines.set(analysis, entries);
		}
		return { analysis, entries };
	}

	provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
		const { entries } = this.outline(document);
		return [...entries.values()].map((entry) => {
			const start = Math.min(entry.startLine - 1, document.lineCount - 1);
			const end = Math.min(entry.endLine - 1, document.lineCount - 1);
			const range = new vscode.Range(start, 0, end, document.lineAt(end).range.end.character);
			const startLine = document.lineAt(start);
			const selection = new vscode.Range(
				start,
				startLine.firstNonWhitespaceCharacterIndex,
				start,
				startLine.range.end.character
			);
			const detail = entry.label ? `${entry.typeLabel} · ${entry.label}` : entry.typeLabel;
			return new vscode.DocumentSymbol(entry.name, detail, SYMBOL_KINDS[entry.nodeType], range, selection);
		});
	}

	private iriAt(document: vscode.TextDocument, position: vscode.Position) {
		const term = termAt(document.lineAt(position.line).text, position.character);
		if (!term) return null;
		const { analysis, entries } = this.outline(document);
		const iri = resolveTerm(term.text, analysis.prefixMap);
		if (!iri) return null;
		return {
			iri,
			analysis,
			entry: entries.get(iri),
			range: new vscode.Range(position.line, term.start, position.line, term.end)
		};
	}

	provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location | undefined {
		const found = this.iriAt(document, position);
		const line = found ? found.analysis.lineMapping.uriToLine.get(found.iri) : undefined;
		if (line == null || line - 1 >= document.lineCount) return undefined;
		const textLine = document.lineAt(line - 1);
		return new vscode.Location(
			document.uri,
			new vscode.Position(line - 1, textLine.firstNonWhitespaceCharacterIndex)
		);
	}

	provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const found = this.iriAt(document, position);
		if (!found) return undefined;

		const { iri, entry, analysis } = found;
		const type = entry?.nodeType ?? classifyUriType(iri);
		const md = new vscode.MarkdownString();
		md.appendMarkdown(`**${escapeMarkdown(shortenUri(iri, analysis.prefixMap))}**`);
		if (type) md.appendMarkdown(` — ${TYPE_LABELS.get(type) ?? type}${entry ? "" : " (external)"}`);
		md.appendMarkdown("\n\n");
		md.appendCodeblock(iri, "text");
		if (entry?.label) md.appendMarkdown(`\n${escapeMarkdown(entry.label)}`);
		if (entry) md.appendMarkdown(`\n\nDefined on line ${entry.startLine}`);
		return new vscode.Hover(md, found.range);
	}
}

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
