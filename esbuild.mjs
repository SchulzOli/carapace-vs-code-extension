import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const common = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	logLevel: "info",
	legalComments: "linked"
};

/** @type {import("esbuild").BuildOptions[]} */
const builds = [
	{
		...common,
		entryPoints: [join(root, "src/extension/extension.ts")],
		outfile: join(root, "dist/extension.js"),
		platform: "node",
		format: "cjs",
		target: "node20",
		external: ["vscode"]
	},
	{
		...common,
		entryPoints: {
			webview: join(root, "src/webview/main.ts"),
			"webview-styles": join(root, "src/webview/styles.css")
		},
		outdir: join(root, "dist"),
		platform: "browser",
		format: "iife",
		target: "chrome120",
		define: { "process.env.NODE_ENV": production ? '"production"' : '"development"' }
	}
];

function copyCodicons() {
	const source = join(root, "node_modules/@vscode/codicons/dist");
	const target = join(root, "dist/codicons");
	mkdirSync(target, { recursive: true });
	cpSync(join(source, "codicon.css"), join(target, "codicon.css"));
	cpSync(join(source, "codicon.ttf"), join(target, "codicon.ttf"));
}

copyCodicons();

if (watch) {
	const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
	await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
	await Promise.all(builds.map((options) => esbuild.build(options)));
}
