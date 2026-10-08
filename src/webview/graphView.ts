import { analyseTurtle } from "../core/analyse";
import type { TurtleAnalysis } from "../core/analyse";
import { buildGraph } from "../core/graph";
import type { GraphSettings } from "../core/settings";
import { defaultGraphSettings, makeSettingsHash, normaliseGraphSettings } from "../core/settings";
import type { Edge, GraphSearchResult, Node } from "../core/types";
import {
	CANVAS_HEIGHT,
	CANVAS_WIDTH,
	FIT_PADDING,
	ZOOM_BUTTON_FACTOR,
	ZOOM_FIT_MAX,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_WHEEL_IN_FACTOR,
	ZOOM_WHEEL_OUT_FACTOR
} from "../core/visualisation";
import type {
	GraphCommand,
	GraphStatus,
	HostToWebviewMessage,
	NodePosition,
	PersistedGraphState,
	ViewConfig,
	WebviewToHostMessage
} from "../shared/protocol";
import { debounce, html, iconButton } from "./dom";
import { buildExportSvg, rasterisePng } from "./export";
import { runForceLayout } from "./forceLayout";
import { GraphRenderer } from "./renderer";
import type { Camera } from "./renderer";
import { SearchBar } from "./searchBar";
import { SettingsPanel } from "./settingsPanel";

type Post = (message: WebviewToHostMessage) => void;

const DRAG_THRESHOLD = 3;
/** Saved positions are reused when they cover at least this share of the rebuilt nodes. */
const RESTORE_COVERAGE = 0.5;

/**
 * The graph preview: parses Turtle, builds the Carapace graph, lays it out and handles all interaction.
 * Mirrors Carapace's GraphVisualisation component, with the editor living in VS Code instead of CodeMirror.
 */
export class GraphView {
	private readonly root: HTMLElement;
	private readonly container: HTMLDivElement;
	private readonly renderer: GraphRenderer;
	private readonly loadingEl: HTMLDivElement;
	private readonly emptyEl: HTMLDivElement;
	private readonly statusText: HTMLSpanElement;
	private readonly statusCounts: HTMLSpanElement;
	private readonly lockButton: HTMLButtonElement;
	private readonly selectModeButton: HTMLButtonElement;
	private readonly searchButton: HTMLButtonElement;
	private readonly settingsButton: HTMLButtonElement;
	private readonly searchBar: SearchBar;
	private readonly settingsPanel: SettingsPanel;

	private config: ViewConfig = { followCursor: "highlight", revealLineOnNodeClick: true, exportTheme: "light" };
	private defaultSettings: GraphSettings = defaultGraphSettings();
	private settings: GraphSettings = defaultGraphSettings();
	private locked = false;
	private camera: Camera = { x: 0, y: 0, k: 1 };
	private hasCamera = false;

	private lastGood: TurtleAnalysis | null = null;
	private error: string | null = null;

	private nodes: Node[] = [];
	private edges: Edge[] = [];
	private layoutDone = false;
	private restoredPositions: NodePosition[] | null = null;
	private loading = false;
	private generation = 0;

	private selectedUris = new Set<string>();
	private highlightedEdgeId: string | null = null;
	private boxSelectMode = false;
	private width = CANVAS_WIDTH;
	private height = CANVAS_HEIGHT;
	private initialised = false;

	private readonly saveState = debounce(() => this.persist(), 400);
	private readonly postStatus = debounce(() => this.post({ type: "status", status: this.status() }), 50);

