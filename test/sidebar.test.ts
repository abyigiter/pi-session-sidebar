import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import type { LoadSessions } from "../src/sessions.ts";
import { SessionSidebar } from "../src/sidebar.ts";
import { session } from "./fixtures.ts";

function createSidebar(load: LoadSessions = async () => [session("one"), session("two")]) {
	const terminal = { rows: 24 };
	const events = { selected: 0, unfocused: 0, rendered: 0 };
	const panel = new SessionSidebar({
		tui: {
			terminal,
			requestRender: () => {
				events.rendered++;
			},
		},
		theme: { fg: (_color, text) => text, bold: (text) => text },
		keys: getKeybindings(),
		load,
		activePath: "one",
		onSelect: () => {
			events.selected++;
		},
		onUnfocus: () => {
			events.unfocused++;
		},
	});
	return { panel, terminal, events };
}

test("navigation, search, paste, selection and Escape use the sidebar rather than the editor", async () => {
	const { panel, events } = createSidebar();
	await panel.refresh();
	assert.equal(panel.getSelectedSession()?.path, "one");
	panel.handleInput("\x1b[B");
	assert.equal(panel.getSelectedSession()?.path, "two");
	panel.handleInput("\r");
	assert.equal(events.selected, 1);
	panel.handleInput("\x1b[200~one\x1b[201~");
	assert.equal(panel.getSelectedSession()?.path, "one");
	assert.ok(panel.render(42).some((line) => line.includes("1 sessions")));
	panel.handleInput("\x1b");
	assert.equal(events.unfocused, 1);
});

test("scope switching cancels the old load and ignores its late response", async () => {
	const pending: Array<{ scope: string; signal: AbortSignal; resolve: (value: SessionInfo[]) => void }> = [];
	const { panel } = createSidebar(
		(scope, _progress, signal) =>
			new Promise((resolve) => {
				pending.push({ scope, signal, resolve });
			}),
	);
	const first = panel.refresh();
	panel.handleInput("\t");
	assert.equal(pending[0]?.signal.aborted, true);
	assert.equal(pending[1]?.scope, "all");
	pending[1]?.resolve([session("all-projects")]);
	await new Promise<void>((resolve) => setImmediate(resolve));
	pending[0]?.resolve([session("obsolete")]);
	await first;
	assert.equal(panel.getSelectedSession()?.path, "all-projects");
	assert.ok(panel.render(42).some((line) => line.includes("All projects")));
	panel.dispose();
});

test("empty, no-result and failed loading states are explicit", async () => {
	const empty = createSidebar(async () => []);
	await empty.panel.refresh();
	assert.ok(empty.panel.render(42).some((line) => line.includes("No sessions yet")));
	empty.panel.handleInput("\r");
	assert.equal(empty.events.selected, 0);
	const populated = createSidebar();
	await populated.panel.refresh();
	populated.panel.handleInput("missing");
	assert.ok(populated.panel.render(42).some((line) => line.includes("No matching sessions")));
	const failed = createSidebar(async () => {
		throw new Error("permission denied");
	});
	await failed.panel.refresh();
	assert.ok(failed.panel.render(42).some((line) => line.includes("permission denied")));
});

test("rendering fits terminal columns and height across resize and Unicode names", async () => {
	const { panel, terminal } = createSidebar(async () => [
		session("unicode", { name: `日本語 👨‍👩‍👧‍👦 ${"long".repeat(30)}` }),
	]);
	await panel.refresh();
	panel.focused = true;
	assert.ok(panel.render(42).some((line) => line.includes(CURSOR_MARKER)));
	for (const width of [16, 42, 60]) {
		for (const height of [12, 24, 40]) {
			terminal.rows = height;
			const lines = panel.render(width);
			assert.equal(lines.length, height);
			assert.ok(lines.every((line) => visibleWidth(line) <= width));
			assert.ok(lines.some((line) => line.includes("Enter open")));
		}
	}
});

test("page navigation keeps the selected session visible", async () => {
	const { panel } = createSidebar(async () =>
		Array.from({ length: 30 }, (_, index) => session(String(index).padStart(2, "0"))),
	);
	await panel.refresh();
	panel.handleInput("\x1b[6~");
	const selected = panel.getSelectedSession();
	assert.equal(selected?.path, "05");
	assert.ok(panel.render(42).some((line) => line.includes("›") && line.includes("05")));
	panel.handleInput("\x1b[5~");
	assert.equal(panel.getSelectedSession()?.path, "00");
});

test("disposing cancels loading and prevents late renders", async () => {
	let signal: AbortSignal | undefined;
	let finish: ((sessions: SessionInfo[]) => void) | undefined;
	const { panel, events } = createSidebar((_scope, _progress, currentSignal) => {
		signal = currentSignal;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const loading = panel.refresh();
	panel.dispose();
	panel.dispose();
	const renders = events.rendered;
	assert.equal(signal?.aborted, true);
	finish?.([session("late")]);
	await loading;
	await panel.refresh();
	assert.equal(events.rendered, renders);
	assert.equal(panel.getSelectedSession(), undefined);
});
