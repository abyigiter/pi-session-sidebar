import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("../scripts/install-local.mjs", import.meta.url));
const source = fileURLToPath(new URL("../src", import.meta.url));
function install(directory: string) {
	return spawnSync(process.execPath, [installer], {
		env: { ...process.env, PI_SIDEBAR_EXTENSION_DIR: directory },
		encoding: "utf8",
	});
}

test("local installation registers an auto-discovered extension and can be repeated", (t) => {
	const temporary = mkdtempSync(join(tmpdir(), "pi-sidebar-install-"));
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	const directory = join(temporary, "extensions");
	const target = join(directory, "pi-session-sidebar");
	assert.equal(install(directory).status, 0);
	assert.ok(lstatSync(target).isSymbolicLink());
	assert.equal(resolve(directory, readlinkSync(target)), source);
	assert.equal(install(directory).status, 0);
});

test("local installation refuses to replace an existing extension file", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-sidebar-install-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const target = join(directory, "pi-session-sidebar");
	writeFileSync(target, "existing extension");
	const result = install(directory);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Refusing to replace existing extension/);
	assert.equal(readFileSync(target, "utf8"), "existing extension");
});

test("local installation refuses to replace a different or dangling extension symlink", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-sidebar-install-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const target = join(directory, "pi-session-sidebar");
	symlinkSync("missing-extension", target);
	const result = install(directory);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Refusing to replace existing extension/);
	assert.equal(readlinkSync(target), "missing-extension");
});