	constructor(
		root: HTMLElement,
		private readonly post: Post
	) {
		this.root = root;
		this.container = html("div", { class: "graph-container", tabindex: "-1" });
		this.renderer = new GraphRenderer(this.container);
		this.loadingEl = html("div", { class: "loading-overlay", hidden: true }, [
			html("span", { class: "spinner", "aria-hidden": "true" }),
			html("span", {}, ["Graph loading…"])
		]);
		this.emptyEl = html("div", { class: "empty-state", hidden: true });

		this.searchBar = new SearchBar(
			() => ({ nodes: this.nodes, edges: this.edges }),
			(result) => this.focusResult(result),
			() => {
				this.highlightedEdgeId = null;
				this.renderer.setHighlightedEdge(null);
				this.searchButton.classList.remove("active");
				this.container.focus({ preventScroll: true });
			}
		);
		this.settingsPanel = new SettingsPanel(
			(patch) => this.updateSettings(patch),
			() => this.updateSettings(this.defaultSettings),
			() => {
				this.settingsButton.classList.remove("active");
				this.container.focus({ preventScroll: true });
			}
		);

		this.searchButton = iconButton("search", "Search nodes and predicates (Ctrl+F)", () => this.toggleSearch());
		this.selectModeButton = iconButton("inspect", "Box select mode", () => this.toggleSelectMode());
		this.lockButton = iconButton("unlock", "Lock layout", () => this.toggleLock());
		this.settingsButton = iconButton("settings-gear", "Graph settings", () => this.toggleSettings());
		const toolbar = html("div", { class: "toolbar", role: "toolbar", "aria-label": "Graph controls" }, [
			this.searchButton,
			this.selectModeButton,
			this.lockButton,
			iconButton("zoom-in", "Zoom in", () => this.zoomBy(ZOOM_BUTTON_FACTOR)),
			iconButton("zoom-out", "Zoom out", () => this.zoomBy(1 / ZOOM_BUTTON_FACTOR)),
			iconButton("screen-full", "Fit to view", () => this.fitView()),
			iconButton("refresh", "Re-run layout", () => this.relayout()),
			this.settingsButton
		]);

		this.statusText = html("span", { class: "status-text" });
		this.statusCounts = html("span", { class: "status-counts" });
		const footer = html("footer", { class: "status-bar" }, [this.statusText, this.statusCounts]);

		this.container.append(this.loadingEl, this.emptyEl, this.searchBar.el, toolbar);
		const main = html("div", { class: "graph-main" }, [this.container, this.settingsPanel.el]);
		this.root.replaceChildren(main, footer);

		this.attachInteraction();
		new ResizeObserver(([entry]) => {
			this.width = entry.contentRect.width || CANVAS_WIDTH;
			this.height = entry.contentRect.height || CANVAS_HEIGHT;
		}).observe(this.container);

		this.updateChrome();
	}

	// ---------------------------------------------------------------- host messages

	handleMessage(message: HostToWebviewMessage) {
		switch (message.type) {
			case "init":
				this.init(message);
				break;
			case "update":
				this.setText(message.text);
				break;
			case "config":
				this.config = message.config;
				this.defaultSettings = normaliseGraphSettings(message.defaultSettings);
				break;
			case "fileName":
				this.root.dataset.fileName = message.fileName;
				break;
			case "cursor":
				this.followCursor(message.line);
				break;
			case "revealLine":
				this.post({
					type: "revealLineResult",
					requestId: message.requestId,
					found: this.revealLine(message.line, true)
				});
				break;
			case "command":
				this.runCommand(message.command);
				break;
		}
	}

	private init(message: Extract<HostToWebviewMessage, { type: "init" }>) {
		this.config = message.config;
		this.root.dataset.fileName = message.fileName;
		this.defaultSettings = normaliseGraphSettings(message.defaultSettings);
		this.settings = message.state ? normaliseGraphSettings(message.state.settings) : { ...this.defaultSettings };
		this.locked = message.state?.locked ?? false;
		if (message.state?.camera) {
			this.camera = { ...message.state.camera };
			this.hasCamera = true;
		}
		this.restoredPositions = message.state?.positions?.length ? message.state.positions : null;
		this.layoutDone = false;
		this.initialised = true;
		this.renderer.setCamera(this.camera);
		this.setText(message.text);
	}

