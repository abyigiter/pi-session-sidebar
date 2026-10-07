import {
	type Component,
	type Focusable,
	HStack,
	isKeyRelease,
	isViewportTUI,
	type TUI,
	type TuiInputListener,
} from "@earendil-works/pi-tui";

interface FocusTUI extends TUI {
	getFocusedComponent(): Component | null;
}

function component(value: unknown): value is Component {
	return (
		typeof value === "object" &&
		value !== null &&
		"render" in value &&
		typeof value.render === "function" &&
		"invalidate" in value &&
		typeof value.invalidate === "function"
	);
}

function editor(value: Component | null): boolean {
	return (
		value !== null &&
		typeof Reflect.get(value, "getText") === "function" &&
		typeof Reflect.get(value, "setText") === "function"
	);
}

/** Compose the existing viewport; do not rebuild Pi's transcript or input dock. */
export class SidebarLayout implements Component {
	private readonly tui: FocusTUI;
	private readonly panel: Component & Focusable;
	private readonly isTranscriptSearch: (data: string) => boolean;
	private readonly onError: (message: string) => void;
	private chat: Component | undefined;
	private split: HStack | undefined;
	private editor: Component | null;
	private listeners: Set<TuiInputListener> | undefined;
	private unsubscribe: (() => void) | undefined;
	private queued = false;
	private disposed = false;

	constructor(
		tui: TUI,
		panel: Component & Focusable,
		isTranscriptSearch: (data: string) => boolean,
		onError: (message: string) => void,
	) {
		if (typeof Reflect.get(tui, "getFocusedComponent") !== "function") throw new Error("Pi's focus API is unavailable");
		this.tui = tui as FocusTUI;
		this.panel = panel;
		this.editor = this.tui.getFocusedComponent();
		this.isTranscriptSearch = isTranscriptSearch;
		this.onError = onError;
		this.mount();
	}

	private visible(): boolean {
		return (
			!this.disposed &&
			this.tui.mode === "fullscreen" &&
			this.tui.terminal.columns >= 102 &&
			this.tui.terminal.rows >= 12
		);
	}

	private readonly input: TuiInputListener = (data) => {
		if (!this.panel.focused) return undefined;
		if (!this.visible()) {
			this.unfocus();
			return undefined;
		}
		if (data.startsWith("\x1b[<") || data.startsWith("\x1b[M") || this.isTranscriptSearch(data)) return undefined;
		if (!isKeyRelease(data)) this.panel.handleInput?.(data);
		return { consume: true };
	};

	private mount(): void {
		if (this.disposed || this.tui.mode !== "fullscreen") return;
		if (!isViewportTUI(this.tui)) throw new Error("This Pi version has no compatible fullscreen layout API");
		// Stock Pi exposes setters but not getters or input-listener priority. Guard these two internal fields.
		const root: unknown = Reflect.get(this.tui, "layoutRoot");
		const listeners: unknown = Reflect.get(this.tui, "inputListeners");
		if (
			!component(root) ||
			!(listeners instanceof Set) ||
			[...listeners].some((value: unknown) => typeof value !== "function")
		) {
			throw new Error("This Pi version has an unsupported layout; session sidebar was not mounted");
		}
		if (listeners !== this.listeners) {
			this.unsubscribe?.();
			this.unsubscribe = this.tui.addInputListener(this.input);
			this.listeners = listeners as Set<TuiInputListener>;
			const remaining = [...this.listeners].filter((listener) => listener !== this.input);
			this.listeners.clear();
			this.listeners.add(this.input);
			for (const listener of remaining) this.listeners.add(listener);
		}
		if (root === this.split) return;
		this.chat = root;
		this.split = new HStack([
			{ component: root, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{
				component: this.panel,
				basis: 42,
				grow: 0,
				shrink: 0,
				minSize: 42,
				maxSize: 42,
				visible: () => {
					const visible = this.visible();
					if (!visible) this.unfocus();
					return visible;
				},
			},
		]);
		this.tui.setLayoutRoot(this.split);
		this.tui.requestRender();
	}

	focus(): boolean {
		if (!this.visible() || this.tui.hasOverlay()) return false;
		const focus = this.tui.getFocusedComponent();
		if (focus !== this.panel) {
			if (!editor(focus)) return false;
			this.editor = focus;
		}
		this.mount();
		this.tui.setFocus(this.panel);
		this.tui.requestRender();
		return true;
	}

	unfocus(): void {
		if (!this.panel.focused) return;
		this.tui.setFocus(this.editor);
		this.tui.requestRender();
	}

	isFocused(): boolean {
		return this.panel.focused;
	}

	render(): string[] {
		const focus = this.tui.getFocusedComponent();
		if (editor(focus)) this.editor = focus;
		if (!this.visible()) this.unfocus();
		if (!this.queued && !this.disposed) {
			this.queued = true;
			queueMicrotask(() => {
				this.queued = false;
				try {
					this.mount();
				} catch (err) {
					this.dispose();
					this.onError(err instanceof Error ? err.message : String(err));
				}
			});
		}
		return [];
	}

	invalidate(): void {
		this.panel.invalidate();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unfocus();
		this.unsubscribe?.();
		if (isViewportTUI(this.tui) && Reflect.get(this.tui, "layoutRoot") === this.split) {
			this.tui.setLayoutRoot(this.chat);
			this.tui.requestRender();
		}
	}
}
