// @ts-check

// Script run within the webview itself.
(function () {

	// Get a reference to the VS Code webview api.
	// We use this API to post messages back to our extension.

	// @ts-ignore
	const vscode = acquireVsCodeApi();


	const notesContainer = /** @type {HTMLElement} */ (document.querySelector('.notes'));

	const errorContainer = document.createElement('div');
	document.body.appendChild(errorContainer);
	errorContainer.className = 'error';
	errorContainer.style.display = 'none';

	/**
	 * Render the document in the webview.
	 */
function updateContent(/** @type {string} */ fileContent) {
		console.log('function updateContent');
		console.log(fileContent);
		try {
			if (!fileContent) {
				fileContent = '{}';
			}
		} catch {
			notesContainer.style.display = 'none';
			errorContainer.innerText = 'Error: Document is not valid.';
			errorContainer.style.display = '';
			return;
		}
		notesContainer.style.display = '';
		errorContainer.style.display = 'none';

		// Render the scratches
		notesContainer.innerHTML = '';

		const text = document.createElement('div');
		// text.className = 'text';
		text.innerText = fileContent;
		notesContainer.appendChild(text);


		// for (const line of fileContent.split("/n") || []) {
		// 	const element = document.createElement('div');
		// 	element.className = 'note';
		// 	notesContainer.appendChild(element);

		// 	const text = document.createElement('div');
		// 	text.className = 'text';
		// 	const textContent = document.createElement('span');
		// 	textContent.innerText = line;
		// 	text.appendChild(textContent);
		// 	element.appendChild(text);

		// 	// const deleteButton = document.createElement('button');
		// 	// deleteButton.className = 'delete-button';
		// 	// deleteButton.addEventListener('click', () => {
		// 	// 	vscode.postMessage({ type: 'delete', id: line.id, });
		// 	// });
		// 	// element.appendChild(deleteButton);
		// }

	}

	// Handle messages sent from the extension to the webview
	window.addEventListener('message', event => {
		const message = event.data; // The json data that the extension sent
		switch (message.type) {
			case 'init' || 'update':
				console.log("!!!!");
				console.log(message);
				const text = message.body.value;

				// Update our webview's content
				updateContent(text);

				// Then persist state information.
				// This state is returned in the call to `vscode.getState` below when a webview is reloaded.
				vscode.setState({ text });

				return;
		}
	});

	// Webviews are normally torn down when not visible and re-created when they become visible again.
	// State lets us save information across these re-loads
	const state = vscode.getState();
	if (state) {
		updateContent(state.text);
	}

	// Signal to VS Code that the webview is initialized.
	vscode.postMessage({ type: 'ready' });
}());