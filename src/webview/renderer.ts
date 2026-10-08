import { entityTypeColour, entityTypeLabel } from "../core/entity";
import { NODE_FONT_FAMILY, TEXT_VERTICAL_OFFSET_FACTOR } from "../core/layout";
import type { Edge, Node } from "../core/types";
import {
	ARROW_INSET,
	ARROW_SIZE,
	ARROW_WIDTH_FACTOR,
	COLLECTION_NODE_RADIUS,
	EDGE_LABEL_FONT_SIZE,
	EDGE_SELF_REF_RADIUS,
	NODE_BADGE_FONT_SIZE,
	NODE_BADGE_PADDING_X,
	NODE_BODY_FONT_SIZE,
	NODE_BORDER_WIDTH,
	NODE_CONTENT_PADDING_X,
	NODE_CONTENT_PADDING_Y,
	NODE_HEADER_FONT_SIZE,
	NODE_HEADER_HEIGHT,
	NODE_LABEL_GAP,
	NODE_LINE_HEIGHT
} from "../core/visualisation";
import { svg } from "./dom";

export type Camera = { x: number; y: number; k: number };

type EdgeView = { edge: Edge; el: SVGGElement };
type NodeView = { node: Node; el: SVGGElement };

/**
 * Renders nodes and edges into an SVG viewport. Port of Carapace's GraphNode/GraphEdge components,
 * with incremental position updates so dragging does not re-create the DOM.
 */
export class GraphRenderer {
	readonly svgEl: SVGSVGElement;
	readonly viewport: SVGGElement;
	private readonly edgeLayer: SVGGElement;
	private readonly nodeLayer: SVGGElement;
	private readonly overlayLayer: SVGGElement;
	private selectionBox: SVGRectElement | null = null;

	private nodeViews = new Map<string, NodeView>();
	private edgeViews: EdgeView[] = [];
	private edgesByNode = new Map<string, EdgeView[]>();

	constructor(container: HTMLElement) {
		this.edgeLayer = svg("g", { class: "edges" });
		this.nodeLayer = svg("g", { class: "nodes" });
		this.overlayLayer = svg("g", { class: "overlay" });
		this.viewport = svg("g", { class: "viewport", "font-family": NODE_FONT_FAMILY }, [
			this.overlayLayer,
			this.edgeLayer,
			this.nodeLayer
		]);
		this.svgEl = svg("svg", { class: "graph-canvas", role: "img", "aria-label": "Ontology graph" }, [
			this.viewport
		]);
		container.append(this.svgEl);
	}

	setCamera(camera: Camera) {
		this.viewport.setAttribute("transform", `translate(${camera.x}, ${camera.y}) scale(${camera.k})`);
	}

	render(nodes: Node[], edges: Edge[], selectedUris: ReadonlySet<string>, highlightedEdgeId: string | null) {
		this.nodeViews.clear();
		this.edgeViews = [];
		this.edgesByNode.clear();

		const edgeFragment = document.createDocumentFragment();
		for (const edge of edges) {
			const view = { edge, el: createEdgeElement(edge, edge.id === highlightedEdgeId) };
			this.edgeViews.push(view);
			edgeFragment.append(view.el);
			for (const nodeId of new Set([edge.source.id, edge.target.id])) {
				let list = this.edgesByNode.get(nodeId);
				if (!list) this.edgesByNode.set(nodeId, (list = []));
				list.push(view);
			}
		}

		const nodeFragment = document.createDocumentFragment();
		for (const node of nodes) {
			const el = createNodeElement(node);
			el.classList.toggle("selected", selectedUris.has(node.uri));
			this.nodeViews.set(node.id, { node, el });
			nodeFragment.append(el);
		}

		this.edgeLayer.replaceChildren(edgeFragment);
		this.nodeLayer.replaceChildren(nodeFragment);
	}

