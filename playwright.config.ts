import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "test/webview",
	timeout: 30_000,
	fullyParallel: true,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		browserName: "chromium",
		viewport: { width: 1280, height: 800 },
		trace: "retain-on-failure"
	}
});