	runCommand(command: GraphCommand) {
		switch (command) {
			case "fit":
				this.fitView();
				break;
			case "zoomIn":
				this.zoomBy(ZOOM_BUTTON_FACTOR);
				break;
			case "zoomOut":
				this.zoomBy(1 / ZOOM_BUTTON_FACTOR);
				break;
			case "relayout":
				this.relayout();
				break;
			case "toggleLock":
				this.toggleLock();
				break;
			case "find":
				if (!this.searchBar.isOpen) this.toggleSearch();
				else this.searchBar.open();
				break;
			case "toggleSettings":
				this.toggleSettings();
				break;
			case "exportSvg":
				this.exportGraph("svg");
				break;
			case "exportPng":
				this.exportGraph("png");
				break;
			case "resetSettings":
				if (this.locked) this.notifyLocked();
				else this.updateSettings(this.defaultSettings);
				break;
			case "clearLayout":
				this.locked = false;
				this.hasCamera = false;
				this.layoutDone = false;
				this.restoredPositions = null;
				this.rebuild({ forceLayout: true, discardPositions: true });
				break;
		}
	}

	// ---------------------------------------------------------------- parsing & building

	private setText(text: string) {
		const analysis = analyseTurtle(text);

		if (analysis.error) {
			this.error = analysis.error.line
				? `Line ${analysis.error.line}: ${analysis.error.message}`
				: analysis.error.message;
			// keep showing the last valid graph while the user is mid-edit (as Carapace does)
			if (this.lastGood) {
				this.updateChrome();
				return;
			}
		} else {
			this.error = null;
			this.lastGood = analysis;
		}

		this.rebuild();
	}

	private currentPositions(): NodePosition[] {
		return this.nodes.map((n) => ({ uri: n.uri, x: n.x, y: n.y, nodeType: n.nodeType }));
	}

	private rebuild(options: { forceLayout?: boolean; discardPositions?: boolean } = {}) {
		const gen = ++this.generation;
		const source = this.lastGood;

		if (!source || source.triples.length === 0) {
			this.nodes = [];
			this.edges = [];
			this.layoutDone = false;
			this.setLoading(false);
			this.render();
			return;
		}

		let existing: NodePosition[] = [];
		let restoring = false;
		if (!options.discardPositions) {
			if (this.layoutDone) existing = this.currentPositions();
			else if (this.restoredPositions) {
				existing = this.restoredPositions;
				restoring = true;
			}
		}

		const graph = buildGraph(source.triples, this.settings, existing, source.prefixMap, source.lineMapping);
		this.nodes = graph.nodes;
		this.edges = graph.edges;

		let needsLayout = options.forceLayout || !this.layoutDone;
		if (restoring) {
			this.restoredPositions = null;
			const saved = new Set(existing.map((p) => p.uri));
			const covered = this.nodes.filter((n) => saved.has(n.uri)).length;
			if (this.nodes.length > 0 && covered / this.nodes.length >= RESTORE_COVERAGE) needsLayout = false;
		}
		if (this.locked && this.layoutDone && !options.forceLayout) needsLayout = false;

		if (!needsLayout) {
			this.layoutDone = true;
			this.setLoading(false);
			this.render();
			if (!this.hasCamera) this.fitView();
			this.saveState();
			return;
		}

		this.layoutDone = false;
		this.setLoading(true);
		void this.layout(gen, options.forceLayout || !this.hasCamera);
	}

	private async layout(gen: number, fit: boolean) {
		try {
			const positions = await runForceLayout(
				{
					nodes: this.nodes.map((n) => ({ id: n.id, width: n.width, height: n.height, x: n.x, y: n.y })),
					edges: this.edges.map((e) => ({ id: e.id, source: e.source.id, target: e.target.id })),
					width: this.width,
					height: this.height
				},
				() => gen !== this.generation
			);
			if (!positions || gen !== this.generation) return;

			for (const node of this.nodes) {
				const p = positions.get(node.id);
				if (p) {
					node.x = p.x;
					node.y = p.y;
				}
			}
			this.layoutDone = true;
			this.setLoading(false);
			this.render();
			if (fit) this.fitView();
			this.saveState();
		} catch (error) {
			if (gen !== this.generation) return;
			this.setLoading(false);
			this.render();
			this.post({ type: "notify", level: "error", message: `Failed to lay out graph: ${String(error)}` });
		}
	}