	/** Re-applies the position of the given nodes and redraws their incident edges. */
	updatePositions(nodeIds: Iterable<string>) {
		const dirtyEdges = new Set<EdgeView>();
		for (const id of nodeIds) {
			const view = this.nodeViews.get(id);
			if (!view) continue;
			view.el.setAttribute("transform", `translate(${view.node.x}, ${view.node.y})`);
			for (const edgeView of this.edgesByNode.get(id) ?? []) dirtyEdges.add(edgeView);
		}
		for (const edgeView of dirtyEdges) {
			const replacement = createEdgeElement(edgeView.edge, edgeView.el.classList.contains("highlighted"));
			edgeView.el.replaceWith(replacement);
			edgeView.el = replacement;
		}
	}

	setSelection(selectedUris: ReadonlySet<string>) {
		for (const { node, el } of this.nodeViews.values()) {
			el.classList.toggle("selected", selectedUris.has(node.uri));
		}
	}

	setHighlightedEdge(edgeId: string | null) {
		for (const view of this.edgeViews) {
			const highlighted = view.edge.id === edgeId;
			if (view.el.classList.contains("highlighted") === highlighted) continue;
			const replacement = createEdgeElement(view.edge, highlighted);
			view.el.replaceWith(replacement);
			view.el = replacement;
		}
	}

	nodeIdFromElement(target: EventTarget | null): string | null {
		const el = target instanceof Element ? target.closest<SVGGElement>("g.node") : null;
		return el?.dataset.id ?? null;
	}

	setSelectionBox(box: { x1: number; y1: number; x2: number; y2: number } | null) {
		if (!box) {
			this.selectionBox?.remove();
			this.selectionBox = null;
			return;
		}
		if (!this.selectionBox) {
			this.selectionBox = svg("rect", { class: "selection-box", rx: 6, "pointer-events": "none" });
			this.overlayLayer.append(this.selectionBox);
		}
		this.selectionBox.setAttribute("x", String(Math.min(box.x1, box.x2)));
		this.selectionBox.setAttribute("y", String(Math.min(box.y1, box.y2)));
		this.selectionBox.setAttribute("width", String(Math.abs(box.x2 - box.x1)));
		this.selectionBox.setAttribute("height", String(Math.abs(box.y2 - box.y1)));
	}
}

function colourStyle(colour: string) {
	return `fill: color-mix(in srgb, var(--${colour}) 15%, var(--mantle)); stroke: var(--${colour});`;
}

function nodeTitle(node: Node): string {
	if (node.nodeType === "literal") return `"${node.label}"`;
	if (node.collection) return `${node.collectionType ?? "list"} collection`;
	if (node.blank) return "blank node";
	return node.uri.includes("|") ? node.uri.slice(node.uri.lastIndexOf("|") + 1) : node.uri;
}

