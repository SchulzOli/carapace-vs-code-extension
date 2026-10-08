import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

import { SAMPLE_TURTLE } from "../../src/core/sample";
import { defaultGraphSettings } from "../../src/core/settings";
import type {
	GraphStatus,
	HostToWebviewMessage,
	PersistedGraphState,
	ViewConfig,
	WebviewToHostMessage
} from "../../src/shared/protocol";

const EX = "http://example.org/test#";
const HARNESS = pathToFileURL(join(__dirname, "harness.html")).href;
const CONFIG: ViewConfig = { followCursor: "highlight", revealLineOnNodeClick: true, exportTheme: "light" };

function lineOf(text: string, needle: string): number {
	return text.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

async function send(page: Page, message: HostToWebviewMessage) {
	await page.evaluate((m) => (window as unknown as { __send: (m: unknown) => void }).__send(m), message);
}

async function messages(page: Page): Promise<WebviewToHostMessage[]> {
	return page.evaluate(() => (window as unknown as { __messages: WebviewToHostMessage[] }).__messages);
}

async function clearMessages(page: Page) {
	await page.evaluate(() => ((window as unknown as { __messages: unknown[] }).__messages.length = 0));
}

async function lastOf<T extends WebviewToHostMessage["type"]>(page: Page, type: T) {
	const all = await messages(page);
	return all.filter((m) => m.type === type).pop() as Extract<WebviewToHostMessage, { type: T }> | undefined;
}

async function waitForGraph(page: Page, predicate: (status: GraphStatus) => boolean = (s) => s.nodes > 0) {
	await expect
		.poll(async () => {
			const status = (await lastOf(page, "status"))?.status;
			return !!status && status.initialised && !status.loading && predicate(status);
		})
		.toBe(true);
	return (await lastOf(page, "status"))!.status;
}

async function open(
	page: Page,
	options: { text?: string; state?: PersistedGraphState | null; config?: Partial<ViewConfig>; theme?: string } = {}
) {
	await page.goto(HARNESS + (options.theme ? `?theme=${options.theme}` : ""));
	await expect.poll(async () => (await messages(page)).some((m) => m.type === "ready")).toBe(true);
	await send(page, {
		type: "init",
		documentUri: "file:///workspace/sample.ttl",
		fileName: "sample.ttl",
		text: options.text ?? SAMPLE_TURTLE,
		state: options.state ?? null,
		defaultSettings: defaultGraphSettings(),
		config: { ...CONFIG, ...options.config }
	});
}

const node = (page: Page, uri: string) => page.locator(`g.node[data-uri="${uri}"]`);

async function translation(page: Page, uri: string): Promise<[number, number]> {
	const transform = await node(page, uri).getAttribute("transform");
	const match = /translate\(([-\d.e]+),\s*([-\d.e]+)\)/.exec(transform ?? "");
	return [Number(match![1]), Number(match![2])];
}

test("renders the sample ontology with OWL-aware node types", async ({ page }) => {
	await open(page);
	const status = await waitForGraph(page);

	expect(status.error).toBeNull();
	await expect(page.locator("g.node")).toHaveCount(status.nodes);
	await expect(page.locator("g.edge")).toHaveCount(status.edges);
	await expect(node(page, EX + "Employee")).toHaveClass(/node-class/);
	await expect(node(page, EX + "worksIn")).toHaveClass(/node-objectProperty/);
	await expect(node(page, EX + "AliceSmith")).toHaveClass(/node-instance/);
	await expect(node(page, EX + "AliceSmith")).toContainText("Alice Smith");
	await expect(page.locator(".status-counts")).toHaveText(`${status.nodes} nodes, ${status.edges} edges`);

	// nodes are spread out by the force layout rather than piled up
	const positions = await page.locator("g.node").evaluateAll((els) => els.map((el) => el.getAttribute("transform")));
	expect(new Set(positions).size).toBe(positions.length);

	// the webview remembers which document it shows, for panel restoration
	expect(await page.evaluate(() => (window as unknown as { __state: unknown }).__state)).toEqual({
		documentUri: "file:///workspace/sample.ttl"
	});
});

test("updates live while keeping the existing layout", async ({ page }) => {
	await open(page);
	const before = await waitForGraph(page);
	const employeeBefore = await translation(page, EX + "Employee");

	await send(page, {
		type: "update",
		text: SAMPLE_TURTLE + "\n\nex:Manager rdf:type owl:Class ;\n    rdfs:subClassOf ex:Employee ."
	});
	await waitForGraph(page, (s) => s.nodes === before.nodes + 1);

	await expect(node(page, EX + "Manager")).toHaveCount(1);
	expect(await translation(page, EX + "Employee")).toEqual(employeeBefore);
});

test("keeps the last valid graph and reports syntax errors", async ({ page }) => {
	await open(page);
	const before = await waitForGraph(page);

	await send(page, { type: "update", text: SAMPLE_TURTLE + "\nex:Broken rdf:type ;" });
	const status = await waitForGraph(page, (s) => s.error !== null);

	expect(status.nodes).toBe(before.nodes);
	expect(status.error).toMatch(/^Line \d+:/);
	await expect(page.locator(".status-error")).toBeVisible();

	await send(page, { type: "update", text: SAMPLE_TURTLE });
	await waitForGraph(page, (s) => s.error === null);
	await expect(page.locator(".status-error")).toHaveCount(0);
});

test("shows an empty state for an invalid new document", async ({ page }) => {
	await open(page, { text: "@prefix ex: <http://e/> .\nex:a ex:b" });
	await expect(page.locator(".empty-state")).toContainText("could not be parsed");
	await expect(page.locator(".status-error")).toBeVisible();
});

test("clicking a node reveals its definition line", async ({ page }) => {
	await open(page);
	await waitForGraph(page);
	await clearMessages(page);

	await node(page, EX + "worksIn")
		.locator(".node-shape")
		.click();

	await expect(node(page, EX + "worksIn")).toHaveClass(/selected/);
	await expect
		.poll(() => lastOf(page, "revealSource"))
		.toEqual({
			type: "revealSource",
			line: lineOf(SAMPLE_TURTLE, "ex:worksIn rdf:type"),
			focusEditor: false
		});

	await node(page, EX + "Department")
		.locator(".node-shape")
		.dblclick();
	await expect
		.poll(() => lastOf(page, "revealSource"))
		.toEqual({
			type: "revealSource",
			line: lineOf(SAMPLE_TURTLE, "ex:Department rdf:type"),
			focusEditor: true
		});
});

test("follows the editor cursor", async ({ page }) => {
	await open(page);
	await waitForGraph(page);

	await send(page, { type: "cursor", line: lineOf(SAMPLE_TURTLE, "rdfs:range ex:Department") });
	await expect(node(page, EX + "worksIn")).toHaveClass(/selected/);
	await expect(page.locator("g.node.selected")).toHaveCount(1);

	await send(page, { type: "revealLine", line: lineOf(SAMPLE_TURTLE, "ex:AliceSmith rdf:type"), requestId: 7 });
	await expect
		.poll(() => lastOf(page, "revealLineResult"))
		.toEqual({ type: "revealLineResult", requestId: 7, found: true });
	await expect(node(page, EX + "AliceSmith")).toHaveClass(/selected/);

	await send(page, { type: "revealLine", line: 1, requestId: 8 });
	await expect
		.poll(() => lastOf(page, "revealLineResult"))
		.toEqual({ type: "revealLineResult", requestId: 8, found: false });
});

test("does not follow the cursor when disabled", async ({ page }) => {
	await open(page, { config: { followCursor: "off" } });
	await waitForGraph(page);
	await send(page, { type: "cursor", line: lineOf(SAMPLE_TURTLE, "ex:worksIn rdf:type") });
	await page.waitForTimeout(200);
	await expect(page.locator("g.node.selected")).toHaveCount(0);
});

test("dragging moves nodes and persists the layout; locking prevents it", async ({ page }) => {
	await open(page);
	await waitForGraph(page);
	const shape = node(page, EX + "Employee").locator(".node-shape");
	const start = await translation(page, EX + "Employee");

	const box = (await shape.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
	await page.mouse.up();

	const moved = await translation(page, EX + "Employee");
	expect(moved[0]).toBeGreaterThan(start[0]);
	expect(moved[1]).toBeGreaterThan(start[1]);
	await expect
		.poll(async () => (await lastOf(page, "saveState"))?.state.positions.find((p) => p.uri === EX + "Employee"))
		.toMatchObject({ x: moved[0], y: moved[1] });

	await page.getByRole("button", { name: "Lock layout" }).click();
	await expect.poll(async () => (await lastOf(page, "saveState"))?.state.locked).toBe(true);

	const lockedBox = (await shape.boundingBox())!;
	await page.mouse.move(lockedBox.x + 10, lockedBox.y + 10);
	await page.mouse.down();
	await page.mouse.move(lockedBox.x + 150, lockedBox.y + 150, { steps: 5 });
	await page.mouse.up();
	expect(await translation(page, EX + "Employee")).toEqual(moved);
});

test("restores a saved layout without re-running the force layout", async ({ page }) => {
	const positions = [
		{ uri: EX + "Employee", x: 10, y: 20 },
		{ uri: EX + "Department", x: 400, y: 20 },
		{ uri: EX + "worksIn", x: 200, y: 200 },
		{ uri: EX + "hasSalary", x: 0, y: 300 },
		{ uri: EX + "internalCode", x: 600, y: 300 },
		{ uri: EX + "SalaryInteger", x: 0, y: 500 },
		{ uri: EX + "EngineeringDept", x: 400, y: 500 },
		{ uri: EX + "AliceSmith", x: 200, y: 400 }
	];
	await open(page, {
		state: { settings: defaultGraphSettings(), locked: true, positions, camera: { x: 5, y: 6, k: 0.75 } }
	});
	await waitForGraph(page);

	expect(await translation(page, EX + "Employee")).toEqual([10, 20]);
	expect(await translation(page, EX + "AliceSmith")).toEqual([200, 400]);
	await expect(page.locator("g.viewport")).toHaveAttribute("transform", "translate(5, 6) scale(0.75)");
	await expect(page.getByRole("button", { name: "Unlock layout" })).toBeVisible();
	expect((await messages(page)).some((m) => m.type === "status" && m.status.loading)).toBe(false);
});

test("graph settings change what is drawn and are persisted", async ({ page }) => {
	await open(page);
	await waitForGraph(page);
	await expect(page.locator("g.node-literal").first()).toBeVisible();

	await page.getByRole("button", { name: "Graph settings" }).click();
	const panel = page.getByRole("complementary", { name: "Graph settings" });
	await expect(panel).toBeVisible();
	await panel.getByLabel("Literal").uncheck();

	await expect(page.locator("g.node-literal")).toHaveCount(0);
	await expect
		.poll(async () => (await lastOf(page, "saveState"))?.state.settings.hiddenEntityTypes)
		.toContain("literal");

	// prefixed names typed into the settings resolve against the document's prefixes
	await panel.getByPlaceholder("http://example.org/ns#").fill("ex:");
	await panel.getByPlaceholder("http://example.org/ns#").press("Enter");
	await expect(page.locator(".empty-state")).toContainText("hidden by the current graph settings");

	await panel.getByRole("button", { name: "Reset to defaults" }).click();
	await expect(node(page, EX + "Employee")).toHaveCount(1);
	await expect(page.locator("g.node-literal").first()).toBeVisible();
});

test("search finds nodes and predicates", async ({ page }) => {
	await open(page);
	await waitForGraph(page);

	await page.locator(".graph-container").focus();
	await page.keyboard.press("Control+f");
	const input = page.getByRole("textbox", { name: "Search nodes and predicates" });
	await expect(input).toBeFocused();

	await input.fill("Department");
	await input.press("Enter");
	await expect(page.locator("g.node.selected")).toHaveCount(1);
	await expect(page.locator(".search-counter")).toHaveText(/^1\/\d+$/);

	await input.fill("worksIn");
	await input.press("Enter"); // node ex:worksIn
	await input.press("Enter"); // edge labelled ex:worksIn
	await expect(page.locator("g.edge.highlighted")).toHaveCount(1);

	await input.fill("no such thing");
	await expect(page.locator(".search-counter")).toHaveText("No results");
	await input.press("Escape");
	await expect(input).toBeHidden();
});

test("exports a standalone SVG and a PNG", async ({ page }) => {
	await open(page, { theme: "dark" });
	await waitForGraph(page);

	await send(page, { type: "command", command: "exportSvg" });
	await expect.poll(async () => (await lastOf(page, "export"))?.format).toBe("svg");
	const svg = (await lastOf(page, "export"))!.data;
	expect(svg).toContain("<svg");
	expect(svg).toContain("Employee");
	expect(svg).not.toContain("var(--");
	expect(svg).not.toContain("color-mix");
	// "light" export theme: the dark palette's text colour must not leak into the export
	expect(svg).toContain("fill: rgb(48, 52, 70)");

	await send(page, { type: "command", command: "exportPng" });
	await expect.poll(async () => (await lastOf(page, "export"))?.format).toBe("png");
	const png = Buffer.from((await lastOf(page, "export"))!.data, "base64");
	expect(png.subarray(1, 4).toString()).toBe("PNG");
	expect(png.length).toBeGreaterThan(5000);
});

test("toolbar zoom and fit adjust the camera", async ({ page }) => {
	await open(page);
	await waitForGraph(page);
	const viewport = page.locator("g.viewport");
	const scale = async () => Number(/scale\(([\d.e-]+)\)/.exec((await viewport.getAttribute("transform")) ?? "")![1]);

	const fitted = await scale();
	await page.getByRole("button", { name: "Zoom in" }).click();
	expect(await scale()).toBeCloseTo(fitted * 1.2, 5);
	await page.getByRole("button", { name: "Fit to view" }).click();
	expect(await scale()).toBeCloseTo(fitted, 5);
});
