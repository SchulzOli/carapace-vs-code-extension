import type { Edge, GraphSearchResult, Node } from "../core/types";
import { html, iconButton } from "./dom";

export function searchGraph(query: string, nodes: Node[], edges: Edge[]): GraphSearchResult[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];

	const nodeResults: GraphSearchResult[] = nodes
		.filter((n) => `${n.prefix ?? ""}:${n.label}`.toLowerCase().includes(q) || n.uri.toLowerCase().includes(q))
		.map((node) => ({ kind: "node", node }));
	const edgeResults: GraphSearchResult[] = edges
		.filter((e) => !e.collectionEdge && !e.termEdge && e.label.split("\n").some((p) => p.toLowerCase().includes(q)))
		.map((edge) => ({ kind: "edge", edge }));

	return [...nodeResults, ...edgeResults];
}

/** Floating search box for nodes and predicates (port of Carapace's GraphSearchbar). */
export class SearchBar {
	readonly el: HTMLDivElement;
	private readonly input: HTMLInputElement;
	private readonly counter: HTMLSpanElement;
	private readonly prevButton: HTMLButtonElement;
	private readonly nextButton: HTMLButtonElement;
	private results: GraphSearchResult[] = [];
	private index = -1;

	constructor(
		private readonly getGraph: () => { nodes: Node[]; edges: Edge[] },
		private readonly onFocusResult: (result: GraphSearchResult) => void,
		private readonly onClose: () => void
	) {
		this.input = html("input", {
			type: "text",
			class: "search-input",
			placeholder: "Search nodes and predicates",
			"aria-label": "Search nodes and predicates",
			spellcheck: "false"
		});
		this.counter = html("span", { class: "search-counter", "aria-live": "polite" });
		this.prevButton = iconButton("chevron-up", "Previous result (Shift+Enter)", () => this.step(-1));
		this.nextButton = iconButton("chevron-down", "Next result (Enter)", () => this.step(1));

		this.el = html("div", { class: "searchbar", hidden: true }, [
			this.input,
			this.counter,
			this.prevButton,
			this.nextButton,
			iconButton("close", "Close (Escape)", () => this.close())
		]);

		this.input.addEventListener("input", () => {
			this.index = -1;
			this.refresh();
		});
		this.input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.step(event.shiftKey ? -1 : 1);
			} else if (event.key === "Escape") {
				event.preventDefault();
				this.close();
			}
			event.stopPropagation();
		});
		this.updateCounter();
	}

	get isOpen() {
		return !this.el.hidden;
	}

	open() {
		this.el.hidden = false;
		this.input.focus();
		this.input.select();
		this.refresh();
	}

	close() {
		if (this.el.hidden) return;
		this.el.hidden = true;
		this.onClose();
	}

	toggle() {
		if (this.isOpen) this.close();
		else this.open();
	}

	/** Re-runs the query, e.g. after the graph changed. */
	refresh() {
		const { nodes, edges } = this.getGraph();
		this.results = searchGraph(this.input.value, nodes, edges);
		if (this.results.length === 0) this.index = -1;
		else if (this.index >= this.results.length) this.index = this.results.length - 1;
		this.updateCounter();
	}

	private step(delta: number) {
		if (this.results.length === 0) return;
		this.index = (this.index + delta + this.results.length) % this.results.length;
		this.updateCounter();
		this.onFocusResult(this.results[this.index]);
	}

	private updateCounter() {
		const hasQuery = this.input.value.trim() !== "";
		this.counter.textContent = !hasQuery
			? ""
			: this.results.length === 0
				? "No results"
				: `${Math.max(this.index + 1, 0)}/${this.results.length}`;
		this.counter.classList.toggle("no-results", hasQuery && this.results.length === 0);
		this.prevButton.disabled = this.results.length === 0;
		this.nextButton.disabled = this.results.length === 0;
	}
}
