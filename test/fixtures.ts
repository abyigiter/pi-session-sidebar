import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export function session(path: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
	return {
		path,
		id: path,
		cwd: "/projects/alpha",
		name: path,
		created: new Date(0),
		modified: new Date(0),
		messageCount: 1,
		firstMessage: "First prompt",
		allMessagesText: "First prompt",
		...overrides,
	};
}
