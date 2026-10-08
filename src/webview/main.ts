import type { HostToWebviewMessage, WebviewSavedState, WebviewToHostMessage } from "../shared/protocol";
import { GraphView } from "./graphView";

declare function acquireVsCodeApi(): {
	postMessage(message: WebviewToHostMessage): void;
	getState(): WebviewSavedState | undefined;
	setState(state: WebviewSavedState): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById("app") ?? document.body;
const view = new GraphView(root, (message) => vscode.postMessage(message));

window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
	const message = event.data;
	if (!message || typeof message !== "object" || typeof message.type !== "string") return;
	if (message.type === "init") vscode.setState({ documentUri: message.documentUri });
	view.handleMessage(message);
});

vscode.postMessage({ type: "ready" });
