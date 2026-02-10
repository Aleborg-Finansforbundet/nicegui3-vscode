import * as vscode from 'vscode';
import {
	CancellationToken,
	CompletionContext,
	CompletionItem,
	CompletionItemKind,
	CompletionItemLabel,
	CompletionItemProvider,
	CompletionList,
	ExtensionContext,
	MarkdownString,
	Position,
	Range,
	SnippetString,
	TextDocument,
} from 'vscode';
import { createLogger } from '../utils';
import {
	QuasarAttribute,
	flatten,
	materialIcons,
	niceguiFunctions,
	quasarData,
	quasarLists,
	tailwindClasses,
} from './data';
import { capture_document_context } from './doc_utils';
import { PylanceAdapter } from './pylance';

const log = createLogger('completions');

const cssProperties = [
	'align-content',
	'align-items',
	'align-self',
	'animation',
	'background',
	'background-color',
	'background-image',
	'background-position',
	'background-repeat',
	'background-size',
	'border',
	'border-color',
	'border-radius',
	'border-style',
	'border-width',
	'bottom',
	'box-shadow',
	'box-sizing',
	'color',
	'cursor',
	'display',
	'flex',
	'flex-basis',
	'flex-direction',
	'flex-flow',
	'flex-grow',
	'flex-shrink',
	'flex-wrap',
	'font',
	'font-family',
	'font-size',
	'font-style',
	'font-weight',
	'gap',
	'grid',
	'grid-area',
	'grid-auto-columns',
	'grid-auto-flow',
	'grid-auto-rows',
	'grid-column',
	'grid-row',
	'grid-template',
	'grid-template-areas',
	'grid-template-columns',
	'grid-template-rows',
	'height',
	'justify-content',
	'left',
	'letter-spacing',
	'line-height',
	'list-style',
	'margin',
	'margin-bottom',
	'margin-left',
	'margin-right',
	'margin-top',
	'max-height',
	'max-width',
	'min-height',
	'min-width',
	'opacity',
	'overflow',
	'overflow-x',
	'overflow-y',
	'padding',
	'padding-bottom',
	'padding-left',
	'padding-right',
	'padding-top',
	'pointer-events',
	'position',
	'right',
	'text-align',
	'text-decoration',
	'text-overflow',
	'text-transform',
	'top',
	'transform',
	'transition',
	'user-select',
	'vertical-align',
	'visibility',
	'white-space',
	'width',
	'word-break',
	'z-index',
];

const commonCssValues = ['inherit', 'initial', 'unset', 'revert', 'auto', 'none'];

const cssPropertyValues: Record<string, string[]> = {
	'align-items': ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
	'align-self': ['auto', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
	'box-sizing': ['content-box', 'border-box'],
	cursor: ['pointer', 'default', 'text', 'move', 'not-allowed', 'grab', 'wait'],
	display: ['block', 'inline', 'inline-block', 'flex', 'grid', 'none'],
	'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
	'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
	'font-weight': ['normal', 'bold', 'lighter', 'bolder', '100', '300', '400', '500', '700'],
	'justify-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
	overflow: ['visible', 'hidden', 'scroll', 'auto'],
	'overflow-x': ['visible', 'hidden', 'scroll', 'auto'],
	'overflow-y': ['visible', 'hidden', 'scroll', 'auto'],
	'pointer-events': ['auto', 'none'],
	position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
	'text-align': ['left', 'center', 'right', 'justify'],
	'text-decoration': ['none', 'underline', 'line-through', 'overline'],
	'text-overflow': ['clip', 'ellipsis'],
	'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
	'user-select': ['auto', 'none', 'text', 'all'],
	visibility: ['visible', 'hidden', 'collapse'],
	'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'],
};

function build_completions(list: string[], word: string, wordRange: Range) {
	const items: CompletionItem[] = [];
	for (const possible of list) {
		if (word === '') {
			items.push(new CompletionItem(possible));
		} else if (possible.includes(word)) {
			const item = new CompletionItem(possible);
			item.range = wordRange;
			items.push(item);
		}
	}
	return items;
}

