import { entityTypeLabel } from "./entity";
import {
	NODE_BADGE_FONT_SIZE,
	NODE_BADGE_PADDING_X,
	NODE_BODY_FONT_SIZE,
	NODE_BORDER_WIDTH,
	NODE_CONTENT_PADDING_X,
	NODE_CONTENT_PADDING_Y,
	NODE_HEADER_FONT_SIZE,
	NODE_HEADER_HEIGHT,
	NODE_LABEL_GAP,
	NODE_LINE_HEIGHT,
	NODE_MAX_WIDTH,
	NODE_MIN_WIDTH,
	STATEMENT_MAX_WIDTH,
	STATEMENT_MIN_WIDTH,
	STATEMENT_ROW_PADDING_Y,
	STATEMENT_TEXT_OFFSET_X
} from "./visualisation";
import type { EntityType, StatementRole, StatementRow } from "./types";

export const TEXT_VERTICAL_OFFSET_FACTOR = 0.35;
export const NODE_FONT_FAMILY =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

let sharedCtx: CanvasRenderingContext2D | null = null;
export function getSharedCtx(): CanvasRenderingContext2D | null {
	if (typeof document === "undefined") return null;

	if (sharedCtx) return sharedCtx;

	const canvas = document.createElement("canvas");
	sharedCtx = canvas.getContext("2d");
	return sharedCtx;
}

function measureCtxWidth(text: string, font: string, ctx: CanvasRenderingContext2D) {
	ctx.font = font;
	return Math.ceil(ctx.measureText(text).width);
}

function breakText(text: string, maxWidth: number, ctx: CanvasRenderingContext2D): string[] {
	const words = text.split(" ");
	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		if (measureCtxWidth(word, ctx.font, ctx) > maxWidth) {
			if (currentLine) lines.push(currentLine);

			let buf = "";
			for (const ch of word) {
				if (measureCtxWidth(buf + ch, ctx.font, ctx) > maxWidth) {
					if (buf) lines.push(buf);
					buf = ch;
				} else {
					buf += ch;
				}
			}
			currentLine = buf;
			continue;
		}

		const candidate = currentLine ? `${currentLine} ${word}` : word;
		if (measureCtxWidth(candidate, ctx.font, ctx) <= maxWidth) {
			currentLine = candidate;
		} else {
			if (currentLine) lines.push(currentLine);
			currentLine = word;
		}
	}

	if (currentLine) lines.push(currentLine);
	return lines.length > 0 ? lines : [text];
}

export function measureNodeDimensions(label: string, prefix: string | null, nodeType: EntityType, external: boolean) {
	const ctx = getSharedCtx();
	if (!ctx)
		return {
			width: NODE_MIN_WIDTH,
			height: NODE_HEADER_HEIGHT + NODE_CONTENT_PADDING_Y + NODE_LINE_HEIGHT + NODE_BORDER_WIDTH,
			bodyLines: [label],
			badgeWidth: 0
		};

	const headerFont = `bold ${NODE_HEADER_FONT_SIZE}px ${NODE_FONT_FAMILY}`;
	const bodyFont = `${NODE_BODY_FONT_SIZE}px ${NODE_FONT_FAMILY}`;
	const badgeFont = `${NODE_BADGE_FONT_SIZE}px ${NODE_FONT_FAMILY}`;

	const headerText = entityTypeLabel(nodeType, external);
	const headerWidth = measureCtxWidth(headerText, headerFont, ctx);

	const badgeTextWidth = prefix ? measureCtxWidth(prefix, badgeFont, ctx) : 0;
	const badgeWidth = prefix ? badgeTextWidth + NODE_BADGE_PADDING_X * 2 : 0;

	const textWidth = measureCtxWidth(label, bodyFont, ctx) + 5;
	const width = Math.min(
		NODE_MAX_WIDTH,
		Math.max(
			NODE_MIN_WIDTH,
			(prefix ? badgeWidth + NODE_LABEL_GAP : 0) + textWidth + NODE_CONTENT_PADDING_X + NODE_BORDER_WIDTH,
			headerWidth + NODE_CONTENT_PADDING_X
		)
	);

	const availableWidthFull = width - NODE_BORDER_WIDTH - NODE_CONTENT_PADDING_X;
	const availableWidthFirst = availableWidthFull - (prefix ? badgeWidth + NODE_LABEL_GAP : 0);

	ctx.font = bodyFont;
	const firstLines = breakText(label, availableWidthFirst, ctx);
	const bodyLines =
		firstLines.length > 1
			? [firstLines[0], ...breakText(firstLines.slice(1).join(" "), availableWidthFull, ctx)]
			: firstLines;

	const height =
		NODE_HEADER_HEIGHT + NODE_CONTENT_PADDING_Y + bodyLines.length * NODE_LINE_HEIGHT + NODE_BORDER_WIDTH;

	return { width, height, bodyLines, badgeWidth };
}

