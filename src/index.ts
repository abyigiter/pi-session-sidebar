import { access, constants } from "node:fs/promises";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings, matchesKey } from "@earendil-works/pi-tui";
import { SidebarLayout } from "./layout.ts";
import { createSessionLoader } from "./sessions.ts";
import { SessionSidebar } from "./sidebar.ts";

const WIDGET = "session-sidebar-layout";

type ResumeContext = Pick<ExtensionCommandContext, "isIdle" | "hasPendingMessages" | "switchSession"> & {
	ui: Pick<ExtensionUIContext, "notify" | "confirm" | "getEditorText">;
	sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionFile">;
};

export async function resumeSession(ctx: ResumeContext, path: string): Promise<void> {
	if (path === ctx.sessionManager.getSessionFile()) return;
	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		ctx.ui.notify("Finish or cancel the current work before switching sessions.", "warning");
		return;
	}
	try {
		await access(path, constants.R_OK);
	} catch {
		ctx.ui.notify("Session is no longer readable. Refresh the sidebar with /sessions.", "warning");
		return;
	}
	if (ctx.ui.getEditorText().trim() && !(await ctx.ui.confirm("Switch session?", "Discard the current text draft?")))
		return;
	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		ctx.ui.notify("Work was queued while confirming. Session switch cancelled.", "warning");
		return;
	}
	await ctx.switchSession(path);
}

export default function sessionSidebar(pi: ExtensionAPI): void {
	let panel: SessionSidebar | undefined;
	let layout: SidebarLayout | undefined;
	let visible = true;
	let selectedPath: string | undefined;
	let unsubscribeInput: (() => void) | undefined;

	const mount = (ctx: ExtensionContext): void => {
		ctx.ui.setWidget(
			WIDGET,
			(tui, _theme) => {
				const piKeys = getKeybindings();
				panel = new SessionSidebar({
					tui,
					theme: { fg: (token, text) => ctx.ui.theme.fg(token, text), bold: (text) => ctx.ui.theme.bold(text) },
					keys: piKeys,
					load: createSessionLoader(
						ctx.cwd,
						ctx.sessionManager.getSessionDir(),
						(
							ctx.sessionManager as ExtensionContext["sessionManager"] & { usesDefaultSessionDir(): boolean }
						).usesDefaultSessionDir(),
					),
					activePath: ctx.sessionManager.getSessionFile(),
					onUnfocus: () => layout?.unfocus(),
					onSelect: () => {
						selectedPath = panel?.getSelectedSession()?.path;
						layout?.unfocus();
						if (selectedPath) pi.sendUserMessage("/sessions open", { expandPromptTemplates: true });
					},
				});
				try {
					layout = new SidebarLayout(
						tui,
						panel,
						(data) => piKeys.matches(data, "tui.altScreen.search"),
						(message) => {
							panel?.dispose();
							layout = undefined;
							ctx.ui.notify(message, "warning");
						},
					);
					void panel.refresh();
					return layout;
				} catch (err) {
					panel.dispose();
					layout = undefined;
					ctx.ui.notify(err instanceof Error ? err.message : String(err), "warning");
					return { render: () => [], invalidate: () => {} };
				}
			},
			{ placement: "belowEditor" },
		);
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (visible) mount(ctx);
		unsubscribeInput = ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, "ctrl+o") || !layout) return undefined;
			if (layout.isFocused()) layout.unfocus();
			else if (layout.focus()) void panel?.refresh();
			else return undefined;
			return { consume: true };
		});
	});
	pi.on("session_info_changed", () => {
		void panel?.refresh();
	});
	pi.on("agent_settled", () => {
		void panel?.refresh();
	});
	pi.on("session_shutdown", () => {
		unsubscribeInput?.();
		unsubscribeInput = undefined;
		layout?.dispose();
		panel?.dispose();
		panel = undefined;
		layout = undefined;
		selectedPath = undefined;
	});

	pi.registerCommand("sessions", {
		description: "Focus the pinned session sidebar (toggle to hide/show)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			if (args.trim() === "open") {
				const path = selectedPath;
				selectedPath = undefined;
				if (path) await resumeSession(ctx, path);
				return;
			}
			if (args.trim() === "toggle") {
				visible = !visible;
				if (!visible) {
					ctx.ui.setWidget(WIDGET, undefined);
					panel?.dispose();
					panel = undefined;
					layout = undefined;
					return;
				}
			}
			visible = true;
			if (!layout) mount(ctx);
			if (layout?.isFocused()) layout.unfocus();
			else if (layout?.focus()) void panel?.refresh();
			else if (layout) ctx.ui.notify("Sidebar needs fullscreen mode and at least 102 columns by 12 rows.", "info");
		},
	});
	pi.registerShortcut("ctrl+shift+s", {
		description: "Focus the session sidebar",
		handler: () => pi.sendUserMessage("/sessions", { expandPromptTemplates: true }),
	});
}