export function createNodeElement(node: Node): SVGGElement {
	const label = entityTypeLabel(node.nodeType, node.external);
	const colour = entityTypeColour(node.nodeType, node.external);
	const g = svg("g", {
		class: `node node-${node.nodeType}${node.external ? " external" : ""}`,
		"data-id": node.id,
		"data-uri": node.uri,
		transform: `translate(${node.x}, ${node.y})`
	});
	g.append(svg("title", {}, [nodeTitle(node)]));

	const cx = node.width / 2;
	const cy = node.height / 2;

	if (node.collection) {
		g.append(
			svg("circle", { class: "selection-outline", cx, cy, r: COLLECTION_NODE_RADIUS + 4 }),
			svg("circle", {
				class: "node-shape",
				cx,
				cy,
				r: COLLECTION_NODE_RADIUS,
				style: colourStyle(colour),
				"stroke-width": 1.5
			}),
			collectionIcon(node, cx, cy)
		);
	} else if (node.nodeType === "blank") {
		g.append(
			svg("circle", { class: "selection-outline", cx, cy, r: node.width / 2 + 4 }),
			svg("circle", {
				class: "node-shape",
				cx,
				cy,
				r: node.width / 2,
				style: colourStyle(colour),
				"stroke-width": 1.5
			})
		);
	} else if (node.blank) {
		g.append(
			svg("rect", {
				class: "selection-outline",
				x: -4,
				y: -4,
				width: node.width + 8,
				height: node.height + 8,
				rx: 8
			}),
			svg("rect", {
				class: "node-shape",
				width: node.width,
				height: node.height,
				rx: node.height / 2,
				style: colourStyle(colour),
				"stroke-width": 1.5
			}),
			svg(
				"text",
				{
					x: cx,
					y: cy + NODE_HEADER_FONT_SIZE * TEXT_VERTICAL_OFFSET_FACTOR,
					"text-anchor": "middle",
					style: `fill: var(--${colour})`,
					"font-size": NODE_HEADER_FONT_SIZE,
					"font-weight": 600,
					"pointer-events": "none"
				},
				[label]
			)
		);
	} else {
		const contentInset = NODE_BORDER_WIDTH / 2 + NODE_CONTENT_PADDING_X / 2;
		const headerTextY = NODE_HEADER_HEIGHT / 2 + NODE_HEADER_FONT_SIZE * TEXT_VERTICAL_OFFSET_FACTOR;
		const badgeHeight = NODE_BADGE_FONT_SIZE + 4;
		const badgeY = NODE_HEADER_HEIGHT + NODE_CONTENT_PADDING_Y + (NODE_LINE_HEIGHT - badgeHeight) / 2;
		const badgeTextY = badgeY + badgeHeight / 2 + NODE_BADGE_FONT_SIZE * 0.35;
		const w = node.width;

		g.append(
			svg("rect", { class: "selection-outline", x: -4, y: -4, width: w + 8, height: node.height + 8, rx: 8 }),
			svg("rect", {
				class: "node-shape",
				width: w,
				height: node.height,
				rx: 6,
				style: colourStyle(colour),
				"stroke-width": 1.5
			}),
			svg("path", {
				d: `M 0 6 Q 0 0 6 0 L ${w - 6} 0 Q ${w} 0 ${w} 6 L ${w} ${NODE_HEADER_HEIGHT} L 0 ${NODE_HEADER_HEIGHT} Z`,
				style: `fill: var(--${colour});`,
				"pointer-events": "none"
			}),
			svg(
				"text",
				{
					x: 6,
					y: headerTextY,
					class: "node-header-text",
					"font-size": NODE_HEADER_FONT_SIZE,
					"font-weight": "bold",
					"pointer-events": "none"
				},
				[label]
			)
		);

		if (node.prefix) {
			g.append(
				svg("rect", {
					x: contentInset,
					y: badgeY,
					width: node.badgeWidth,
					height: badgeHeight,
					rx: 3,
					style: `fill: var(--${colour});`,
					"pointer-events": "none"
				}),
				svg(
					"text",
					{
						x: contentInset + NODE_BADGE_PADDING_X,
						y: badgeTextY,
						class: "node-badge-text",
						"font-size": NODE_BADGE_FONT_SIZE,
						"font-weight": 600,
						"pointer-events": "none"
					},
					[node.prefix]
				)
			);
		}

		node.bodyLines.forEach((line, i) => {
			g.append(
				svg(
					"text",
					{
						x: i === 0 && node.prefix ? contentInset + node.badgeWidth + NODE_LABEL_GAP : contentInset,
						y:
							NODE_HEADER_HEIGHT +
							NODE_CONTENT_PADDING_Y +
							(i + 0.5) * NODE_LINE_HEIGHT +
							NODE_BODY_FONT_SIZE * TEXT_VERTICAL_OFFSET_FACTOR,
						class: "node-body-text",
						"font-size": NODE_BODY_FONT_SIZE,
						"pointer-events": "none"
					},
					[line]
				)
			);
		});
	}

	return g;
}

function collectionIcon(node: Node, cx: number, cy: number): SVGGElement {
	const g = svg("g", { transform: `translate(${cx}, ${cy})`, "pointer-events": "none", class: "collection-icon" });
	const common = { fill: "none", "stroke-width": 2 };
	switch (node.collectionType) {
		case "enumeration":
			g.append(svg("path", { d: "M -4,-4 L 0,4 L 4,-4", "stroke-linejoin": "round", ...common }));
			break;
		case "intersection":
			g.append(svg("path", { d: "M -4,3 Q -4,-4 0,-4 Q 4,-4 4,3", ...common }));
			break;
		case "union":
			g.append(svg("path", { d: "M -4,-3 Q -4,4 0,4 Q 4,4 4,-3", ...common }));
			break;
		default:
			for (const y of [-3, 0, 3]) g.append(svg("line", { x1: -4, y1: y, x2: 4, y2: y, "stroke-width": 2 }));
	}
	return g;
}

