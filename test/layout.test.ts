import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type Component,
	type Focusable,
	ScrollView,
	type Terminal,
	Text,
	TuiAltScreen,
	type TuiInputListener,
	VStack,
} from "@earendil-works/pi-tui";
import { SidebarLayout } from "../src/layout.ts";

class FrameTerminal implements Terminal {
	columns = 140;
	rows = 32;
	kittyProtocolActive = false;
	private input: ((data: string) => void) | undefined;
	private resized: (() => void) | undefined;
	start(input: (data: string) => void, resize: () => void): void {
		this.input = input;
		this.resized = resize;
	}
	stop(): void {
		this.input = undefined;
		this.resized = undefined;
	}
	async drainInput(): Promise<void> {}
	write(): void {}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
	send(data: string): void {
		this.input?.(data);
	}
	resize(width: number, height: number): void {
		this.columns = width;
		this.rows = height;
		this.resized?.();
	}
}

class Editor implements Component, Focusable {
	focused = false;
	width = 0;
	text = "";
	getText(): string {
		return this.text;
	}
	setText(text: string): void {
		this.text = text;
	}
	handleInput(data: string): void {
		this.text += data;
	}
	render(width: number): string[] {
		this.width = width;
		return [this.text];
	}
	invalidate(): void {}
}

function fixture() {
	const terminal = new FrameTerminal();
	const tui = new TuiAltScreen(terminal);
	const transcript = new ScrollView(new Text("line\n".repeat(80), 0, 0), { follow: "end", primary: true });
	const editor = new Editor();
	const widget = new VStack();
	const root = new VStack([
		{ component: transcript, basis: 0, grow: 1 },
		{ component: editor, basis: 3 },
		widget,
		new Text("footer", 0, 0),
	]);
	const inputs: string[] = [];
	const panel = {
		focused: false,
		render: () => ["sessions"],
		invalidate: () => {},
		handleInput: (data: string) => {
			inputs.push(data);
		},
	};
	tui.setLayoutRoot(root);
	tui.setFocus(editor);
	const originalListeners = [...(Reflect.get(tui, "inputListeners") as Set<TuiInputListener>)];
	const layout = new SidebarLayout(
		tui,
		panel,
		() => false,
		(message) => {
			throw new Error(message);
		},
	);
	widget.addChild(layout);
	tui.start();
	tui.renderNow(true);
	return { terminal, tui, transcript, editor, panel, layout, root, inputs, originalListeners };
}

test("sidebar reserves real width without replacing the chat viewport or showing an overlay", (t) => {
	const f = fixture();
	t.after(() => {
		f.layout.dispose();
		f.tui.stop();
	});
	assert.equal(f.editor.width, 98);
	assert.equal(f.tui.hasOverlay(), false);
	const split = Reflect.get(f.tui, "layoutRoot") as VStack;
	assert.equal(split.children[0], f.root);
	assert.ok(f.tui.getScreenLines().some((line) => line.includes("sessions")));
});

test("focused sidebar owns paging while the editor keeps native transcript navigation", (t) => {
	const f = fixture();
	t.after(() => {
		f.layout.dispose();
		f.tui.stop();
	});
	assert.equal(f.layout.focus(), true);
	const before = f.transcript.scrollTop;
	f.terminal.send("\x1b[5~");
	assert.deepEqual(f.inputs, ["\x1b[5~"]);
	assert.equal(f.transcript.scrollTop, before);
	f.layout.unfocus();
	f.terminal.send("\x1b[5~");
	assert.ok(f.transcript.scrollTop < before);
});

test("resize transfers input back to the editor before a repaint", (t) => {
	const f = fixture();
	t.after(() => {
		f.layout.dispose();
		f.tui.stop();
	});
	f.layout.focus();
	f.terminal.resize(80, 24);
	f.terminal.send("draft");
	assert.equal(f.editor.text, "draft");
	assert.deepEqual(f.inputs, []);
	f.tui.renderNow(true);
	assert.equal(f.editor.width, 80);
	assert.equal(f.layout.focus(), false);
	assert.equal(f.panel.focused, false);
});

test("dialogs retain focus and replacing the main editor does not break sidebar focus", (t) => {
	const f = fixture();
	t.after(() => {
		f.layout.dispose();
		f.tui.stop();
	});
	const dialog = new Text("dialog", 0, 0);
	f.tui.setFocus(dialog);
	assert.equal(f.layout.focus(), false);
	assert.equal(f.tui.getFocusedComponent(), dialog);
	const replacement = new Editor();
	f.tui.setFocus(replacement);
	assert.equal(f.layout.focus(), true);
	f.layout.unfocus();
	assert.equal(f.tui.getFocusedComponent(), replacement);
});

test("disposal restores the exact original root and input-listener order", (t) => {
	const f = fixture();
	t.after(() => f.tui.stop());
	f.layout.focus();
	f.layout.dispose();
	f.layout.dispose();
	assert.equal(Reflect.get(f.tui, "layoutRoot"), f.root);
	assert.deepEqual([...(Reflect.get(f.tui, "inputListeners") as Set<TuiInputListener>)], f.originalListeners);
	assert.equal(f.tui.getFocusedComponent(), f.editor);
});

test("unknown stock layout fails without modifying input handling", () => {
	const tui = new TuiAltScreen(new FrameTerminal());
	const before = [...(Reflect.get(tui, "inputListeners") as Set<TuiInputListener>)];
	assert.throws(
		() =>
			new SidebarLayout(
				tui,
				{ focused: false, render: () => [], invalidate: () => {} },
				() => false,
				() => {},
			),
		/unsupported layout/,
	);
	assert.deepEqual([...(Reflect.get(tui, "inputListeners") as Set<TuiInputListener>)], before);
});
