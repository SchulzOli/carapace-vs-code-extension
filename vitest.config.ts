import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// the real `vscode` module only exists inside VS Code; unit tests use a small fake
		alias: { vscode: fileURLToPath(new URL("./test/unit/vscodeFake.ts", import.meta.url)) }
	},
	test: {
		include: ["test/unit/**/*.test.ts"],
		environment: "node"
	}
});
