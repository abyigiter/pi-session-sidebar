import type { KeybindingsManager, SessionInfo, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	matchesKey,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { filterSessions, type LoadSessions, type Scope, sessionMeta, sessionTitle } from "./sessions.ts";

type SidebarTUI = Pick<TUI, "requestRender"> & { terminal: Pick<TUI["terminal"], "rows"> };
type SidebarTheme = Pick<Theme, "fg" | "bold">;

export class SessionSidebar implements Component, Focusable {
	readonly captureViewportInput = true;
	private readonly input: Input;
	private readonly tui: SidebarTUI;
	private readonly theme: SidebarTheme;
	private readonly keys: Pick<KeybindingsManager, "matches">;
	private readonly load: LoadSessions;
	private readonly onSelect: () => void;
	private readonly onUnfocus: () => void;
	private readonly activePath: string | undefined;
	private sessions: readonly SessionInfo[] = [];
	private filtered: SessionInfo[] = [];
	private selected = 0;
	private scope: Scope = "current";
	private status = "Loading sessions…";
	private controller: AbortController | undefined;
	private disposed = false;
	private startIndex = 0;

	constructor(options: {
		tui: SidebarTUI;
		theme: SidebarTheme;
		keys: Pick<KeybindingsManager, "matches">;
		load: LoadSessions;
		activePath?: string;
		onSelect: () => void;
		onUnfocus: () => void;
	}) {
		this.tui = options.tui;
		this.theme = options.theme;
		this.keys = options.keys;
		this.load = options.load;
		this.activePath = options.activePath;
		this.onSelect = options.onSelect;
		this.onUnfocus = options.onUnfocus;
		this.input = new Input({
			prompt: "> ",
			placeholder: "Search sessions…",
			placeholderStyle: (text) => this.theme.fg("muted", text),
		});
	}

	get focused(): boolean {
		return this.input.focused;
	}
	set focused(value: boolean) {
		this.input.focused = value;
	}

	getSelectedSession(): SessionInfo | undefined {
		return this.filtered[this.selected];
	}

	async refresh(): Promise<void> {
		if (this.disposed) return;
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		this.status = "Loading sessions…";
		this.tui.requestRender();
		const update = (sessions: readonly SessionInfo[]) => {
			const selectedPath = this.getSelectedSession()?.path;
			this.sessions = sessions;
			this.filtered = filterSessions(sessions, this.input.getValue());
			const index = this.filtered.findIndex((session) => session.path === selectedPath);
			this.selected = Math.max(0, index);
		};
		try {
			const sessions = await this.load(
				this.scope,
				(loaded, total, partial) => {
					if (controller.signal.aborted || this.disposed) return;
					if (partial) update(partial);
					this.status = `Loading ${loaded}/${total}…`;
					this.tui.requestRender();
				},
				controller.signal,
			);
			if (controller.signal.aborted || this.disposed) return;
			update(sessions);
			this.status = "";
		} catch (err) {
			if (controller.signal.aborted || this.disposed) return;
			this.status = `Load failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			if (!controller.signal.aborted && !this.disposed) this.tui.requestRender();
		}
	}

	handleInput(data: string): void {
		if (
			this.keys.matches(data, "tui.select.cancel") ||
			matchesKey(data, "ctrl+o") ||
			matchesKey(data, "ctrl+shift+s")
		) {
			this.onUnfocus();
		} else if (this.keys.matches(data, "tui.input.tab")) {
			this.scope = this.scope === "current" ? "all" : "current";
			this.sessions = [];
			this.filtered = [];
			this.selected = 0;
			void this.refresh();
		} else if (this.keys.matches(data, "tui.select.confirm")) {
			if (this.getSelectedSession()) this.onSelect();
		} else if (this.keys.matches(data, "tui.select.up")) {
			this.selected = Math.max(0, this.selected - 1);
		} else if (this.keys.matches(data, "tui.select.down")) {
			this.selected = Math.min(Math.max(0, this.filtered.length - 1), this.selected + 1);
		} else if (this.keys.matches(data, "tui.select.pageUp")) {
			this.selected = Math.max(0, this.selected - this.pageSize());
		} else if (this.keys.matches(data, "tui.select.pageDown")) {
			this.selected = Math.min(Math.max(0, this.filtered.length - 1), this.selected + this.pageSize());
		} else {
			const previous = this.input.getValue();
			this.input.handleInput(data);
			if (this.input.getValue() !== previous) {
				this.filtered = filterSessions(this.sessions, this.input.getValue());
				this.selected = 0;
			}
		}
		this.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			this.selected = Math.max(0, Math.min(this.filtered.length - 1, this.selected + Math.sign(event.wheelDelta)));
			return { handled: true, render: true };
		}
		if (event.type === "press" && event.button === "left") {
			if (event.y >= 4 && event.y < 4 + this.pageSize() * 3) {
				const index = this.startIndex + Math.floor((event.y - 4) / 3);
				if (index < this.filtered.length) this.selected = index;
			}
			return { handled: true, focus: true };
		}
		return undefined;
	}

	private pageSize(): number {
		return Math.max(1, Math.floor((this.tui.terminal.rows - 7) / 3));
	}

	render(width: number): string[] {
		const inner = Math.max(0, width - 3);
		const height = this.tui.terminal.rows;
		const lines = [
			this.theme.bold(this.theme.fg(this.focused ? "accent" : "text", "Sessions")),
			this.theme.fg("muted", this.scope === "current" ? "Current project" : "All projects"),
			...this.input.render(inner),
			"",
		];
		const count = this.pageSize();
		this.startIndex = Math.max(0, Math.min(this.selected - Math.floor(count / 2), this.filtered.length - count));
		for (let index = this.startIndex; index < Math.min(this.filtered.length, this.startIndex + count); index++) {
			const session = this.filtered[index];
			if (!session) continue;
			const selected = index === this.selected;
			const marker = session.path === this.activePath ? "● " : "  ";
			const title = `${selected ? "› " : "  "}${marker}${sessionTitle(session)}`;
			lines.push(selected ? this.theme.fg("accent", title) : title);
			lines.push(this.theme.fg("muted", `    ${sessionMeta(session)}`));
			lines.push("");
		}
		if (this.filtered.length === 0) {
			lines.push(
				this.theme.fg("muted", this.status || (this.sessions.length ? "No matching sessions" : "No sessions yet")),
			);
		}
		while (lines.length < height - 2) lines.push("");
		lines.push(this.theme.fg("muted", this.status || `${this.filtered.length} sessions · Tab scope`));
		lines.push(this.theme.fg("muted", "Enter open · Esc back"));
		return lines.slice(0, height).map((line) => {
			const content = truncateToWidth(line, inner, "…");
			return `${this.theme.fg("border", "│")} ${content}${" ".repeat(Math.max(0, width - 2 - visibleWidth(content)))}`;
		});
	}

	invalidate(): void {
		this.input.invalidate();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.controller?.abort();
	}
}
