import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = resolve(process.env.PI_SIDEBAR_CORE || join(root, ".pi-core"));
if (!existsSync(join(core, "pi-test.sh"))) throw new Error("Run pnpm setup:core before test:tui.");
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "pi-sidebar-tui-")));
const agentDir = join(temporary, "agent");
const project = join(temporary, "project-a");
const otherProject = join(temporary, "project-b");
const server = `pi-sidebar-${process.pid}`;
const sessionName = "sidebar-test";
const pidFile = join(temporary, "pi.pid");
mkdirSync(agentDir);
mkdirSync(project);
mkdirSync(otherProject);
let themeName = "dark";
if (process.env.PI_SIDEBAR_TEST_THEME) {
	const theme = JSON.parse(readFileSync(process.env.PI_SIDEBAR_TEST_THEME, "utf8"));
	assert.ok(typeof theme.name === "string" && /^[a-zA-Z0-9_-]+$/.test(theme.name));
	themeName = theme.name;
	mkdirSync(join(agentDir, "themes"));
	writeFileSync(join(agentDir, "themes", `${themeName}.json`), JSON.stringify(theme));
}
writeFileSync(
	join(agentDir, "settings.json"),
	JSON.stringify({
		theme: themeName,
		quietStartup: true,
		defaultProjectTrust: "always",
		enableAnalytics: false,
		enableInstallTelemetry: false,
	}),
);
writeFileSync(join(agentDir, "keybindings.json"), JSON.stringify({ "app.tools.expand": [] }));

function seed(cwd, name) {
	const id = randomUUID();
	const directory = join(agentDir, "sessions", `--${cwd.replace(/^\//, "").replace(/[\\/:]/g, "-")}--`);
	mkdirSync(directory, { recursive: true });
	const timestamp = "2026-01-01T00:00:00.000Z";
	const path = join(directory, `${timestamp.replaceAll(":", "-")}_${id}.jsonl`);
	const entries = [
		{ type: "session", version: 3, id, timestamp, cwd },
		{ type: "session_info", id: "name", parentId: null, timestamp, name },
		{
			type: "message",
			id: "prompt",
			parentId: "name",
			timestamp,
			message: { role: "user", content: `Saved prompt for ${name}`, timestamp: 0 },
		},
	];
	writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	return path;
}
const target = seed(project, "Fix auth redirect");
seed(project, "日本語 long session title for resize testing");
seed(otherProject, "Dashboard filters");

