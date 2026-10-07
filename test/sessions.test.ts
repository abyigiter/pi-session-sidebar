import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createSessionLoader, filterSessions, sessionMeta, sessionTitle, singleLine } from "../src/sessions.ts";
import { session } from "./fixtures.ts";

test("session title uses the name, first prompt, then an untitled fallback", () => {
	assert.equal(sessionTitle(session("named")), "named");
	assert.equal(sessionTitle(session("unnamed", { name: " ", firstMessage: "Fix\nthe issue" })), "Fix the issue");
	assert.equal(sessionTitle(session("empty", { name: undefined, firstMessage: "" })), "Untitled session");
	assert.equal(singleLine("\x1b[31mred\x1b[0m\tname"), "red name");
});

test("search matches names, prompts and paths with all terms, without mutating input", () => {
	const sessions = [
		session("old", { name: "Auth", modified: new Date(0) }),
		session("new", { name: "Auth", modified: new Date(60_000) }),
		session("other", { cwd: "/projects/beta" }),
	];
	assert.deepEqual(
		filterSessions(sessions, " ALPHA auth ").map((item) => item.path),
		["new", "old"],
	);
	assert.deepEqual(
		filterSessions(sessions, "first beta").map((item) => item.path),
		["other"],
	);
	assert.equal(filterSessions(sessions, "missing").length, 0);
	assert.deepEqual(
		sessions.map((item) => item.path),
		["old", "new", "other"],
	);
});

test("session loaders respect current-project and custom storage boundaries", async (t) => {
	const current = t.mock.method(SessionManager, "list", async () => []);
	const all = t.mock.method(SessionManager, "listAll", async () => []);
	const signal = new AbortController().signal;
	const progress = () => {};
	await createSessionLoader("/project", "/custom", false)("current", progress, signal);
	assert.deepEqual(current.mock.calls[0]?.arguments, ["/project", "/custom", progress, signal]);
	await createSessionLoader("/project", "/custom", false)("all", progress, signal);
	assert.equal(all.mock.calls[0]?.arguments[0], "/custom");
	await createSessionLoader("/project", "/default/project", true)("all", progress, signal);
	assert.equal(all.mock.calls[1]?.arguments[0], undefined);
});

test("metadata handles minutes, hours, days, future timestamps and missing project paths", () => {
	const now = 10 * 86400_000;
	for (const [delta, age] of [
		[-60_000, "now"],
		[60_000, "1m ago"],
		[3600_000, "1h ago"],
		[86400_000, "1d ago"],
	] as const) {
		assert.equal(sessionMeta(session("test", { modified: new Date(now - delta) }), now), `alpha · ${age}`);
	}
	assert.equal(sessionMeta(session("old", { cwd: "", modified: new Date(now) }), now), "Unknown project · now");
});
