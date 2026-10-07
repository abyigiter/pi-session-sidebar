import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("../scripts/install-local.mjs", import.meta.url));
const launcher = fileURLToPath(new URL("../scripts/pi.mjs", import.meta.url));

function install(directory: string) {
	return spawnSync(process.execPath, [installer], {
		env: { ...process.env, PI_SIDEBAR_BIN_DIR: directory },
		encoding: "utf8",
	});
}

test("local installation creates a runnable symlink and can be repeated", (t) => {
	const temporary = mkdtempSync(join(tmpdir(), "pi-sidebar-install-"));
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	const bin = join(temporary, "bin");
	const command = join(bin, "pi-session-sidebar");
	assert.equal(install(bin).status, 0);
	assert.ok(lstatSync(command).isSymbolicLink());
	assert.equal(resolve(bin, readlinkSync(command)), launcher);
	assert.ok(lstatSync(launcher).mode & 0o111);
	assert.equal(install(bin).status, 0);
});

test("local installation refuses to replace an existing executable", (t) => {
	const bin = mkdtempSync(join(tmpdir(), "pi-sidebar-install-"));
	t.after(() => rmSync(bin, { recursive: true, force: true }));
	const command = join(bin, "pi-session-sidebar");
	writeFileSync(command, "existing command");
	const result = install(bin);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Refusing to replace existing command/);
	assert.equal(readFileSync(command, "utf8"), "existing command");
});

test("local installation refuses to replace a different or dangling symlink", (t) => {
	const bin = mkdtempSync(join(tmpdir(), "pi-sidebar-install-"));
	t.after(() => rmSync(bin, { recursive: true, force: true }));
	const command = join(bin, "pi-session-sidebar");
	symlinkSync("missing-launcher", command);
	const result = install(bin);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Refusing to replace existing command/);
	assert.equal(readlinkSync(command), "missing-launcher");
});
