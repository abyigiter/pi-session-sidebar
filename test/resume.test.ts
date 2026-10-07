import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resumeSession } from "../src/index.ts";

test("session switching protects active work, unreadable sessions and drafts", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "pi-sidebar-resume-"));
	const path = join(directory, "target.jsonl");
	await writeFile(path, "{}\n");
	t.after(async () => {
		await unlink(path);
		await rmdir(directory);
	});

	const state = {
		idle: true,
		pending: false,
		draft: "",
		confirmed: true,
		confirms: 0,
		switches: 0,
		messages: [] as string[],
	};
	const ctx = {
		isIdle: () => state.idle,
		hasPendingMessages: () => state.pending,
		sessionManager: { getSessionFile: () => "current" },
		ui: {
			notify: (message: string) => {
				state.messages.push(message);
			},
			getEditorText: () => state.draft,
			confirm: async () => {
				state.confirms++;
				return state.confirmed;
			},
		},
		switchSession: async () => {
			state.switches++;
			return { cancelled: false };
		},
	};

	await t.test("busy work and pending messages block switching", async () => {
		state.idle = false;
		await resumeSession(ctx, path);
		state.idle = true;
		state.pending = true;
		await resumeSession(ctx, path);
		state.pending = false;
		assert.equal(state.switches, 0);
		assert.equal(state.confirms, 0);
	});
	await t.test("current or unreadable sessions do not switch", async () => {
		await resumeSession(ctx, "current");
		await resumeSession(ctx, join(directory, "missing.jsonl"));
		assert.equal(state.switches, 0);
		assert.ok(state.messages.some((message) => message.includes("no longer readable")));
	});
	await t.test("rejecting confirmation preserves the text draft", async () => {
		state.draft = "unsent work";
		state.confirmed = false;
		await resumeSession(ctx, path);
		assert.equal(state.draft, "unsent work");
		assert.equal(state.switches, 0);
	});
	await t.test("confirmed drafts switch through the host API", async () => {
		state.confirmed = true;
		await resumeSession(ctx, path);
		assert.equal(state.switches, 1);
	});
	await t.test("work queued during confirmation cancels switching", async () => {
		const queued = {
			...ctx,
			ui: {
				...ctx.ui,
				confirm: async () => {
					state.pending = true;
					return true;
				},
			},
		};
		await resumeSession(queued, path);
		state.pending = false;
		assert.equal(state.switches, 1);
	});
	await t.test("switch cancellation does not clear the text draft", async () => {
		await resumeSession({ ...ctx, switchSession: async () => ({ cancelled: true }) }, path);
		assert.equal(state.draft, "unsent work");
	});
});