	private updateSettings(patch: Partial<GraphSettings>) {
		if (this.locked) {
			this.notifyLocked();
			return;
		}
		const next = normaliseGraphSettings({ ...this.settings, ...patch });
		if (makeSettingsHash(next) === makeSettingsHash(this.settings)) return;
		this.settings = next;
		this.rebuild();
	}

	private relayout() {
		if (this.locked) {
			this.notifyLocked();
			return;
		}
		this.rebuild({ forceLayout: true });
	}

	private notifyLocked() {
		this.post({ type: "notify", level: "info", message: "The graph layout is locked. Unlock it to make changes." });
	}

	// ---------------------------------------------------------------- rendering & chrome

	private render() {
		const uris = new Set(this.nodes.map((n) => n.uri));
		for (const uri of this.selectedUris) if (!uris.has(uri)) this.selectedUris.delete(uri);
		if (this.highlightedEdgeId && !this.edges.some((e) => e.id === this.highlightedEdgeId)) {
			this.highlightedEdgeId = null;
		}

		this.renderer.render(this.nodes, this.edges, this.selectedUris, this.highlightedEdgeId);
		this.renderer.setCamera(this.camera);
		if (this.searchBar.isOpen) this.searchBar.refresh();
		this.updateChrome();
	}

	private setLoading(loading: boolean) {
		this.loading = loading;
		this.updateChrome();
	}

	private updateChrome() {
		this.loadingEl.hidden = !this.loading;
		this.renderer.svgEl.classList.toggle("invisible", this.loading);

		const empty = !this.loading && this.nodes.length === 0;
		this.emptyEl.hidden = !empty || !this.initialised;
		if (empty) {
			this.emptyEl.textContent = this.error
				? "The document could not be parsed. Fix the error to see the graph."
				: (this.lastGood?.triples.length ?? 0) > 0
					? "All nodes are hidden by the current graph settings."
					: "No triples yet — start writing Turtle to see the graph.";
		}

		this.statusText.replaceChildren();
		if (this.error) {
			this.statusText.append(html("span", { class: "status-error", title: this.error }, [this.error]));
		} else {
			this.statusText.textContent = this.loading ? "Graph loading…" : this.lastGood ? "Graph loaded" : "Ready";
		}
		this.statusCounts.textContent =
			this.lastGood && !this.loading ? `${this.nodes.length} nodes, ${this.edges.length} edges` : "";

		this.lockButton.replaceChildren(
			html("span", { class: `codicon codicon-${this.locked ? "lock" : "unlock"}`, "aria-hidden": "true" })
		);
		this.lockButton.title = this.locked ? "Unlock layout" : "Lock layout";
		this.lockButton.setAttribute("aria-label", this.lockButton.title);
		this.lockButton.classList.toggle("active", this.locked);
		this.selectModeButton.classList.toggle("active", this.boxSelectMode);
		this.container.classList.toggle("box-select", this.boxSelectMode);
		this.container.classList.toggle("locked", this.locked);

		this.settingsPanel.update(this.settings, this.lastGood?.prefixMap ?? {}, this.locked);
		this.postStatus();
	}

	status(): GraphStatus {
		return {
			initialised: this.initialised,
			nodes: this.nodes.length,
			edges: this.edges.length,
			loading: this.loading,
			locked: this.locked,
			error: this.error,
			selectedUris: [...this.selectedUris]
		};
	}