function tmux(...args) {
	const result = spawnSync("tmux", ["-L", server, ...args], { encoding: "utf8" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`tmux ${args[0]}: ${result.stderr}`);
	return result.stdout;
}
const capture = () => tmux("capture-pane", "-t", sessionName, "-p");
const cursorColumn = () => Number(tmux("display-message", "-p", "-t", sessionName, "#{cursor_x}").trim());
const key = (...keys) => {
	tmux("send-keys", "-t", sessionName, ...keys);
	// Bare Escape must resolve before subsequent text can be mistaken for Alt+key.
	if (keys.includes("Escape")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
};
const literal = (text) => tmux("send-keys", "-t", sessionName, "-l", text);
async function waitFor(predicate, label) {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const screen = capture();
		if (predicate(screen)) return screen;
		await setTimeout(100);
	}
	throw new Error(`${label}\n${capture()}`);
}
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
const command = [
	"env",
	`PI_CODING_AGENT_DIR=${agentDir}`,
	`PI_SIDEBAR_CORE=${core}`,
	`PI_SIDEBAR_TEST_PID_FILE=${pidFile}`,
	...(process.env.PI_SIDEBAR_TEST_LAUNCHER
		? [process.env.PI_SIDEBAR_TEST_LAUNCHER]
		: [process.execPath, join(root, "scripts/pi.mjs")]),
	"--no-extensions",
	"--extension",
	join(root, "test/faux-provider.ts"),
	"--provider",
	"sidebar-test",
	"--model",
	"test",
	"--name",
	"Current test session",
]
	.map(quote)
	.join(" ");

try {
	tmux("new-session", "-d", "-s", sessionName, "-x", "140", "-y", "32", "-c", project, command);
	let screen = await waitFor(
		(text) => text.includes("Sessions") && text.includes("Fix auth redirect"),
		"Sidebar did not mount",
	);
	assert.ok(screen.split("\n").filter((line) => line.includes("│")).length >= 25);
	console.log("PASS pinned sidebar mounts without replacing the editor");

	literal("unsent draft");
	key("C-o");
	literal("auth");
	screen = await waitFor(
		(text) => text.includes("> auth") && text.includes("1 sessions"),
		"Sidebar search did not filter",
	);
	assert.ok(screen.includes("unsent draft"));
	key("Escape");
	await setTimeout(150);
	literal(" still here");
	await waitFor(
		(text) => text.includes("unsent draft still here"),
		"Editor draft did not redraw after returning focus",
	);
	assert.equal(readdirSync(dirname(target)).filter((name) => name.endsWith(".jsonl")).length, 2);
	console.log("PASS Ctrl+O search and Escape preserve the editor draft without starting a model turn");

	key("C-o", "Enter");
	await waitFor((text) => text.includes("Discard the current text draft?"), "Draft confirmation did not appear");
	key("Escape");
	await waitFor((text) => text.includes("unsent draft still here"), "Cancelled switch lost the draft");
	console.log("PASS switching with a draft requires confirmation");

	key("C-u");
	literal("hello sidebar");
	key("Enter");
	screen = await waitFor(
		(text) => text.includes("Transcript content") && !text.includes("SIDEBAR_REPLY"),
		"Streaming response did not render",
	);
	assert.ok(screen.includes("Sessions"));
	key("C-o", "Enter");
	await waitFor((text) => text.includes("Finish or cancel the current work"), "Busy session switch was not blocked");
	await waitFor((text) => text.includes("SIDEBAR_REPLY") && !text.includes("to interrupt"), "Agent did not settle");
	console.log("PASS pinned sidebar remains visible during streaming and blocks busy session switches");

	key("C-o", "C-u");
	literal("auth");
	await waitFor((text) => text.includes("1 sessions"), "Target search did not recover");
	key("Enter");
	screen = await waitFor(
		(text) => text.includes("Saved prompt for Fix auth redirect") && text.includes("● Fix auth redirect"),
		"Session was not resumed",
	);
	assert.ok(readFileSync(target, "utf8").includes("Saved prompt for Fix auth redirect"));
	console.log("PASS session switching remounts the sidebar with the active marker");

	key("C-o", "C-u", "Tab");
	literal("Dashboard");
	screen = await waitFor(
		(text) => text.includes("All projects") && text.includes("Dashboard filters"),
		"All-project scope did not load",
	);
	assert.ok(screen.includes("project-b"));
	key("Enter");
	await waitFor(
		(text) => text.includes("Saved prompt for Dashboard filters") && text.includes("● Dashboard filters"),
		"Cross-project resume failed",
	);
	console.log("PASS all-project search and cross-project resume");

	key("C-o");
	await waitFor(() => cursorColumn() >= 98, "Sidebar did not receive focus before resize");
	const piPid = Number(readFileSync(pidFile, "utf8").trim());
	assert.ok(Number.isSafeInteger(piPid) && piPid > 1 && piPid !== process.pid);
	process.kill(piPid, "SIGSTOP");
	try {
		tmux("resize-window", "-t", sessionName, "-x", "80", "-y", "24");
		// tmux can clip the sidebar before Pi handles resize or transfers focus.
		assert.ok(!capture().includes("Enter open"));
		assert.ok(cursorColumn() >= 10, "Clipped tmux output incorrectly indicated editor focus");
	} finally {
		process.kill(piPid, "SIGCONT");
	}
	await waitFor(
		(text) => !text.includes("Enter open") && cursorColumn() < 10,
		"Pi did not render the narrow layout and return focus to the editor",
	);
	literal("draft after resize");
	await waitFor((text) => text.includes("draft after resize"), "Editor draft did not redraw after resize");
	tmux("resize-window", "-t", sessionName, "-x", "140", "-y", "32");
	await waitFor(
		(text) => text.includes("Sessions") && text.includes("draft after resize"),
		"Resize did not restore layout",
	);
	console.log("PASS resize collapses the sidebar and returns focus to the editor");

	key("C-u");
	literal("/sessions toggle");
	key("Enter");
	await waitFor((text) => !text.includes("Enter open"), "Hide did not remove sidebar");
	literal("/sessions toggle");
	key("Enter");
	await waitFor((text) => text.includes("Enter open"), "Show did not remount sidebar");
	key("Escape");
	literal("/reload");
	key("Enter");
	await waitFor((text) => text.includes("Reloaded"), "Reload did not complete");
	screen = await waitFor((text) => text.includes("Sessions"), "Reload lost sidebar");
	assert.equal(screen.split("Sessions").length - 1, 1);
	console.log("PASS hide/show and reload do not duplicate the sidebar");

	key("C-u");
	literal("/settings");
	key("Enter");
	await waitFor((text) => text.includes("Auto-compact"), "Settings selector did not open");
	key("C-o");
	literal("auto");
	await waitFor((text) => text.includes("> auto") && text.includes("Auto-compact"), "Sidebar stole settings input");
	key("Escape");
	await waitFor((text) => !text.includes("Type to search"), "Settings dialog did not close");
	console.log("PASS existing settings dialog remains usable beside the sidebar");

	literal("/settings");
	key("Enter");
	literal("tui mode");
	await waitFor((text) => text.includes("TUI mode"), "TUI mode setting did not filter");
	key("Enter");
	await waitFor((text) => text.includes("TUI mode: regular"), "Regular mode did not activate");
	key("Escape");
	await waitFor((text) => !text.includes("Type to search"), "Settings did not close in regular mode");
	literal("regular mode draft");
	await waitFor(
		(text) => text.includes("regular mode draft") && !text.includes("Enter open"),
		"Regular mode editor is broken",
	);
	key("C-u");
	literal("/settings");
	key("Enter");
	literal("tui mode");
	key("Enter");
	await waitFor(
		(text) => text.includes("TUI mode: fullscreen") && text.includes("Enter open"),
		"Fullscreen mode did not restore sidebar",
	);
	key("Escape");
	await waitFor((text) => !text.includes("Type to search"), "Settings did not close after changing renderer");
	key("C-o");
	literal("Dashboard");
	await waitFor(
		(text) => text.includes("> Dashboard") && text.includes("1 sessions"),
		"Sidebar input broke after renderer replacement",
	);
	console.log("PASS regular mode and returning to fullscreen preserve a working editor and sidebar");
} finally {
	spawnSync("tmux", ["-L", server, "kill-server"], { stdio: "ignore" });
	rmSync(temporary, { recursive: true, force: true });
}
