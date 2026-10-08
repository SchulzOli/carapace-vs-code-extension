import { runTests } from "@vscode/test-electron";
import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

async function main() {
	const root = path.resolve(__dirname, "../../..");
	// a short user-data dir: VS Code puts its IPC socket there, and macOS limits socket paths to ~103 chars
	const userDataDir = mkdtempSync(path.join(os.tmpdir(), "cvt-"));
	try {
		await runTests({
			version: process.env.VSCODE_TEST_VERSION ?? "stable",
			extensionDevelopmentPath: root,
			extensionTestsPath: path.resolve(__dirname, "suite/index"),
			launchArgs: [
				path.join(root, "test/integration/fixtures"),
				"--disable-extensions",
				"--disable-workspace-trust",
				`--user-data-dir=${userDataDir}`
			]
		});
	} catch (error) {
		console.error("Integration tests failed:", error);
		process.exit(1);
	}
}

void main();
