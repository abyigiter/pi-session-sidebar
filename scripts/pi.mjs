import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = resolve(process.env.PI_SIDEBAR_CORE || join(root, ".pi-core"));
const resolver = join(core, "packages/coding-agent/src/experimental/source-resolver.ts");
if (!existsSync(resolver)) throw new Error("Patched Pi source is missing. Run pnpm setup:core first.");
const child = spawn(
	process.execPath,
	[
		"--import",
		pathToFileURL(resolver).href,
		join(core, "packages/coding-agent/src/experimental/cli.ts"),
		"--extension",
		join(root, "src/index.ts"),
		...process.argv.slice(2),
	],
	{ stdio: "inherit", env: process.env },
);
child.on("error", (err) => {
	console.error(err.message);
	process.exitCode = 1;
});
child.on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	else process.exitCode = code ?? 1;
});
