import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = resolve(process.env.PI_SIDEBAR_BIN_DIR || join(homedir(), ".local/bin"));
const source = join(root, "scripts/pi.mjs");
const target = join(bin, "pi-session-sidebar");
mkdirSync(bin, { recursive: true });
try {
	symlinkSync(source, target);
} catch (err) {
	if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
	if (!lstatSync(target).isSymbolicLink() || resolve(bin, readlinkSync(target)) !== source) {
		throw new Error(`Refusing to replace existing command: ${target}`, { cause: err });
	}
}
console.log(`Installed: ${target}`);
console.log("Run pi-session-sidebar from your project directory. Your existing pi command is unchanged.");
if (!process.env.PATH?.split(delimiter).includes(bin)) console.log(`Add ${bin} to your PATH before using the command.`);
