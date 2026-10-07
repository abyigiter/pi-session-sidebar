import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agent = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent");
const directory = resolve(process.env.PI_SIDEBAR_EXTENSION_DIR || join(agent, "extensions"));
const source = join(root, "src");
const target = join(directory, "pi-session-sidebar");
mkdirSync(directory, { recursive: true });
try {
	symlinkSync(source, target);
} catch (err) {
	if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
	if (!lstatSync(target).isSymbolicLink() || resolve(directory, readlinkSync(target)) !== source) {
		throw new Error(`Refusing to replace existing extension: ${target}`, { cause: err });
	}
}
console.log(`Installed extension: ${target}`);
console.log("Run normal pi, or /reload in an existing session. No launcher or Pi files were changed.");
