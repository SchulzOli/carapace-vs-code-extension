import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

type LayoutNode = SimulationNodeDatum & { id: string; width: number; height: number };
type LayoutLink = SimulationLinkDatum<LayoutNode> & { id: string };

export type LayoutInput = {
	nodes: Array<{ id: string; width: number; height: number; x: number; y: number }>;
	edges: Array<{ id: string; source: string; target: string }>;
	width: number;
	height: number;
};

/**
 * Carapace's force layout (same forces as its web worker), run to convergence in time-sliced chunks so the
 * webview stays responsive. Resolves to `null` if `isCancelled` becomes true before it finishes.
 */
export async function runForceLayout(
	input: LayoutInput,
	isCancelled: () => boolean = () => false,
	frameBudgetMs = 24
): Promise<Map<string, { x: number; y: number }> | null> {
	const nodes: LayoutNode[] = input.nodes.map((n) => ({ ...n }));
	const links: LayoutLink[] = input.edges.map((e) => ({ ...e }));

	// Unconnected nodes feel only repulsion and drift far out, which makes "fit to view" zoom everything tiny;
	// pull them towards the centre a little harder than connected ones.
	const linked = new Set(input.edges.flatMap((e) => [e.source, e.target]));
	const centring = (node: LayoutNode) => (linked.has(node.id) ? 0.015 : 0.08);

	const sim = forceSimulation<LayoutNode>(nodes)
		.alpha(1)
		.alphaDecay(0.01)
		.force(
			"link",
			forceLink<LayoutNode, LayoutLink>(links)
				.id((node) => node.id)
				.distance((link) => {
					const source = link.source as LayoutNode;
					const target = link.target as LayoutNode;
					return Math.max(50, (source.width + target.width) / 2);
				})
				.strength(0.3)
		)
		.force("charge", forceManyBody<LayoutNode>().strength(Math.min(-800, nodes.length * -3)))
		.force(
			"collide",
			forceCollide<LayoutNode>().radius((node) => Math.max(node.width, node.height) / 2 + 15)
		)
		.force("x", forceX<LayoutNode>(input.width / 2).strength(centring))
		.force("y", forceY<LayoutNode>(input.height / 2).strength(centring))
		.stop();

	while (sim.alpha() > sim.alphaMin()) {
		const start = performance.now();
		while (sim.alpha() > sim.alphaMin() && performance.now() - start < frameBudgetMs) sim.tick();

		await new Promise((resolve) => setTimeout(resolve, 0));
		if (isCancelled()) return null;
	}

	return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}