	private persist() {
		if (!this.layoutDone) return;
		const state: PersistedGraphState = {
			settings: this.settings,
			locked: this.locked,
			positions: this.currentPositions(),
			camera: this.hasCamera ? { ...this.camera } : null
		};
		this.post({ type: "saveState", state });
	}

	// ---------------------------------------------------------------- camera

	private setCamera(camera: Camera) {
		this.camera = camera;
		this.hasCamera = true;
		this.renderer.setCamera(camera);
		this.saveState();
	}

	private zoomBy(factor: number, centre = { x: this.width / 2, y: this.height / 2 }) {
		const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.camera.k * factor));
		const gx = (centre.x - this.camera.x) / this.camera.k;
		const gy = (centre.y - this.camera.y) / this.camera.k;
		this.setCamera({ k, x: centre.x - gx * k, y: centre.y - gy * k });
	}

	fitView() {
		if (this.nodes.length === 0) return;
		const minX = Math.min(...this.nodes.map((n) => n.x)) - FIT_PADDING;
		const maxX = Math.max(...this.nodes.map((n) => n.x + n.width)) + FIT_PADDING;
		const minY = Math.min(...this.nodes.map((n) => n.y)) - FIT_PADDING;
		const maxY = Math.max(...this.nodes.map((n) => n.y + n.height)) + FIT_PADDING;
		const graphWidth = maxX - minX;
		const graphHeight = maxY - minY;
		const k = Math.max(ZOOM_MIN, Math.min(this.width / graphWidth, this.height / graphHeight, ZOOM_FIT_MAX));
		this.setCamera({
			k,
			x: (this.width - graphWidth * k) / 2 - minX * k,
			y: (this.height - graphHeight * k) / 2 - minY * k
		});
	}

	private centreOn(x: number, y: number) {
		const k = Math.max(this.camera.k, 0.5);
		this.setCamera({ k, x: this.width / 2 - x * k, y: this.height / 2 - y * k });
	}

	private focusNode(node: Node, centre: boolean) {
		this.highlightedEdgeId = null;
		this.renderer.setHighlightedEdge(null);
		this.setSelected([node.uri]);
		if (centre) this.centreOn(node.x + node.width / 2, node.y + node.height / 2);
	}

	private focusResult(result: GraphSearchResult) {
		if (result.kind === "node") {
			this.focusNode(result.node, true);
			return;
		}
		const { source, target } = result.edge;
		this.setSelected([]);
		this.highlightedEdgeId = result.edge.id;
		this.renderer.setHighlightedEdge(result.edge.id);
		this.centreOn(
			(source.x + source.width / 2 + target.x + target.width / 2) / 2,
			(source.y + source.height / 2 + target.y + target.height / 2) / 2
		);
	}

	// ---------------------------------------------------------------- editor <-> graph mapping

	private nodeForLine(line: number): Node | null {
		const uris = this.lastGood?.lineMapping.lineToUris.get(line);
		if (!uris) return null;
		for (const uri of uris) {
			const node = this.nodes.find((n) => n.uri === uri);
			if (node) return node;
		}
		return null;
	}

	private lineForNode(node: Node): number | null {
		const mapping = this.lastGood?.lineMapping;
		if (!mapping) return null;
		const direct = mapping.uriToLine.get(node.uri);
		if (direct != null) return direct;
		// literal & duplicated external nodes are keyed "subject|predicate|value": fall back to the subject
		const sep = node.uri.indexOf("|");
		return sep > 0 ? (mapping.uriToLine.get(node.uri.slice(0, sep)) ?? null) : null;
	}

	private followCursor(line: number) {
		if (this.config.followCursor === "off" || this.loading) return;
		const node = this.nodeForLine(line);
		if (!node) return;
		if (this.selectedUris.size === 1 && this.selectedUris.has(node.uri) && this.config.followCursor !== "center") {
			return;
		}
		this.focusNode(node, this.config.followCursor === "center");
	}

	private revealLine(line: number, centre: boolean): boolean {
		const node = this.nodeForLine(line);
		if (!node) return false;
		this.focusNode(node, centre);
		return true;
	}

	private setSelected(uris: Iterable<string>) {
		this.selectedUris = new Set(uris);
		this.renderer.setSelection(this.selectedUris);
		this.postStatus();
	}

	// ---------------------------------------------------------------- toolbar actions

	private toggleSearch() {
		this.searchBar.toggle();
		this.searchButton.classList.toggle("active", this.searchBar.isOpen);
	}

	private toggleSettings() {
		this.settingsPanel.toggle();
		this.settingsButton.classList.toggle("active", this.settingsPanel.isOpen);
	}

	private toggleSelectMode() {
		this.boxSelectMode = !this.boxSelectMode;
		this.updateChrome();
	}

	private toggleLock() {
		this.locked = !this.locked;
		this.updateChrome();
		this.saveState();
	}

	private async exportGraph(format: "svg" | "png") {
		if (this.nodes.length === 0 || this.loading) {
			this.post({ type: "notify", level: "warning", message: "There is no graph to export yet." });
			return;
		}
		try {
			const exported = buildExportSvg(
				this.renderer.svgEl,
				this.nodes,
				this.camera,
				this.config.exportTheme === "light"
			);
			const data =
				format === "svg" ? exported.svg : await rasterisePng(exported.svg, exported.width, exported.height);
			this.post({ type: "export", format, data });
		} catch (error) {
			this.post({
				type: "notify",
				level: "error",
				message: error instanceof Error ? error.message : `Export failed: ${String(error)}`
			});
		}
	}

	// ---------------------------------------------------------------- pointer & keyboard interaction

	private toGraph(event: MouseEvent) {
		const rect = this.container.getBoundingClientRect();
		return {
			x: (event.clientX - rect.left - this.camera.x) / this.camera.k,
			y: (event.clientY - rect.top - this.camera.y) / this.camera.k
		};
	}

	private attachInteraction() {
		const svgEl = this.renderer.svgEl;

		svgEl.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				if (event.ctrlKey || event.metaKey) {
					const rect = this.container.getBoundingClientRect();
					const factor = event.deltaY > 0 ? ZOOM_WHEEL_OUT_FACTOR : ZOOM_WHEEL_IN_FACTOR;
					this.zoomBy(factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
				} else {
					this.setCamera({
						...this.camera,
						x: this.camera.x - event.deltaX,
						y: this.camera.y - event.deltaY
					});
				}
			},
			{ passive: false }
		);

		svgEl.addEventListener("contextmenu", (event) => event.preventDefault());

		svgEl.addEventListener("mousedown", (event) => {
			if (event.button !== 0) return;
			this.container.focus({ preventScroll: true });
			const nodeId = this.renderer.nodeIdFromElement(event.target);
			if (nodeId) this.startNodeDrag(nodeId, event);
			else this.startBackgroundDrag(event);
		});

		svgEl.addEventListener("dblclick", (event) => {
			const nodeId = this.renderer.nodeIdFromElement(event.target);
			const node = nodeId ? this.nodes.find((n) => n.id === nodeId) : null;
			if (!node) return;
			const line = this.lineForNode(node);
			if (line != null) this.post({ type: "revealSource", line, focusEditor: true });
		});

		this.container.addEventListener("keydown", (event) => {
			const mod = event.ctrlKey || event.metaKey;
			if (mod && event.key.toLowerCase() === "f") {
				event.preventDefault();
				this.searchBar.open();
				this.searchButton.classList.add("active");
			} else if (event.key === "Escape") {
				if (this.searchBar.isOpen) this.searchBar.close();
				else if (this.settingsPanel.isOpen) this.settingsPanel.close();
				else this.setSelected([]);
			} else if (!mod && (event.key === "+" || event.key === "=")) {
				this.zoomBy(ZOOM_BUTTON_FACTOR);
			} else if (!mod && event.key === "-") {
				this.zoomBy(1 / ZOOM_BUTTON_FACTOR);
			} else if (!mod && event.key === "0") {
				this.fitView();
			}
		});
	}

	private startBackgroundDrag(event: MouseEvent) {
		const startX = event.clientX;
		const startY = event.clientY;
		const startCamera = { ...this.camera };
		const origin = this.toGraph(event);
		let box: { x1: number; y1: number; x2: number; y2: number } | null = this.boxSelectMode
			? { x1: origin.x, y1: origin.y, x2: origin.x, y2: origin.y }
			: null;

		const onMove = (e: MouseEvent) => {
			if (box) {
				const p = this.toGraph(e);
				box = { ...box, x2: p.x, y2: p.y };
				this.renderer.setSelectionBox(box);
			} else {
				this.camera = {
					...startCamera,
					x: startCamera.x + e.clientX - startX,
					y: startCamera.y + e.clientY - startY
				};
				this.renderer.setCamera(this.camera);
			}
		};
		const onUp = (e: MouseEvent) => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			const dragged =
				Math.abs(e.clientX - startX) > DRAG_THRESHOLD || Math.abs(e.clientY - startY) > DRAG_THRESHOLD;

			if (box) {
				this.renderer.setSelectionBox(null);
				if (dragged) {
					const x1 = Math.min(box.x1, box.x2);
					const y1 = Math.min(box.y1, box.y2);
					const x2 = Math.max(box.x1, box.x2);
					const y2 = Math.max(box.y1, box.y2);
					this.setSelected(
						this.nodes
							.filter((n) => n.x < x2 && n.x + n.width > x1 && n.y < y2 && n.y + n.height > y1)
							.map((n) => n.uri)
					);
					return;
				}
			} else if (dragged) {
				this.setCamera(this.camera);
				return;
			}
			this.setSelected([]);
			this.highlightedEdgeId = null;
			this.renderer.setHighlightedEdge(null);
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	}

	private startNodeDrag(nodeId: string, event: MouseEvent) {
		const node = this.nodes.find((n) => n.id === nodeId);
		if (!node) return;
		const toggle = event.ctrlKey || event.metaKey;
		if (toggle) event.preventDefault();

		const wasSelected = this.selectedUris.has(node.uri);
		if (toggle) {
			const next = new Set(this.selectedUris);
			if (wasSelected) next.delete(node.uri);
			else next.add(node.uri);
			this.setSelected(next);
		} else if (!wasSelected) {
			this.setSelected([node.uri]);
		}

		const startX = event.clientX;
		const startY = event.clientY;
		const moving = this.nodes.filter((n) => this.selectedUris.has(n.uri));
		const starts = new Map(moving.map((n) => [n.id, { x: n.x, y: n.y }]));
		let dragged = false;

		const onMove = (e: MouseEvent) => {
			if (this.locked) return;
			if (
				!dragged &&
				Math.abs(e.clientX - startX) <= DRAG_THRESHOLD &&
				Math.abs(e.clientY - startY) <= DRAG_THRESHOLD
			) {
				return;
			}
			dragged = true;
			const dx = (e.clientX - startX) / this.camera.k;
			const dy = (e.clientY - startY) / this.camera.k;
			for (const n of moving) {
				const start = starts.get(n.id)!;
				n.x = start.x + dx;
				n.y = start.y + dy;
			}
			this.renderer.updatePositions(starts.keys());
		};
		const onUp = () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			if (dragged) {
				this.saveState();
				return;
			}
			if (!toggle && wasSelected && this.selectedUris.size > 1) this.setSelected([node.uri]);
			if (!toggle && this.config.revealLineOnNodeClick) {
				const line = this.lineForNode(node);
				if (line != null) this.post({ type: "revealSource", line, focusEditor: false });
			}
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	}
}
