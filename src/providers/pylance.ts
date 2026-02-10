import * as vscode from 'vscode';
import { Position, TextDocument } from 'vscode';
import { niceguiToQuasarMap } from './data';

export interface TextDocumentPositionParams {
	textDocument: { uri: string };
	position: Position;
}

export class PylanceAdapter {
	pylance = vscode.extensions.getExtension('ms-python.vscode-pylance');

	private normalize_hover_contents(contents: unknown): string | null {
		if (!contents) {
			return null;
		}
		if (typeof contents === 'string') {
			return contents;
		}
		if (Array.isArray(contents)) {
			const parts: string[] = [];
			for (const part of contents) {
				if (typeof part === 'string') {
					parts.push(part);
					continue;
				}
				if (
					part !== null &&
					typeof part === 'object' &&
					'value' in part &&
					typeof (part as { value: unknown }).value === 'string'
				) {
					parts.push((part as { value: string }).value);
				}
			}
			return parts.length > 0 ? parts.join('\n') : null;
		}
		if (
			contents !== null &&
			typeof contents === 'object' &&
			'value' in contents &&
			typeof (contents as { value: unknown }).value === 'string'
		) {
			return (contents as { value: string }).value;
		}
		return null;
	}

	private first_match(body: string, patterns: RegExp[]): string | null {
		for (const pattern of patterns) {
			const match = body.match(pattern);
			if (match?.[1]) {
				return match[1];
			}
		}
		return null;
	}

	async get_client() {
		if (!this.pylance?.isActive) {
			return null;
		}
		return await this.pylance.exports.client.getClient();
	}

	async send_request(method: string, params) {
		if (!this.pylance?.isActive) {
			return null;
		}
		const client = await this.pylance.exports.client.getClient();

		return await client._connection.sendRequest(method, params);
	}

	async request_hover(document: TextDocument, position: Position): Promise<string | null> {
		const location: TextDocumentPositionParams = {
			textDocument: { uri: document.uri.toString() },
			position: position,
		};
		const response = await this.send_request('textDocument/hover', location);
		return this.normalize_hover_contents(response?.contents);
	}

	async request_type(document: TextDocument, position: Position): Promise<string | null> {
		if (!this.pylance?.isActive) {
			return null;
		}
		const client = await this.pylance.exports.client.getClient();

		const response = await client._connection.sendRequest('textDocument/typeDefinition', {
			textDocument: { uri: document.uri.toString() },
			position: {
				line: position.line,
				character: position.character,
			},
		});
		return response;
	}

	async determine_class(document: TextDocument, kind: string, offset: number): Promise<string | null> {
		const possibleClass = await this._determine_class(document, kind, offset);
		if (!possibleClass) {
			return null;
		}

		// Prefer exact mappings extracted from installed NiceGUI.
		const mappedClass = niceguiToQuasarMap[possibleClass];
		if (mappedClass) {
			return mappedClass;
		}

		// Fallback for unmapped classes.
		let className = `Q${possibleClass}`;
		className = className.replace('Button', 'Btn');
		className = className.replace('Image', 'Img');
		return className.toLowerCase();
	}

	async _determine_class(document: TextDocument, kind: string, offset: number) {
		if (['classes', 'props', 'style', 'events'].includes(kind)) {
			const body = await this.request_hover(document, document.positionAt(offset + 1));
			if (!body) {
				return null;
			}
			if (['classes', 'props', 'style'].includes(kind)) {
				return this.first_match(body, [
					/\(property\)\s+(?:classes|props|style):\s+(?:Classes|Props|Style)\[(?:Self@)?([\w_]+)\]/,
					/(?:classes|props|style):\s+(?:Classes|Props|Style)\[(?:Self@)?([\w_]+)\]/,
					/(?:classes|props|style):\s+\w*\[(?:Self@)?([\w_]+)\]/,
				]);
			}
			if (['events'].includes(kind)) {
				return this.first_match(body, [
					/\(method\)\s+def on\([^\)]*\)\s*->\s*([\w_]+)/m,
					/def on\([^\)]*\)\s*->\s*([\w_]+)/m,
				]);
			}
		}

		// TODO: fix this awful mess
		const body1 = await this.request_hover(document, document.positionAt(offset - 1));
		// log.debug("body1", body1);
		if (body1) {
			const variableClass = this.first_match(body1, [
				/\(variable\)\s+[\w_]*:\s+([\w_]+)/,
				/\(variable\)\s+[\w_]*:\s+[\w_]+\[([\w_]+)\]/,
				/:\s+([\w_]+)$/,
			]);
			// log.debug("match1", match);
			if (variableClass) {
				return variableClass;
			}
		}

		const body2 = await this.request_hover(document, document.positionAt(offset - 3));
		// log.debug("body2", body2);
		if (body2) {
			const classMatch = this.first_match(body2, [
				/class\s+([\w_]+)\(/,
				/->\s+([\w_]+)/,
			]);
			// log.debug("match2", match);
			if (classMatch) {
				return classMatch;
			}
		}
		return null;
	}
}