function capture_ui_function_context(document: TextDocument, position: Position) {
	const prefix = document.getText().slice(0, document.offsetAt(position));
	const result = prefix.match(/\bui\.(\w*)$/);
	if (!result) {
		return null;
	}

	const word = result[1] ?? '';
	const start = position.translate(0, -word.length);
	const wordRange = new Range(start, position);

	return { word, wordRange };
}

function build_style_completions(document: TextDocument, position: Position, surround: string, surroundRange: Range) {
	const stringStartOffset = document.offsetAt(surroundRange.start);
	const cursorOffset = document.offsetAt(position);
	const inStringOffset = Math.max(0, Math.min(cursorOffset - stringStartOffset, surround.length));
	const beforeCursor = surround.slice(0, inStringOffset);

	const splitOffset = Math.max(beforeCursor.lastIndexOf(';'), beforeCursor.lastIndexOf('\n'));
	const segment = beforeCursor.slice(splitOffset + 1);
	const colonIndex = segment.indexOf(':');

	if (colonIndex === -1) {
		const rawProperty = segment;
		const typedProperty = rawProperty.trimStart();
		const lowerTyped = typedProperty.toLowerCase();
		const propertyStartOffset = cursorOffset - typedProperty.length;
		const propertyRange = new Range(document.positionAt(propertyStartOffset), position);

		const items: CompletionItem[] = [];
		for (const property of cssProperties) {
			if (typedProperty === '' || property.includes(lowerTyped)) {
				const item = new CompletionItem(property, CompletionItemKind.Property);
				item.insertText = `${property}: `;
				item.range = propertyRange;
				items.push(item);
			}
		}
		return items;
	}

	const propertyName = segment.slice(0, colonIndex).trim().toLowerCase();
	const rawValue = segment.slice(colonIndex + 1);
	const typedValue = rawValue.trimStart();
	const lowerTyped = typedValue.toLowerCase();
	const valueStartOffset = cursorOffset - typedValue.length;
	const valueRange = new Range(document.positionAt(valueStartOffset), position);
	const values = cssPropertyValues[propertyName] ?? commonCssValues;

	const items: CompletionItem[] = [];
	for (const value of values) {
		if (typedValue === '' || value.includes(lowerTyped)) {
			const item = new CompletionItem(value, CompletionItemKind.Value);
			item.range = valueRange;
			items.push(item);
		}
	}
	return items;
}

export class NiceGuiCompletionItemProvider implements CompletionItemProvider {
	pylance = new PylanceAdapter();

