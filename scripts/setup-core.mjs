import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = resolve(process.env.PI_SIDEBAR_CORE || join(root, ".pi-core"));
const revision = "a13d35a742c6ef8462812a28fbe1d8c8b7431c32";
const patch = join(root, "patches/pi-1.0.0-sidebar.patch");

function run(command, args, cwd = root) {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

if (!existsSync(core)) {
	run("git", ["clone", "--depth", "1", "--branch", "v1.0.0", "https://github.com/earendil-works/pi.git", core]);
	run("git", ["switch", "-c", "feat/session-sidebar"], core);
}
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: core, encoding: "utf8" });
if (head.status !== 0 || head.stdout.trim() !== revision)
	throw new Error("Core checkout must be the pinned Pi v1.0.0 revision.");
const applied = spawnSync("git", ["apply", "--reverse", "--check", patch], { cwd: core, stdio: "ignore" });
if (applied.status !== 0) {
	const status = spawnSync("git", ["status", "--porcelain"], { cwd: core, encoding: "utf8" });
	if (status.status !== 0 || status.stdout.trim()) throw new Error("Refusing to patch a dirty Pi checkout.");
	run("git", ["apply", "--check", patch], core);
	run("git", ["apply", patch], core);
}
run("npm", ["ci", "--ignore-scripts"], core);
const temporary = mkdtempSync(join(tmpdir(), "pi-sidebar-models-"));
try {
	run(
		"npm",
		["pack", "@earendil-works/pi-ai@1.0.0", "--ignore-scripts", "--pack-destination", temporary, "--loglevel=error"],
		core,
	);
	run("tar", ["-xzf", join(temporary, "earendil-works-pi-ai-1.0.0.tgz"), "-C", temporary]);
	// Release data must match the source revision, not today's provider catalogs.
	cpSync(join(temporary, "package/dist/providers/data"), join(core, "packages/ai/src/providers/data"), {
		recursive: true,
	});
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
console.log("Sidebar core ready. Run pnpm pi, or node scripts/pi.mjs from another project.");
