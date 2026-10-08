import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { SAMPLE_TURTLE } from "../../src/core/sample";
import { defaultGraphSettings } from "../../src/core/settings";

// Regenerates the README screenshots: SCREENSHOTS=1 npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, "screenshots are only generated on demand");

const HARNESS = pathToFileURL(join(__dirname, "harness.html")).href;
const OUT = join(__dirname, "../../docs/screenshots");

for (const theme of ["light", "dark"]) {
	test(`graph (${theme})`, async ({ page }) => {
		await page.setViewportSize({ width: 1100, height: 680 });
		await page.goto(`${HARNESS}?theme=${theme}`);
		await page.evaluate(
			({ text, settings }) =>
				(window as unknown as { __send: (m: unknown) => void }).__send({
					type: "init",
					documentUri: "file:///sample.ttl",
					fileName: "sample.ttl",
					text,
					state: null,
					defaultSettings: settings,
					config: { followCursor: "highlight", revealLineOnNodeClick: true, exportTheme: "light" }
				}),
			{ text: SAMPLE_TURTLE, settings: defaultGraphSettings() }
		);
		await expect(page.locator(".status-counts")).toHaveText(/nodes/);
		await page.locator('g.node[data-uri="http://example.org/test#worksIn"] .node-shape').click();
		if (theme === "dark") await page.getByRole("button", { name: "Graph settings" }).click();
		await page.screenshot({ path: join(OUT, `graph-${theme}.png`) });
	});
}