	constructor(private context: ExtensionContext) {
		const selector = [{ language: 'python', scheme: 'file' }];
		this.context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, this));
	}

	async provideCompletionItems(
		document: TextDocument,
		position: Position,
		token: CancellationToken,
		context: CompletionContext,
	): Promise<CompletionItem[] | CompletionList<CompletionItem>> {
		// log.debug('----- provideCompletionItems -----');

		const uiContext = capture_ui_function_context(document, position);
		if (uiContext) {
			const items = build_completions(niceguiFunctions, uiContext.word, uiContext.wordRange);
			for (const item of items) {
				item.kind = CompletionItemKind.Function;
			}
			return items;
		}

		const ctx = capture_document_context(document, position);
		// log.debug('context:', ctx);

		if (!ctx) {
			return undefined;
		}

		if (ctx.kind === 'icons') {
			const items = [];
			for (const icon of materialIcons) {
				const item = new CompletionItem(icon);
				items.push(item);
			}
			return items;
		}

		// ironically, "classes" doesn't rely on knowing the class
		if (ctx.kind === 'classes') {
			if (ctx.surround === null) {
				return undefined;
			}
			return build_completions(tailwindClasses, ctx.word, ctx.wordRange);
		}

		if (ctx.kind === 'style') {
			if (ctx.surround === null || !ctx.surroundRange) {
				return undefined;
			}
			return build_style_completions(document, position, ctx.surround, ctx.surroundRange);
		}

		const offset = document.offsetAt(position) - ctx.result[0].length;
		const className = await this.pylance.determine_class(document, ctx.kind, offset);

		function build_item(name: string, attr: QuasarAttribute) {
			const label: CompletionItemLabel = {
				label: name,
				// detail: '',
				// description: '',
			};
			label.description = flatten(attr.type, ' | ');

			// log.debug(data.returns, data.params, data.returns !== undefined);
			if (attr.params !== undefined && attr.returns !== undefined) {
				let params = 'void';
				if (attr.params !== null) {
					// const _params: string[] = [];
					// for (const [param, body] of Object.entries(data.params)) {
					// 	const type = flatten(body.type, " | ");
					// 	const p = `${param}: ${type}`;
					// 	_params.push(p);
					// }

					// params = _params.join(", ");
					params = Object.keys(attr.params).join(', ');
				}
				let returns = 'void';
				if (attr.returns !== null) {
					returns = Object.keys(attr.returns).join(', ');
				}
				label.description = `(${params}) => ${returns}`;
			} else if (attr.params !== undefined) {
				let params = 'void';
				if (attr.returns !== null) {
					params = Object.keys(attr.params).join(', ');
				}
				label.description = `(${params})`;
			}

			const item = new CompletionItem(label);

			if (ctx.kind === 'slots' && name.includes('[')) {
				const insert = new SnippetString();
				const parts = name.split('[');
				insert.appendText(parts[0]);
				insert.appendPlaceholder(`[${parts[1]}`);
				item.insertText = insert;
			}

			if (ctx.kind === 'props' && attr.type !== 'Boolean') {
				const insert = new SnippetString();
				insert.appendText(`${name}=`);
				if (attr.values) {
					insert.appendChoice(attr.values.map((v) => v.slice(1, -1)));
				}
				item.insertText = insert;
			}

			const doc = new MarkdownString();
			doc.appendText(attr.desc);
			if (attr.examples) {
				let mk = '\n\n---\n\n';
				mk += 'Examples:\n';
				for (const ex of attr.examples) {
					mk += ` - ${ex.replace('#', '\\#')}\n`;
				}
				doc.appendMarkdown(mk);
			}
			if (attr.values) {
				let mk = '\n\n---\n\n';
				mk += 'Values:\n\n';
				for (const val of attr.values) {
					mk += ` - ${val.replace('#', '\\#')}\n`;
				}
				mk += '\n';
				doc.appendMarkdown(mk);
			}
			item.documentation = doc;
			if (ctx.word !== '') {
				item.range = ctx.wordRange;
			}
			return item;
		}

		const items = [];

		const classData = quasarData[className];

		function build_items(kind: 'props' | 'slots' | 'events' | 'methods') {
			if (ctx.word.includes('=')) {
				const word = ctx.word.split('=')[0];
				if (['icon', 'icon-right'].includes(word)) {
					for (const icon of materialIcons) {
						const item = new CompletionItem(icon);
						items.push(item);
					}
					return;
				}
				const attr = classData?.[kind]?.[word];
				if (!attr) {
					return;
				}
				for (const value of attr.values ?? []) {
					const item = new CompletionItem(value.slice(1, -1));
					items.push(item);
				}
				return;
			}
			for (const [name, attr] of Object.entries(classData[kind] ?? {})) {
				if (attr.internal) {
					continue;
				}
				if (ctx.word === '' || name.includes(ctx.word)) {
					const item = build_item(name, attr);
					items.push(item);
				}
			}
		}

		if (classData) {
			// log.debug('using quasar metadata');
			build_items(ctx.kind);
		} else {
			// log.debug('using full lists');
			items.push(...build_completions(quasarLists[ctx.kind], ctx.word, ctx.wordRange));
		}

		// log.debug("found ", items.length);
		return items;
	}
}
