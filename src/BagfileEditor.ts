import * as vscode from 'vscode';
import { Disposable, disposeAll } from './dispose';
import { getNonce } from './util';
import * as cp from "child_process";

const execShell = (/** @type {string} */ cmd: string) =>
new Promise<string>((/** @type {(arg0: string) => void} */ resolve, /** @type {(arg0: cp.ExecException) => void} */ reject) => {
		cp.exec(cmd, (err, out) => {
				if (err) {
						return reject(err);
				}
				return resolve(out);
		});
});

interface BagfileDocumentDelegate {
	getFileData(): Promise<Uint8Array>;
}

/**
 * Define the document (the data model) used for paw draw files.
 */
 class BagfileDocument extends Disposable implements vscode.CustomDocument {

	static async create(
		uri: vscode.Uri,
		backupId: string | undefined,
		delegate: BagfileDocumentDelegate,
	): Promise<BagfileDocument | PromiseLike<BagfileDocument>> {
		// If we have a backup, read that. Otherwise read the resource from the workspace
		const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
		const fileData = await BagfileDocument.readFile(dataFile);
		return new BagfileDocument(uri, fileData, delegate);
	}

	private static async readFile(uri: vscode.Uri): Promise<string> {
		if (uri.scheme === 'untitled') {
			return ">>>>>> uri.scheme === 'untitled' <<<<<<";
		}
		// return vscode.workspace.fs.readFile(uri);
		let rosbagInfo = await execShell('rosbag info ' + uri.fsPath);
		return rosbagInfo;
	}

	private readonly _uri: vscode.Uri;

	private _documentData: string;

	private readonly _delegate: BagfileDocumentDelegate;

	private constructor(
		uri: vscode.Uri,
		initialContent: string,
		delegate: BagfileDocumentDelegate
	) {
		super();
		this._uri = uri;
		this._documentData = initialContent;
		this._delegate = delegate;
	}

	public get uri() { return this._uri; }

	public get documentData(): string {
		console.log(">>> documentData()");
		console.log(this._documentData);
		 return this._documentData;
		}

	private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
	/**
	 * Fired when the document is disposed of.
	 */
	public readonly onDidDispose = this._onDidDispose.event;

	/**
	 * Called by VS Code when there are no more references to the document.
	 *
	 * This happens when all editors for it have been closed.
	 */
	dispose(): void {
		this._onDidDispose.fire();
		super.dispose();
	}

}



/**
 * Provider for bagfile editors.
 *
 * bagfile editors are used for `.bag` files, which are just json files.
 * To get started, run this extension and open an empty `.bag` file in VS Code.
 *
 * This provider demonstrates:
 *
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Synchronizing changes between a text document and a custom editor.
 */
export class BagfileEditorProvider implements vscode.CustomReadonlyEditorProvider<BagfileDocument> {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			BagfileEditorProvider.viewType,
			new BagfileEditorProvider(context),
			{
				supportsMultipleEditorsPerDocument: false,
			});
	}

	/**
  * Tracks all known webviews
  */
	private readonly webviews = new WebviewCollection();

	private static readonly viewType = 'bagfileCustoms.bagfile';

	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	async openCustomDocument(
		uri: vscode.Uri,
		openContext: { backupId?: string },
		_token: vscode.CancellationToken
	): Promise<BagfileDocument> {
		const document: BagfileDocument = await BagfileDocument.create(uri, openContext.backupId, {
			getFileData: async () => {
				const webviewsForDocument = Array.from(this.webviews.get(document.uri));
				if (!webviewsForDocument.length) {
					throw new Error('Could not find webview to save for');
				}
				const panel = webviewsForDocument[0];
				const response = await this.postMessageWithResponse<number[]>(panel, 'getFileData', {});
				return new Uint8Array(response);
			}
		});

		const listeners: vscode.Disposable[] = [];

		// listeners.push(document.onDidChange(e => {
		// 	// Tell VS Code that the document has been edited by the use.
		// 	this._onDidChangeCustomDocument.fire({
		// 		document,
		// 		...e,
		// 	});
		// }));

		// listeners.push(document.onDidChangeContent(e => {
		// 	// Update all webviews when the document changes
		// 	for (const webviewPanel of this.webviews.get(document.uri)) {
		// 		this.postMessage(webviewPanel, 'update', {
		// 			edits: e.edits,
		// 			content: e.content,
		// 		});
		// 	}
		// }));

		document.onDidDispose(() => disposeAll(listeners));

		return document;
	}

	/**
	 * Called when our custom editor is opened.
	 *
	 *
	 */
	async resolveCustomEditor(
		document: BagfileDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Add the webview to our internal set of active webviews
		this.webviews.add(document.uri, webviewPanel);

		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));
		// Wait for the webview to be properly ready before we init
		webviewPanel.webview.onDidReceiveMessage(e => {
			if (e.type === 'ready') {
				if (document.uri.scheme === 'untitled') {
					console.log(">>>>>>>>>>>> post untitled");
					this.postMessage(webviewPanel, 'init', {
						untitled: true,
						editable: false,
					});
				} else {
					const editable = vscode.workspace.fs.isWritableFileSystem(document.uri.scheme);
					console.log(">>>>>>>>>>>> post init");
					this.postMessage(webviewPanel, 'init', {
						value: document.documentData,
						editable,
					});
				}
			}
		});
	}

	private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BagfileDocument>>();
	public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

	/**
	 * Get the static html used for the editor webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'bagfile.js'));

		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'reset.css'));

		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'vscode.css'));

		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'bagfile.css'));

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet" />
				<link href="${styleVSCodeUri}" rel="stylesheet" />
				<link href="${styleMainUri}" rel="stylesheet" />

				<title>bagfile</title>
			</head>
			<body>
				<div class="notes">
					<div class="add-button">
						<button>Scratch!</button>
					</div>
				</div>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	private _requestId = 1;
	private readonly _callbacks = new Map<number, (response: any) => void>();

	private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
		const requestId = this._requestId++;
		const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
		panel.webview.postMessage({ type, requestId, body });
		return p;
	}

	private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
		panel.webview.postMessage({ type, body });
	}

	private onMessage(document: BagfileDocument, message: any) {
		switch (message.type) {
			case 'response':
				{
					const callback = this._callbacks.get(message.requestId);
					callback?.(message.body);
					return;
				}
		}
	}

}

/**
 * Tracks all webviews.
 */
 class WebviewCollection {

	private readonly _webviews = new Set<{
		readonly resource: string;
		readonly webviewPanel: vscode.WebviewPanel;
	}>();

	/**
	 * Get all known webviews for a given uri.
	 */
	public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
		const key = uri.toString();
		for (const entry of this._webviews) {
			if (entry.resource === key) {
				yield entry.webviewPanel;
			}
		}
	}

	/**
	 * Add a new webview to the collection.
	 */
	public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
		const entry = { resource: uri.toString(), webviewPanel };
		this._webviews.add(entry);

		webviewPanel.onDidDispose(() => {
			this._webviews.delete(entry);
		});
	}
}
