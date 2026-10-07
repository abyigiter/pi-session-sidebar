import { writeFileSync } from "node:fs";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	const faux = registerFauxProvider({
		provider: "sidebar-test",
		api: "sidebar-test-api",
		models: [{ id: "test" }],
		tokensPerSecond: 150,
	});
	faux.setResponses(
		Array.from({ length: 8 }, () => () => fauxAssistantMessage(`${"Transcript content\n".repeat(45)}SIDEBAR_REPLY`)),
	);
	const model = faux.getModel();
	pi.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "local-test-only",
		api: faux.api,
		models: faux.models,
	});
	pi.on("session_start", () => {
		const pidFile = process.env.PI_SIDEBAR_TEST_PID_FILE;
		if (pidFile) writeFileSync(pidFile, `${process.pid}\n`);
	});
	pi.on("session_shutdown", () => faux.unregister());
}