function normalise(dx: number, dy: number) {
	const len = Math.sqrt(dx * dx + dy * dy) || 1;
	return { ux: dx / len, uy: dy / len };
}

function arrowHead(tipX: number, tipY: number, ux: number, uy: number) {
	const bx1 = tipX - ux * ARROW_SIZE + uy * ARROW_SIZE * ARROW_WIDTH_FACTOR;
	const by1 = tipY - uy * ARROW_SIZE - ux * ARROW_SIZE * ARROW_WIDTH_FACTOR;
	const bx2 = tipX - ux * ARROW_SIZE - uy * ARROW_SIZE * ARROW_WIDTH_FACTOR;
	const by2 = tipY - uy * ARROW_SIZE + ux * ARROW_SIZE * ARROW_WIDTH_FACTOR;
	return `${tipX},${tipY} ${bx1},${by1} ${bx2},${by2}`;
}

export function createEdgeElement(edge: Edge, highlighted: boolean): SVGGElement {
	const { source, target } = edge;
	const g = svg("g", {
		class: `edge${edge.collectionEdge ? " collection-edge" : ""}${highlighted ? " highlighted" : ""}`,
		"data-id": edge.id
	});
	const strokeWidth = highlighted ? 3 : 1.5;

	let labelX: number;
	let labelY: number;
	const selfRef = source.id === target.id;

	if (selfRef) {
		const right = source.x + source.width;
		const cy = source.y + source.height / 2;
		const cp1x = right + EDGE_SELF_REF_RADIUS;
		const cp1y = cy - EDGE_SELF_REF_RADIUS;
		const cp2x = right + EDGE_SELF_REF_RADIUS;
		const cp2y = cy + EDGE_SELF_REF_RADIUS;
		const { ux, uy } = normalise(right - cp2x, cy - cp2y);
		const tipX = right + ux * ARROW_INSET;
		const tipY = cy + uy * ARROW_INSET;

		g.append(
			svg("path", {
				class: "edge-line",
				d: `M ${right} ${cy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${right} ${cy}`,
				"stroke-width": strokeWidth,
				fill: "none"
			}),
			svg("polygon", { class: "edge-arrow", points: arrowHead(tipX, tipY, ux, uy) })
		);
		labelX = right + EDGE_SELF_REF_RADIUS * 0.5;
		labelY = cy;
	} else {
		const x1 = source.x + source.width / 2;
		const y1 = source.y + source.height / 2;
		const x2 = target.x + target.width / 2;
		const y2 = target.y + target.height / 2;
		const { ux, uy } = normalise(x2 - x1, y2 - y1);
		const t = Math.min(target.width / 2 / (Math.abs(ux) || 0.001), target.height / 2 / (Math.abs(uy) || 0.001));
		const tipX = x2 - ux * (t - ARROW_INSET);
		const tipY = y2 - uy * (t - ARROW_INSET);

		g.append(
			svg("line", {
				class: "edge-line",
				x1,
				y1,
				x2,
				y2,
				"stroke-width": strokeWidth,
				"stroke-dasharray": edge.collectionEdge ? 5 : null
			}),
			svg("polygon", { class: "edge-arrow", points: arrowHead(tipX, tipY, ux, uy) })
		);
		labelX = (x1 + x2) / 2;
		labelY = (y1 + y2) / 2;
	}

	if (!edge.collectionEdge) {
		const text = svg("text", {
			class: "edge-label",
			x: labelX,
			y: labelY,
			"text-anchor": selfRef ? "start" : "middle",
			"dominant-baseline": selfRef ? "middle" : null,
			"font-size": EDGE_LABEL_FONT_SIZE,
			"stroke-width": 3,
			"stroke-linejoin": "round",
			"paint-order": "stroke"
		});
		edge.label.split("\n").forEach((part, i) => {
			if (i === 0) text.append(part);
			else text.append(svg("tspan", { x: labelX, dy: "1.2em" }, [part]));
		});
		g.append(text);
	}

	return g;
}
