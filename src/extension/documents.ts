import type * as vscode from "vscode";

export const TURTLE_LANGUAGE_ID = "turtle";

export function isTurtleDocument(document: vscode.TextDocument): boolean {
	return document.languageId === TURTLE_LANGUAGE_ID || document.uri.path.toLowerCase().endsWith(".ttl");
}

export function displayName(uri: vscode.Uri): string {
	const segments = uri.path.split("/");
	return segments[segments.length - 1] || uri.toString();
}
