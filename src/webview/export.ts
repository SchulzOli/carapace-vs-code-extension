import type { Node } from "../core/types";
import { EXPORT_STYLE_PROPERTIES, MAX_CANVAS_AREA, MAX_CANVAS_DIMENSION } from "../core/visualisation";
import type { Camera } from "./renderer";

const COLOUR_PROPERTIES = new Set(["fill", "stroke"]);

let colourCtx: CanvasRenderingContext2D | null = null;

/** Normalises any CSS colour (including color-mix() results) to #rrggbb / rgba() for portable SVG output. */
function toPortableColour(value: string): string {
	if (!value || value === "none" || value.startsWith("url(")) return value;
	colourCtx ??= document.createElement("canvas").getContext("2d");
	if (!colourCtx) return value;
	colourCtx.fillStyle = "#000000";
	colourCtx.fillStyle = value;
	return String(colourCtx.fillStyle);
}

/**
 * Serialises the rendered graph to a standalone SVG cropped to the graph's bounding box, inlining computed styles
 * (port of Carapace's export). `lightTheme` temporarily switches the palette to light while styles are captured.
 */
export function buildExportSvg(
	svgEl: SVGSVGElement,
	nodes: Node[],
	camera: Camera,
	lightTheme: boolean
): { svg: string; width: number; height: number } {
	const padding = 40;
	const dims = nodes.map((n) => ({
		x: n.x * camera.k + camera.x,
		y: n.y * camera.k + camera.y,
		w: n.width * camera.k,
		h: n.height * camera.k
	}));
	const minX = Math.min(...dims.map((d) => d.x)) - padding;
	const minY = Math.min(...dims.map((d) => d.y)) - padding;
	const maxX = Math.max(...dims.map((d) => d.x + d.w)) + padding;
	const maxY = Math.max(...dims.map((d) => d.y + d.h)) + padding;

	const body = document.body;
	if (lightTheme) body.classList.add("export-light");

	const out = svgEl.cloneNode(true) as SVGSVGElement;
	let background = "";
	try {
		const originals = svgEl.querySelectorAll("*");
		const clones = out.querySelectorAll("*");
		clones.forEach((el, i) => {
			const cs = getComputedStyle(originals[i]);
			const style = (el as SVGElement).style;
			for (const prop of EXPORT_STYLE_PROPERTIES) {
				const value = cs.getPropertyValue(prop);
				if (!value) continue;
				style.setProperty(prop, COLOUR_PROPERTIES.has(prop) ? toPortableColour(value) : value);
			}
		});
		if (!lightTheme) background = toPortableColour(getComputedStyle(body).getPropertyValue("--mantle").trim());
	} finally {
		if (lightTheme) body.classList.remove("export-light");
	}

	out.querySelectorAll("title, .selection-outline, .selection-box").forEach((el) => el.remove());
	out.removeAttribute("class");
	out.removeAttribute("style");
	out.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	out.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
	out.setAttribute("width", String(maxX - minX));
	out.setAttribute("height", String(maxY - minY));

	if (background) {
		const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
		rect.setAttribute("x", String(minX));
		rect.setAttribute("y", String(minY));
		rect.setAttribute("width", String(maxX - minX));
		rect.setAttribute("height", String(maxY - minY));
		rect.setAttribute("fill", background);
		out.insertBefore(rect, out.firstChild);
	}

	return {
		svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out),
		width: maxX - minX,
		height: maxY - minY
	};
}

function usableScale(width: number, height: number): number | null {
	for (const scale of [2, 1]) {
		const w = width * scale;
		const h = height * scale;
		if (w <= MAX_CANVAS_DIMENSION && h <= MAX_CANVAS_DIMENSION && w * h <= MAX_CANVAS_AREA) return scale;
	}
	return null;
}

/** Rasterises an exported SVG to a base64-encoded PNG (without the data: prefix). */
export function rasterisePng(svg: string, width: number, height: number): Promise<string> {
	const scale = usableScale(width, height);
	if (!scale) return Promise.reject(new Error("Graph too large to export as PNG"));

	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = Math.ceil(width * scale);
			canvas.height = Math.ceil(height * scale);
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Failed to render PNG export"));
				return;
			}
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			resolve(canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""));
		};
		img.onerror = () => reject(new Error("Failed to render PNG export"));
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	});
}
