// Sparse-clones the Turtle 1.1 and 1.2 suites of https://github.com/w3c/rdf-tests into .w3c-rdf-tests/.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const target = ".w3c-rdf-tests";
const git = (...args) => execFileSync("git", args, { stdio: "inherit" });

if (!existsSync(target)) {
	git(
		"clone",
		"--quiet",
		"--depth",
		"1",
		"--filter=blob:none",
		"--sparse",
		"https://github.com/w3c/rdf-tests",
		target
	);
}
git("-C", target, "sparse-checkout", "set", "rdf/rdf11/rdf-turtle", "rdf/rdf12/rdf-turtle");
