import { OWL_NS, RDFS_NS, RDF_NS } from "./namespaces";
import type { EntityType } from "./types";

export type GraphSettings = {
	duplicateExternalNodes: boolean;
	hiddenNamespaces: string[];
	hiddenEntityTypes: EntityType[];
	hiddenPredicateUris: string[];
	hiddenInstanceOfUris: string[];
	nodeNamePredicate: string;
};

export function defaultGraphSettings(): GraphSettings {
	return {
		duplicateExternalNodes: false,
		hiddenNamespaces: [RDF_NS, RDFS_NS, OWL_NS],
		hiddenEntityTypes: ["blank"],
		hiddenPredicateUris: [],
		hiddenInstanceOfUris: [OWL_NS + "Ontology"],
		nodeNamePredicate: RDFS_NS + "label"
	};
}

export function inHiddenNamespace(uri: string, settings: GraphSettings): boolean {
	for (const ns of settings.hiddenNamespaces) {
		if (uri.startsWith(ns)) return true;
	}
	return false;
}

export function makeSettingsHash(s: GraphSettings): string {
	return JSON.stringify([
		s.hiddenNamespaces,
		s.hiddenEntityTypes,
		s.hiddenPredicateUris,
		s.hiddenInstanceOfUris,
		s.duplicateExternalNodes,
		s.nodeNamePredicate
	]);
}

/** Fills missing or malformed fields (e.g. from persisted state of an older version) with defaults. */
export function normaliseGraphSettings(value: Partial<GraphSettings> | undefined | null): GraphSettings {
	const defaults = defaultGraphSettings();
	if (!value || typeof value !== "object") return defaults;

	const strings = (v: unknown, fallback: string[]) =>
		Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fallback;

	return {
		duplicateExternalNodes:
			typeof value.duplicateExternalNodes === "boolean"
				? value.duplicateExternalNodes
				: defaults.duplicateExternalNodes,
		hiddenNamespaces: strings(value.hiddenNamespaces, defaults.hiddenNamespaces),
		hiddenEntityTypes: strings(value.hiddenEntityTypes, defaults.hiddenEntityTypes) as EntityType[],
		hiddenPredicateUris: strings(value.hiddenPredicateUris, defaults.hiddenPredicateUris),
		hiddenInstanceOfUris: strings(value.hiddenInstanceOfUris, defaults.hiddenInstanceOfUris),
		nodeNamePredicate:
			typeof value.nodeNamePredicate === "string" ? value.nodeNamePredicate : defaults.nodeNamePredicate
	};
}
