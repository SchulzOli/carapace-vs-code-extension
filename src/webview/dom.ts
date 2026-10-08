export const SVG_NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number | boolean | null | undefined>;

function applyAttrs(el: Element, attrs: Attrs) {
	for (const [key, value] of Object.entries(attrs)) {
		if (value === null || value === undefined || value === false) continue;
		el.setAttribute(key, value === true ? "" : String(value));
	}
}

export function svg<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Attrs = {},
	children: (Node | string)[] = []
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG_NS, tag);
	applyAttrs(el, attrs);
	el.append(...children);
	return el;
}

export function html<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Attrs = {},
	children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	applyAttrs(el, attrs);
	el.append(...children);
	return el;
}

/** A codicon (https://microsoft.github.io/vscode-codicons/) glyph. */
export function icon(name: string): HTMLElement {
	return html("span", { class: `codicon codicon-${name}`, "aria-hidden": "true" });
}

export function iconButton(
	name: string,
	title: string,
	onClick: (event: MouseEvent) => void,
	attrs: Attrs = {}
): HTMLButtonElement {
	const button = html("button", { type: "button", class: "icon-button", title, "aria-label": title, ...attrs }, [
		icon(name)
	]);
	button.addEventListener("click", onClick);
	return button;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const debounced = (...args: A) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, delay);
	};
	debounced.flush = (...args: A) => {
		if (timer) clearTimeout(timer);
		timer = null;
		fn(...args);
	};
	debounced.cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	return debounced;
}