export function measureBlankNodeDimensions(nodeType: EntityType): {
	width: number;
	height: number;
} {
	const ctx = getSharedCtx();
	const headerText = entityTypeLabel(nodeType, false);

	let textWidth = NODE_MIN_WIDTH;
	if (ctx) {
		ctx.font = `bold ${NODE_HEADER_FONT_SIZE}px ${NODE_FONT_FAMILY}`;
		textWidth = Math.ceil(ctx.measureText(headerText).width);
	}

	return {
		width: textWidth + 8,
		height: NODE_HEADER_HEIGHT + 2
	};
}

export type StatementPart = { role: StatementRole; prefix: string | null; text: string; colour: string | null };

/** Horizontal inset of a node's content from its left edge. */
export const NODE_CONTENT_INSET = NODE_BORDER_WIDTH / 2 + NODE_CONTENT_PADDING_X / 2;

/** Lays out a triple term card: a header and one row per part, each row wrapping its text like a node body. */
export function measureStatementCard(parts: StatementPart[]): { width: number; height: number; rows: StatementRow[] } {
	const ctx = getSharedCtx();
	const bodyFont = `${NODE_BODY_FONT_SIZE}px ${NODE_FONT_FAMILY}`;
	const badgeFont = `${NODE_BADGE_FONT_SIZE}px ${NODE_FONT_FAMILY}`;
	const textX = NODE_CONTENT_INSET + STATEMENT_TEXT_OFFSET_X;

	const badgeWidths = parts.map((part) =>
		part.prefix && ctx ? measureCtxWidth(part.prefix, badgeFont, ctx) + NODE_BADGE_PADDING_X * 2 : 0
	);
	const lead = (i: number) => (badgeWidths[i] ? badgeWidths[i] + NODE_LABEL_GAP : 0);

	let width = STATEMENT_MIN_WIDTH;
	if (ctx) {
		const headerWidth = measureCtxWidth(
			entityTypeLabel("tripleTerm", false),
			`bold ${NODE_HEADER_FONT_SIZE}px ${NODE_FONT_FAMILY}`,
			ctx
		);
		const widest = Math.max(
			...parts.map(
				(part, i) => textX + lead(i) + measureCtxWidth(part.text, bodyFont, ctx) + 5 + NODE_CONTENT_INSET
			)
		);
		width = Math.min(
			STATEMENT_MAX_WIDTH,
			Math.max(STATEMENT_MIN_WIDTH, widest, headerWidth + NODE_CONTENT_PADDING_X)
		);
	}

	const available = width - textX - NODE_CONTENT_INSET;
	let y = NODE_HEADER_HEIGHT + NODE_CONTENT_PADDING_Y;
	const rows = parts.map((part, i): StatementRow => {
		let lines = [part.text];
		if (ctx) {
			ctx.font = bodyFont;
			const first = breakText(part.text, available - lead(i), ctx);
			lines = first.length > 1 ? [first[0], ...breakText(first.slice(1).join(" "), available, ctx)] : first;
		}
		const height = lines.length * NODE_LINE_HEIGHT + STATEMENT_ROW_PADDING_Y * 2;
		const row: StatementRow = {
			role: part.role,
			prefix: part.prefix,
			lines,
			badgeWidth: badgeWidths[i],
			colour: part.colour,
			y,
			height,
			portY: y + STATEMENT_ROW_PADDING_Y + NODE_LINE_HEIGHT / 2
		};
		y += height;
		return row;
	});

	return { width, height: y + NODE_CONTENT_PADDING_Y + NODE_BORDER_WIDTH, rows };
}
