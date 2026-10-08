import * as vscode from "vscode";

import { BUILTIN_PREFIX_TO_NS } from "../core/namespaces";
import type { GraphSettings } from "../core/settings";
import { normaliseGraphSettings } from "../core/settings";
import type { FollowCursorMode, ViewConfig } from "../shared/protocol";

const SECTION = "terrapin";

/** Expands `rdfs:label`-style names using the built-in prefixes, so settings can be written either way. */
export function expandBuiltinPrefix(value: string): string {
	const colon = value.indexOf(":");
	if (colon <= 0) return value;
	const ns = BUILTIN_PREFIX_TO_NS[value.slice(0, colon)];
	return ns && !value.slice(colon + 1).startsWith("//") ? ns + value.slice(colon + 1) : value;
}

export function readViewConfig(scope?: vscode.ConfigurationScope): ViewConfig {
	const config = vscode.workspace.getConfiguration(SECTION, scope);
	const followCursor = config.get<FollowCursorMode>("preview.followCursor", "highlight");
	return {
		followCursor: ["off", "highlight", "center"].includes(followCursor) ? followCursor : "highlight",
		revealLineOnNodeClick: config.get<boolean>("preview.revealLineOnNodeClick", true),
		exportTheme: config.get<string>("export.theme", "light") === "current" ? "current" : "light"
	};
}

export function readDefaultGraphSettings(scope?: vscode.ConfigurationScope): GraphSettings {
	const config = vscode.workspace.getConfiguration(SECTION, scope);
	const expand = (values: string[] | undefined) => values?.map((v) => expandBuiltinPrefix(v.trim())).filter(Boolean);
	return normaliseGraphSettings({
		duplicateExternalNodes: config.get<boolean>("graph.duplicateExternalNodes"),
		hiddenEntityTypes: config.get<GraphSettings["hiddenEntityTypes"]>("graph.hiddenEntityTypes"),
		hiddenNamespaces: expand(config.get<string[]>("graph.hiddenNamespaces")),
		hiddenPredicateUris: expand(config.get<string[]>("graph.hiddenPredicates")),
		hiddenInstanceOfUris: expand(config.get<string[]>("graph.hiddenInstanceOf")),
		nodeNamePredicate: expandBuiltinPrefix(config.get<string>("graph.nodeNamePredicate", "").trim())
	});
}

export function readUpdateDelay(scope?: vscode.ConfigurationScope): number {
	const delay = vscode.workspace.getConfiguration(SECTION, scope).get<number>("preview.updateDelay", 300);
	return Math.max(0, Number.isFinite(delay) ? delay : 300);
}

export function diagnosticsEnabled(scope?: vscode.ConfigurationScope): boolean {
	return vscode.workspace.getConfiguration(SECTION, scope).get<boolean>("diagnostics.enabled", true);
}
