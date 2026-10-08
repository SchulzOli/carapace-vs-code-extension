import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist/**", "out/**", "node_modules/**", ".vscode-test/**", "test-results/**", "playwright-report/**"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: { console: "readonly", setTimeout: "readonly", clearTimeout: "readonly", __dirname: "readonly" }
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			eqeqeq: ["error", "smart"]
		}
	}
);
