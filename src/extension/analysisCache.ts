import type * as vscode from "vscode";

import { analyseTurtle } from "../core/analyse";
import type { TurtleAnalysis } from "../core/analyse";

type Entry = { version: number; analysis: TurtleAnalysis };

/** Caches the parse of each open Turtle document per version, shared by all language features. */
export class AnalysisCache {
	private entries = new Map<string, Entry>();

	get(document: vscode.TextDocument): TurtleAnalysis {
		const key = document.uri.toString();
		const cached = this.entries.get(key);
		if (cached && cached.version === document.version) return cached.analysis;

		const analysis = analyseTurtle(document.getText());
		this.entries.set(key, { version: document.version, analysis });
		return analysis;
	}

	delete(uri: vscode.Uri) {
		this.entries.delete(uri.toString());
	}
}
