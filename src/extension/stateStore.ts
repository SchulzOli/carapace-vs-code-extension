import type * as vscode from "vscode";

import { normaliseGraphSettings } from "../core/settings";
import type { PersistedGraphState } from "../shared/protocol";

const PREFIX = "terrapin.graphState:";

/** Persists per-document graph state (layout, camera, settings, lock) in the workspace state. */
export class GraphStateStore {
	constructor(private readonly memento: vscode.Memento) {}

	get(uri: vscode.Uri): PersistedGraphState | null {
		const value = this.memento.get<PersistedGraphState>(PREFIX + uri.toString());
		if (!value || typeof value !== "object") return null;
		return {
			settings: normaliseGraphSettings(value.settings),
			locked: value.locked === true,
			positions: Array.isArray(value.positions)
				? value.positions.filter(
						(p) => p && typeof p.uri === "string" && Number.isFinite(p.x) && Number.isFinite(p.y)
					)
				: [],
			camera:
				value.camera && [value.camera.x, value.camera.y, value.camera.k].every(Number.isFinite)
					? value.camera
					: null
		};
	}

	async set(uri: vscode.Uri, state: PersistedGraphState): Promise<void> {
		await this.memento.update(PREFIX + uri.toString(), state);
	}

	async delete(uri: vscode.Uri): Promise<void> {
		await this.memento.update(PREFIX + uri.toString(), undefined);
	}

	async move(from: vscode.Uri, to: vscode.Uri): Promise<void> {
		const state = this.memento.get(PREFIX + from.toString());
		if (state === undefined) return;
		await this.memento.update(PREFIX + to.toString(), state);
		await this.memento.update(PREFIX + from.toString(), undefined);
	}
}
