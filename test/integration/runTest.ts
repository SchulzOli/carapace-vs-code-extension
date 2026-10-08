import { runTests } from "@vscode/test-electron";
import * as path from "node:path";

async function main() {
	const root = path.resolve(__dirname, "../../..");
	try {
		await runTests({
			version: process.env.VSCODE_TEST_VERSION ?? "stable",
			extensionDevelopmentPath: root,
			extensionTestsPath: path.resolve(__dirname, "suite/index"),
			launchArgs: [
				path.join(root, "test/integration/fixtures"),
				"--disable-extensions",
				"--disable-workspace-trust"
			]
		});
	} catch (error) {
		console.error("Integration tests failed:", error);
		process.exit(1);
	}
}

void main();
