import type MarkdownIt from "markdown-it";
import { isSpace } from "markdown-it/lib/common/utils";
import Renderer from "markdown-it/lib/renderer";
import StateBlock from "markdown-it/lib/rules_block/state_block";
import Token from "markdown-it/lib/token";


export const defaultOptions = {
	/** The CSS class for the tree container */
	cssClassTree: "mdi-tree",

	/** The CSS class for the root element */
	cssClassRoot: "mdi-tree-root",

	/** The CSS class for tree nodes */
	cssClassNode: "mdi-tree-node",

	/** The CSS class for leaf nodes */
	cssClassLeaf: "mdi-tree-leaf"
};

export type MarkdownItTreeListOptions = typeof defaultOptions;

const PLUS_MARKER = 43;
const MINUS_MARKER = 45;
const LIST_MARKER = "+--";

function renderTreelist(tokens: Token[], idx: number, _options: any, env: any, self: any) {
	return self.renderToken(tokens, idx, _options, env, self);
}

function renderListItem(tokens: Token[], idx: number, options: any, env: any, self: Renderer) {
	const token = tokens[idx];
	const title = self.renderInline(token.children ?? [], options, env);
	return `<li><span class="${token.attrGet("class")}">${title}</span>`;
}

function hasMarker(state: StateBlock, start: number) {
	return state.src.charCodeAt(start) === PLUS_MARKER &&
		   state.src.charCodeAt(start + 1) === MINUS_MARKER &&
		   state.src.charCodeAt(start + 2) === MINUS_MARKER;
}

/**
 * Checks the current line for a list marker and skips it.
 * Returns the position of the next character or -1 if no marker was found.
 */
function skipListMarker(state: StateBlock, startLine: number) {
	let pos = state.bMarks[startLine] + state.tShift[startLine];
	const max = state.eMarks[startLine];

	if (!hasMarker(state, pos)) return -1;

	pos += 3;
	if (pos < max && !isSpace(state.src.charCodeAt(pos))) return -1;

	return pos + 1;
}

function parseTreelist(options: MarkdownItTreeListOptions) {
	return (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
		let pos = 0;
		let nextLine = startLine;
		let start = state.bMarks[startLine] + state.tShift[startLine];

		// If it's indented more than 3 spaces, it should be a code block
		if (state.sCount[nextLine] - state.blkIndent >= 4) return false;

		// First line must be a root element without marker
		if (hasMarker(state, start)) return false;

		// Search for marker +-- on the next line
		nextLine++;
		pos = skipListMarker(state, nextLine);
		if (pos < 0) return false;

		// First-level nodes must not be indented
		if (state.sCount[nextLine] - state.blkIndent > 0) return false;

		// In validation mode, report success
		if (silent) return true;

		// Create token for the tree
		// <div class="tree">
		let token = state.push("tree_open", "div", 1);
		token.attrs = [["class", options.cssClassTree]];

		// Create tokens for the root element
		// <ul>
		//   <li>
		//     <span class="tree_root">...</span>    <-- until here
		//   </li>
		// </ul>

		token = state.push("treelist_open", "ul", 1);
		token = state.push("treelist_root_item_open", "li", 1);
		token = state.push("treelist_root", "span", 1);
		token.attrs = [["class", options.cssClassRoot]];
		token = state.push("inline", "", 0);
		token.children = [];
		state.md.inline.parse(state.src.slice(start, state.eMarks[startLine]), state.md, state.env, token.children);
		token = state.push("treelist_root_close", "span", -1);

		nextLine = parseSublist(state, nextLine, endLine);

		token.map = [startLine, nextLine];

		token = state.push("treelist_subtree_close", "ul", -1);
		
		token = state.push("treelist_root_item_close", "li", -1);
		token = state.push("treelist_close", "ul", -1);
		token = state.push("tree_close", "div", -1);
		token.markup = LIST_MARKER;
		token.block = true;
		token.map = [nextLine, nextLine];
		state.line++;

		return true;
	}

	function parseSublist(state: StateBlock, line: number, endLine: number, currentIndent = 0) {
		let token = state.push("treelist_subtree_open", "ul", 1);
		token.map = [line, 0];
		token.markup = LIST_MARKER;
	
		while (line < endLine) {
			// +-- item
			// ^ skip marker
			let pos = skipListMarker(state, line);
			if (pos < 0) return -1;
	
			const nextLine = line + 1;
			const nextLineIndent = state.tShift[nextLine] - state.blkIndent;
			let isEndOfList = false;
	
			if (nextLineIndent > currentIndent) {
				createListItem(state, line, pos, options.cssClassNode);
	
				// Indentation increased, create a new subtree
				line = parseSublist(state, nextLine, endLine, nextLineIndent);
				if (line < 0) isEndOfList = true;
	
				state.push("treelist_item_close", "li", -1);
			}
			else if (nextLineIndent === currentIndent) {
				// Same indentation, add a new item
				createListItem(state, line, pos, options.cssClassLeaf);
				state.push("treelist_item_close", "li", -1);
			}
			else {
				// Indentation decreased, close subtree
				createListItem(state, line, pos, options.cssClassLeaf);
				state.push("treelist_item_close", "li", -1);
	
				isEndOfList = true;
			}
	
			state.line++;
	
			if (isEndOfList) {
				token.map[1] = line;
				token = state.push("treelist_subtree_close", "ul", -1);
				token.markup = LIST_MARKER;
				token.block = true;
				return line;
			}
	
			line++;
		}
	
		return -1;
	}
}

function createListItem(state: StateBlock, line: number, pos: number, className: string) {
	const token = state.push("treelist_item_open", "li", 1);
	token.attrs = [["class", className]];
	token.map = [line, line + 1];
	token.markup = LIST_MARKER;
	token.children = [];

	// Parse inline content
	const content = state.src.slice(pos, state.eMarks[line]);
	state.md.inline.parse(content, state.md, state.env, token.children);

	return token;
}

/**
 * A markdown-it plugin, which adds markup for lists with a tree-like structure.
 * @param md The markdown-it instance
 * @param options The options for the plugin
 */
export default function treelist_plugin(md: MarkdownIt, options: MarkdownItTreeListOptions) {
	options = Object.assign({}, defaultOptions, options);

	md.block.ruler.after("list", "treelist", parseTreelist(options));
	md.renderer.rules.treelist_open = renderTreelist;
	md.renderer.rules.treelist_item_open = renderListItem;
};