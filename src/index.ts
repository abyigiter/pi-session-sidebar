import { access, constants } from "node:fs/promises";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { createSessionLoader } from "./sessions.ts";
import { SessionSidebar } from "./sidebar.ts";

interface SidebarHandle {
	focus(): boolean;
	unfocus(): void;
	isFocused(): boolean;
}

type SidebarUI = ExtensionUIContext & {
	setSidebar?: (
		factory:
			| ((tui: TUI, theme: Theme, keys: KeybindingsManager) => Component & Focusable & { dispose?(): void })
			| undefined,
		options?: { width?: number; minChatWidth?: number },
	) => SidebarHandle | undefined;
};

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
	let handle: SidebarHandle | undefined;
	let visible = true;
	let selectedPath: string | undefined;
	let unsubscribeInput: (() => void) | undefined;

	const mount = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		const ui = ctx.ui as SidebarUI;
		if (!ui.setSidebar) {
			ctx.ui.notify("Pinned sidebar requires the Pi 1.0.0 layout patch. Run pnpm setup:core, then pnpm pi.", "warning");
			return;
		}
		const storage = ctx.sessionManager as ExtensionContext["sessionManager"] & { usesDefaultSessionDir(): boolean };
		handle = ui.setSidebar(
			(tui, theme, keys) => {
				panel = new SessionSidebar({
					tui,
					theme,
					keys,
					load: createSessionLoader(ctx.cwd, storage.getSessionDir(), storage.usesDefaultSessionDir()),
					activePath: ctx.sessionManager.getSessionFile(),
					onUnfocus: () => handle?.unfocus(),
					onSelect: () => {
						selectedPath = panel?.getSelectedSession()?.path;
						handle?.unfocus();
						if (selectedPath) pi.sendUserMessage("/sessions open", { expandPromptTemplates: true });
					},
				});
				return panel;
			},
			{ width: 42, minChatWidth: 60 },
		);
		if (handle) void panel?.refresh();
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (visible) mount(ctx);
		unsubscribeInput = ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, "ctrl+o") || !handle) return undefined;
			if (handle.isFocused()) handle.unfocus();
			else if (handle.focus()) void panel?.refresh();
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
		panel?.dispose();
		panel = undefined;
		handle = undefined;
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
					(ctx.ui as SidebarUI).setSidebar?.(undefined);
					panel = undefined;
					handle = undefined;
					return;
				}
			}
			visible = true;
			if (!handle) mount(ctx);
			if (handle?.isFocused()) {
				handle.unfocus();
			} else if (handle?.focus()) {
				void panel?.refresh();
			} else if (handle) {
				ctx.ui.notify("Sidebar needs fullscreen mode and at least 102 columns by 12 rows.", "info");
			}
		},
	});

	const focusSidebar = () => pi.sendUserMessage("/sessions", { expandPromptTemplates: true });
	pi.registerShortcut("ctrl+shift+s", { description: "Focus the session sidebar", handler: focusSidebar });
}
