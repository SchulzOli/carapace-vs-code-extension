import { ENTITY_TYPE_DISPLAY } from "../core/entity";
import { BUILTIN_NS_TO_PREFIX } from "../core/namespaces";
import type { GraphSettings } from "../core/settings";
import type { EntityType } from "../core/types";
import { html, icon, iconButton } from "./dom";

type ListKey = "hiddenNamespaces" | "hiddenPredicateUris" | "hiddenInstanceOfUris";

/** Side panel with per-document visualiser settings (port of Carapace's GraphSettings). */
export class SettingsPanel {
	readonly el: HTMLElement;
	private settings: GraphSettings | null = null;
	private prefixMap: Record<string, string> = {};
	private locked = false;

	constructor(
		private readonly onChange: (patch: Partial<GraphSettings>) => void,
		private readonly onReset: () => void,
		private readonly onClose: () => void
	) {
		this.el = html("aside", { class: "settings-panel", hidden: true, "aria-label": "Graph settings" });
		this.el.addEventListener("keydown", (event) => {
			if (event.key === "Escape") this.close();
			event.stopPropagation();
		});
	}

	get isOpen() {
		return !this.el.hidden;
	}

	open() {
		this.el.hidden = false;
		this.render();
		this.el.querySelector<HTMLElement>("input, button")?.focus();
	}

	close() {
		if (this.el.hidden) return;
		this.el.hidden = true;
		this.onClose();
	}

	toggle() {
		if (this.isOpen) this.close();
		else this.open();
	}

	/** `prefixMap` maps namespace IRI -> prefix, as declared in the document. */
	update(settings: GraphSettings, prefixMap: Record<string, string>, locked: boolean) {
		this.settings = settings;
		this.prefixMap = prefixMap;
		this.locked = locked;
		if (this.isOpen) this.render();
	}

	private resolvePrefixed(input: string): string {
		const colon = input.indexOf(":");
		if (colon <= 0) return input;
		const prefix = input.slice(0, colon);
		const local = input.slice(colon + 1);
		if (local.startsWith("//")) return input; // a full IRI such as http://...

		for (const [ns, p] of Object.entries({ ...BUILTIN_NS_TO_PREFIX, ...this.prefixMap })) {
			if (p === prefix) return ns + local;
		}
		return input;
	}

	private shortLabel(uri: string): string {
		for (const [ns, prefix] of Object.entries({ ...BUILTIN_NS_TO_PREFIX, ...this.prefixMap })) {
			if (uri.startsWith(ns)) return `${prefix}:${uri.slice(ns.length)}`;
		}
		return uri;
	}

	private render() {
		const settings = this.settings;
		if (!settings) return;
		const disabled = this.locked;

		const header = html("div", { class: "settings-header" }, [
			html("h2", {}, ["Graph Settings"]),
			html("div", { class: "settings-header-actions" }, [
				this.linkButton("Reset to defaults", () => this.onReset(), disabled),
				iconButton("close", "Close settings", () => this.close())
			])
		]);

		const sections: HTMLElement[] = [header];

		if (this.locked) {
			sections.push(
				html("div", { class: "settings-locked" }, [
					icon("lock"),
					html("span", {}, ["The graph is locked — unlock it to change settings."])
				])
			);
		}

		sections.push(
			this.section("Special", null, [
				this.checkbox(
					"Duplicate externally defined nodes",
					settings.duplicateExternalNodes,
					disabled,
					(checked) => this.onChange({ duplicateExternalNodes: checked })
				)
			]),
			this.section(
				"Displayed Entity Types",
				"Nodes of these types are displayed in the graph, others are hidden.",
				ENTITY_TYPE_DISPLAY.map(({ type, label }) =>
					this.checkbox(label, !settings.hiddenEntityTypes.includes(type), disabled, () =>
						this.toggleEntityType(type)
					)
				)
			),
			this.section(
				"Custom Node Name Property",
				"Nodes display the value of this property instead of their IRI if set.",
				[
					this.inputRow("rdfs:label", "Set", disabled, (value) =>
						this.onChange({ nodeNamePredicate: this.resolvePrefixed(value) })
					),
					this.chips(settings.nodeNamePredicate ? [settings.nodeNamePredicate] : [], disabled, () =>
						this.onChange({ nodeNamePredicate: "" })
					)
				]
			),
			this.listSection(
				"Hidden Namespaces",
				"Nodes whose IRI starts with these namespaces are hidden.",
				"hiddenNamespaces",
				"http://example.org/ns#"
			),
			this.listSection(
				"Hidden Predicate Objects",
				"Nodes which are objects of these predicates are hidden.",
				"hiddenPredicateUris",
				"rdfs:comment"
			),
			this.listSection(
				"Hidden Instance-of IRIs",
				"Nodes whose direct rdf:type is one of these IRIs are hidden.",
				"hiddenInstanceOfUris",
				"owl:Ontology"
			)
		);

		this.el.replaceChildren(...sections);
	}

	private toggleEntityType(type: EntityType) {
		const hidden = this.settings!.hiddenEntityTypes;
		this.onChange({
			hiddenEntityTypes: hidden.includes(type) ? hidden.filter((t) => t !== type) : [...hidden, type]
		});
	}

	private listSection(title: string, description: string, key: ListKey, placeholder: string) {
		const values = this.settings![key];
		const disabled = this.locked;
		return this.section(title, description, [
			this.inputRow(placeholder, "Add", disabled, (value) => {
				const resolved = this.resolvePrefixed(value);
				if (!values.includes(resolved)) this.onChange({ [key]: [...values, resolved] });
			}),
			this.chips(values, disabled, (value) => this.onChange({ [key]: values.filter((v) => v !== value) }))
		]);
	}

	private section(title: string, description: string | null, children: HTMLElement[]) {
		return html("section", { class: "settings-section" }, [
			html("h3", {}, [title]),
			...(description ? [html("p", { class: "settings-description" }, [description])] : []),
			...children
		]);
	}

	private checkbox(label: string, checked: boolean, disabled: boolean, onToggle: (checked: boolean) => void) {
		const input = html("input", { type: "checkbox", checked, disabled });
		input.addEventListener("change", () => onToggle(input.checked));
		return html("label", { class: `settings-checkbox${disabled ? " disabled" : ""}` }, [
			input,
			html("span", {}, [label])
		]);
	}

	private inputRow(placeholder: string, action: string, disabled: boolean, onSubmit: (value: string) => void) {
		const input = html("input", {
			type: "text",
			placeholder,
			disabled,
			spellcheck: "false",
			"aria-label": placeholder
		});
		const submit = () => {
			const value = input.value.trim();
			if (!value) return;
			input.value = "";
			onSubmit(value);
		};
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") submit();
		});
		const button = html("button", { type: "button", class: "primary-button", disabled }, [action]);
		button.addEventListener("click", submit);
		return html("div", { class: "settings-input-row" }, [input, button]);
	}

	private chips(values: string[], disabled: boolean, onRemove: (value: string) => void) {
		return html(
			"div",
			{ class: "settings-chips" },
			values.map((value) => {
				const chip = html("span", { class: "chip", title: value }, [
					html("span", {}, [this.shortLabel(value)])
				]);
				if (!disabled) chip.append(iconButton("close", `Remove ${value}`, () => onRemove(value)));
				return chip;
			})
		);
	}

	private linkButton(label: string, onClick: () => void, disabled: boolean) {
		const button = html("button", { type: "button", class: "link-button", disabled }, [label]);
		button.addEventListener("click", onClick);
		return button;
	}
}
