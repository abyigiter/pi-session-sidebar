import { basename } from "node:path";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

export type Scope = "current" | "all";
export type LoadSessions = (
	scope: Scope,
	onProgress: (loaded: number, total: number, partial?: readonly SessionInfo[]) => void,
	signal: AbortSignal,
) => Promise<SessionInfo[]>;

export function createSessionLoader(cwd: string, sessionDir: string, defaultStorage: boolean): LoadSessions {
	return (scope, onProgress, signal) =>
		scope === "current"
			? SessionManager.list(cwd, sessionDir, onProgress, signal)
			: SessionManager.listAll(defaultStorage ? undefined : sessionDir, onProgress, signal);
}

export function singleLine(text: string): string {
	return stripTerminalSequences(text)
		.replace(/[\r\n\t]+/g, " ")
		.trim();
}

export function sessionTitle(session: SessionInfo): string {
	return singleLine(session.name?.trim() || session.firstMessage) || "Untitled session";
}

export function filterSessions(sessions: readonly SessionInfo[], query: string): SessionInfo[] {
	const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
	return sessions
		.filter((session) => {
			const text = `${session.name ?? ""} ${session.firstMessage} ${session.cwd}`.toLocaleLowerCase();
			return words.every((word) => text.includes(word));
		})
		.sort((a, b) => b.modified.getTime() - a.modified.getTime() || a.path.localeCompare(b.path));
}

export function sessionMeta(session: SessionInfo, now = Date.now()): string {
	const minutes = Math.max(0, Math.floor((now - session.modified.getTime()) / 60_000));
	const age =
		minutes < 1
			? "now"
			: minutes < 60
				? `${minutes}m ago`
				: minutes < 1440
					? `${Math.floor(minutes / 60)}h ago`
					: `${Math.floor(minutes / 1440)}d ago`;
	return `${singleLine(basename(session.cwd)) || "Unknown project"} · ${age}`;
}
