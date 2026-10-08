import * as vscode from "vscode";

function nonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let result = "";
	for (let i = 0; i < 32; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
	return result;
}

export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, title: string): string {
	const asset = (...path: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", ...path));
	const scriptNonce = nonce();
	const csp = [
		"default-src 'none'",
		`img-src ${webview.cspSource} data: blob:`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`font-src ${webview.cspSource}`,
		`script-src 'nonce-${scriptNonce}'`
	].join("; ");

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${asset("codicons", "codicon.css")}">
	<link rel="stylesheet" href="${asset("webview-styles.css")}">
	<title>${escapeHtml(title)}</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${scriptNonce}" src="${asset("webview.js")}"></script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
