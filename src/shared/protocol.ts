import type { GraphSettings } from "../core/settings";
import type { EntityType } from "../core/types";

export type NodePosition = { uri: string; x: number; y: number; nodeType?: EntityType };
export type Camera = { x: number; y: number; k: number };

/** Per-document graph state persisted by the extension host (workspace state). */
export type PersistedGraphState = {
	settings: GraphSettings;
	locked: boolean;
	positions: NodePosition[];
	camera: Camera | null;
};

export type FollowCursorMode = "off" | "highlight" | "center";

export type ViewConfig = {
	followCursor: FollowCursorMode;
	revealLineOnNodeClick: boolean;
	exportTheme: "light" | "current";
};

export type GraphCommand =
	| "fit"
	| "zoomIn"
	| "zoomOut"
	| "relayout"
	| "toggleLock"
	| "find"
	| "toggleSettings"
	| "exportSvg"
	| "exportPng"
	| "resetSettings"
	| "clearLayout";

export type HostToWebviewMessage =
	| {
			type: "init";
			documentUri: string;
			fileName: string;
			text: string;
			state: PersistedGraphState | null;
			defaultSettings: GraphSettings;
			config: ViewConfig;
	  }
	| { type: "update"; text: string }
	| { type: "config"; config: ViewConfig; defaultSettings: GraphSettings }
	| { type: "fileName"; fileName: string }
	/** Editor cursor moved; `line` is 1-based. */
	| { type: "cursor"; line: number }
	/** Explicit request to select and centre the node defined on `line` (1-based). */
	| { type: "revealLine"; line: number; requestId: number }
	| { type: "command"; command: GraphCommand };

export type GraphStatus = {
	/** True once the webview received the document (before that, counts are meaningless). */
	initialised: boolean;
	nodes: number;
	edges: number;
	loading: boolean;
	locked: boolean;
	error: string | null;
	selectedUris: string[];
};

/** State kept by VS Code for the webview itself, used to restore panels after a reload. */
export type WebviewSavedState = { documentUri: string };

export type WebviewToHostMessage =
	| { type: "ready" }
	/** Move the editor to `line` (1-based). */
	| { type: "revealSource"; line: number; focusEditor: boolean }
	| { type: "saveState"; state: PersistedGraphState }
	| { type: "export"; format: "svg" | "png"; data: string }
	| { type: "status"; status: GraphStatus }
	| { type: "revealLineResult"; requestId: number; found: boolean }
	| { type: "notify"; level: "info" | "warning" | "error"; message: string };
