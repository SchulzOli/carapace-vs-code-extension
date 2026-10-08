import type { Quad } from "n3";

import { RDF_FIRST, RDF_NIL, RDF_REIFIES } from "./namespaces";
import { BLANK_NODE_RADIUS, CANVAS_HEIGHT, CANVAS_WIDTH, COLLECTION_NODE_RADIUS } from "./visualisation";
import type { CollectionType, Edge, EntityType, Node, StatementRole } from "./types";
import type { CollectionDescriptor } from "./processor";
import type { NodeDescriptor } from "./processor";
import type { GraphSettings } from "./settings";
import { ENTITY_TYPE_COLOURS, entityTypeColour } from "./entity";
import { measureBlankNodeDimensions, measureNodeDimensions, measureStatementCard } from "./layout";
import type { StatementPart } from "./layout";
import { classifyUriType, resolveLocalName, resolvePrefix } from "./ontology";
import { inHiddenNamespace } from "./settings";
import { formatTerm, isTripleTerm, tripleTermKey } from "./tripleTerms";
import type { RdfTerm } from "./tripleTerms";

export class Builder {
	settings: GraphSettings;
	namespacePrefixes: Record<string, string>;
	cachedPositions: Map<string, { x: number; y: number }[]>;
	literalGroups: Map<string, { value: string; position: { x: number; y: number }; claimed: boolean }[]>;

	triples: Quad[];
	nodeDescriptors: Map<string, NodeDescriptor>;
	collectionDescriptors: CollectionDescriptor[];

	edges: Edge[] = [];
	keyToEdge = new Map<string, Edge>();
	uriToNode = new Map<string, Node>();
	nextNodeId = 0;
	tripleTerms = new Map<string, RdfTerm>();

	constructor(
		settings: GraphSettings,
		namespacePrefixes: Record<string, string>,
		cachedPositions: Map<string, { x: number; y: number }[]>,
		literalGroups: Map<string, { value: string; position: { x: number; y: number }; claimed: boolean }[]>,
		triples: Quad[],
		nodeDescriptors: Map<string, NodeDescriptor>,
		collectionDescriptors: CollectionDescriptor[]
	) {
		this.settings = settings;
		this.namespacePrefixes = namespacePrefixes;
		this.cachedPositions = cachedPositions;
		this.literalGroups = literalGroups;
		this.triples = triples;
		this.nodeDescriptors = nodeDescriptors;
		this.collectionDescriptors = collectionDescriptors;
	}

	private resolveUriToStable(uri: string): string {
		return this.nodeDescriptors.get(uri)?.stableKey ?? uri;
	}

	build(): { nodes: Node[]; edges: Edge[] } {
		this.processCollections();
		this.processRelations();
		this.linkTripleTerms();

		return {
			nodes: Array.from(this.uriToNode.values()),
			edges: this.edges
		};
	}

	private processCollections() {
		for (const descriptor of this.collectionDescriptors) {
			if (this.settings.hiddenEntityTypes.includes("blank")) continue;

			const collectionNode = this.addCollectionNode(descriptor.headUri, descriptor.collectionType);

			for (const member of descriptor.members) {
				if (member.uri === RDF_NIL) continue;

				let memberNode: Node;
				if (member.type === "BlankNode") {
					memberNode = this.addBlankNode(member.uri);
				} else if (member.type === "Literal") {
					memberNode = this.addLiteralNode(member.uri, member.subjectUri, RDF_FIRST);
				} else {
					memberNode = this.addNode(member.uri);
				}

				this.addCollectionEdge(collectionNode, memberNode);
			}
		}
	}

	private processRelations() {
		for (const quad of this.triples) {
			const subjectDescriptor = this.nodeDescriptors.get(quad.subject.value);

			if (subjectDescriptor?.isChain) continue;
			if (subjectDescriptor?.isBlank && subjectDescriptor?.isBridge) continue;

			// RDF 1.2: an anonymous reifier (e.g. from an annotation block `{| ... |}`) is drawn as the triple
			// term it reifies, so annotations hang off the statement instead of off a hidden blank node
			const reified =
				quad.subject.termType === "BlankNode" && subjectDescriptor?.reifiedTerms.length === 1
					? subjectDescriptor.reifiedTerms[0]
					: null;
			if (reified) {
				if (quad.predicate.value === RDF_REIFIES) continue;
				if (this.settings.hiddenEntityTypes.includes("tripleTerm")) continue;
			} else {
				const subjectType =
					subjectDescriptor?.nodeType ??
					classifyUriType(quad.subject.value) ??
					(quad.subject.termType === "BlankNode" ? "blank" : "class");
				if (inHiddenNamespace(quad.subject.value, this.settings) || subjectDescriptor?.isHidden) continue;
				if (this.settings.hiddenEntityTypes.includes("blank") && quad.subject.termType === "BlankNode")
					continue;
				if (this.settings.hiddenEntityTypes.includes(subjectType)) continue;
			}

			// Create source node
			let source: Node;
			if (reified) {
				source = this.addTripleTermNode(reified, quad.subject.value);
			} else if (quad.subject.termType === "BlankNode") {
				source = this.addBlankNode(quad.subject.value, quad.object.value);
			} else {
				source = this.addNode(quad.subject.value, quad.object.value);
			}

			// Create edge and target node
			if (quad.predicate.value === this.settings.nodeNamePredicate) continue;
			if (this.settings.hiddenPredicateUris.includes(quad.predicate.value)) continue;
			if (quad.object.termType === "BlankNode") {
				if (this.settings.hiddenEntityTypes.includes("blank")) continue;

				const objectDescriptor = this.nodeDescriptors.get(quad.object.value);

				let objectUri = quad.object.value;
				if (objectDescriptor?.isBridge && objectDescriptor.bridgeTarget) {
					objectUri = objectDescriptor.bridgeTarget;
				}

				const target: Node = this.addBlankNode(objectUri, quad.subject.value);
				this.addEdge(source, target, quad.predicate.value);
			} else if (isTripleTerm(quad.object)) {
				// RDF 1.2 triple term, e.g. the object of rdf:reifies produced by reified triples and annotations
				if (this.settings.hiddenEntityTypes.includes("tripleTerm")) continue;

				const target = this.addTripleTermNode(quad.object as RdfTerm, quad.subject.value);
				this.addEdge(source, target, quad.predicate.value);
			} else if (quad.object.termType === "Literal") {
				if (this.settings.hiddenEntityTypes.includes("literal")) continue;

				const target: Node = this.addLiteralNode(quad.object.value, quad.subject.value, quad.predicate.value);
				this.addEdge(source, target, quad.predicate.value);
			} else {
				const objectDescriptor = this.nodeDescriptors.get(quad.object.value);
				if (inHiddenNamespace(quad.object.value, this.settings) || objectDescriptor?.isHidden) continue;

				const objectType = objectDescriptor?.nodeType ?? classifyUriType(quad.object.value) ?? "class";
				if (this.settings.hiddenEntityTypes.includes(objectType)) continue;

				let target: Node;
				if (
					this.settings.duplicateExternalNodes &&
					!objectDescriptor?.isLocal &&
					!objectDescriptor?.isSubject
				) {
					target = this.addExternalNode(
						quad.object.value,
						objectType,
						quad.subject.value,
						quad.predicate.value
					);
				} else {
					target = this.addNode(quad.object.value, quad.subject.value);
				}
				this.addEdge(source, target, quad.predicate.value);
			}
		}
	}

	private addNode(uri: string, nearbyUri?: string): Node {
		if (this.uriToNode.has(uri)) return this.uriToNode.get(uri)!;

		const descriptor = this.nodeDescriptors.get(uri);
		const type = descriptor?.nodeType ?? classifyUriType(uri) ?? "class";
		const label = descriptor?.nameOverride ?? resolveLocalName(uri);
		const prefix = resolvePrefix(uri, this.namespacePrefixes);
		const dimensions = measureNodeDimensions(label, prefix, type, false);

		let position = this.cachedPositions.get(uri)?.shift();
		if (!position && nearbyUri) {
			const stableNearbyUri = this.resolveUriToStable(nearbyUri);
			const nearbyPosition =
				this.cachedPositions.get(stableNearbyUri)?.[0] ?? this.uriToNode.get(stableNearbyUri);
			if (nearbyPosition) {
				position = {
					x: nearbyPosition.x + (Math.random() - 0.5) * 300,
					y: nearbyPosition.y + (Math.random() - 0.5) * 300
				};
			}
		}

		const node: Node = {
			id: `node-${this.nextNodeId++}`,
			uri,
			label,
			prefix,
			nodeType: type,
			external: type !== "literal" && !descriptor?.isSubject,
			blank: false,
			collection: false,
			collectionType: null,
			x: position?.x ?? Math.random() * CANVAS_WIDTH,
			y: position?.y ?? Math.random() * CANVAS_HEIGHT,
			width: dimensions.width,
			height: dimensions.height,
			bodyLines: dimensions.bodyLines,
			badgeWidth: dimensions.badgeWidth
		};
		this.uriToNode.set(uri, node);
		return node;
	}

	private addBlankNode(uri: string, nearbyUri?: string): Node {
		const stableUri = this.resolveUriToStable(uri);
		if (this.uriToNode.has(stableUri)) return this.uriToNode.get(stableUri)!;

		const descriptor = this.nodeDescriptors.get(uri);

		let position = this.cachedPositions.get(stableUri)?.shift();
		if (!position && nearbyUri) {
			const stableNearby = this.resolveUriToStable(nearbyUri);
			const nearbyPosition = this.cachedPositions.get(stableNearby)?.[0] ?? this.uriToNode.get(stableNearby);
			if (nearbyPosition) {
				position = {
					x: nearbyPosition.x + (Math.random() - 0.5) * 300,
					y: nearbyPosition.y + (Math.random() - 0.5) * 300
				};
			}
		}

		if (descriptor?.nodeType) {
			const dimensions = measureBlankNodeDimensions(descriptor.nodeType);

			const node: Node = {
				id: `node-${this.nextNodeId++}`,
				uri: stableUri,
				label: "",
				prefix: null,
				nodeType: descriptor.nodeType,
				external: !descriptor.isSubject,
				blank: true,
				collection: false,
				collectionType: null,
				x: position?.x ?? Math.random() * CANVAS_WIDTH,
				y: position?.y ?? Math.random() * CANVAS_HEIGHT,
				width: dimensions.width,
				height: dimensions.height,
				bodyLines: [],
				badgeWidth: 0
			};
			this.uriToNode.set(stableUri, node);
			return node;
		} else {
			const diameter = BLANK_NODE_RADIUS * 2;

			const node: Node = {
				id: `node-${this.nextNodeId++}`,
				uri: stableUri,
				label: "",
				prefix: null,
				nodeType: "blank",
				external: !descriptor?.isSubject,
				blank: true,
				collection: false,
				collectionType: null,
				x: position?.x ?? Math.random() * CANVAS_WIDTH,
				y: position?.y ?? Math.random() * CANVAS_HEIGHT,
				width: diameter,
				height: diameter,
				bodyLines: [],
				badgeWidth: 0
			};
			this.uriToNode.set(stableUri, node);
			return node;
		}
	}

	private addCollectionNode(uri: string, collectionType: CollectionType): Node {
		const stableUri = this.resolveUriToStable(uri);
		if (this.uriToNode.has(stableUri)) return this.uriToNode.get(stableUri)!;

		const position = this.cachedPositions.get(stableUri)?.shift();
		const diameter = COLLECTION_NODE_RADIUS * 2;

		const node: Node = {
			id: `node-${this.nextNodeId++}`,
			uri: stableUri,
			label: "",
			prefix: null,
			nodeType: "list",
			external: !this.nodeDescriptors.get(uri)?.isSubject,
			blank: true,
			collection: true,
			collectionType,
			x: position?.x ?? Math.random() * CANVAS_WIDTH,
			y: position?.y ?? Math.random() * CANVAS_HEIGHT,
			width: diameter,
			height: diameter,
			bodyLines: [],
			badgeWidth: 0
		};
		this.uriToNode.set(stableUri, node);
		return node;
	}

	private addLiteralNode(value: string, subjectUri: string, predicateUri: string): Node {
		const stableSubjectUri = this.resolveUriToStable(subjectUri);
		const key = `${stableSubjectUri}|${predicateUri}|${value}`;
		if (this.uriToNode.has(key)) return this.uriToNode.get(key)!;

		const groupKey = `${stableSubjectUri}|${predicateUri}`;
		const dimensions = measureNodeDimensions(value, null, "literal", false);

		let position = this.cachedPositions.get(key)?.shift();
		if (!position) {
			const candidatePositions = this.literalGroups.get(groupKey);
			if (candidatePositions) {
				const unclaimed = candidatePositions.find((c) => !c.claimed);
				if (unclaimed) {
					unclaimed.claimed = true;
					position = unclaimed.position;
				}
			} else {
				const nearbyPosition =
					this.cachedPositions.get(stableSubjectUri)?.[0] ?? this.uriToNode.get(stableSubjectUri);
				if (nearbyPosition) {
					position = {
						x: nearbyPosition.x + (Math.random() - 0.5) * 300,
						y: nearbyPosition.y + (Math.random() - 0.5) * 300
					};
				}
			}
		}

		const node: Node = {
			id: `node-${this.nextNodeId++}`,
			uri: key,
			label: value,
			prefix: null,
			nodeType: "literal",
			external: false,
			blank: false,
			collection: false,
			collectionType: null,
			x: position?.x ?? Math.random() * CANVAS_WIDTH,
			y: position?.y ?? Math.random() * CANVAS_HEIGHT,
			width: dimensions.width,
			height: dimensions.height,
			bodyLines: dimensions.bodyLines,
			badgeWidth: dimensions.badgeWidth
		};
		this.uriToNode.set(key, node);
		return node;
	}

	private addExternalNode(uri: string, type: EntityType, subjectUri: string, predicateUri: string): Node {
		const stableSubjectUri = this.resolveUriToStable(subjectUri);
		const key = `${stableSubjectUri}|${predicateUri}|${uri}`;
		if (this.uriToNode.has(key)) return this.uriToNode.get(key)!;

		const label = this.nodeDescriptors.get(uri)?.nameOverride ?? resolveLocalName(uri);
		const prefix = resolvePrefix(uri, this.namespacePrefixes);
		const dimensions = measureNodeDimensions(label, prefix, type, false);

		let position = this.cachedPositions.get(key)?.shift();
		if (!position) {
			const nearbyPosition =
				this.cachedPositions.get(stableSubjectUri)?.[0] ?? this.uriToNode.get(stableSubjectUri);
			if (nearbyPosition) {
				position = {
					x: nearbyPosition.x + (Math.random() - 0.5) * 300,
					y: nearbyPosition.y + (Math.random() - 0.5) * 300
				};
			}
		}

		const node: Node = {
			id: `node-${this.nextNodeId++}`,
			uri: key,
			label,
			prefix,
			nodeType: type,
			external: true,
			blank: false,
			collection: false,
			collectionType: null,
			x: position?.x ?? Math.random() * CANVAS_WIDTH,
			y: position?.y ?? Math.random() * CANVAS_HEIGHT,
			width: dimensions.width,
			height: dimensions.height,
			bodyLines: dimensions.bodyLines,
			badgeWidth: dimensions.badgeWidth
		};
		this.uriToNode.set(key, node);
		return node;
	}

	private addTripleTermNode(term: RdfTerm, nearbyUri: string): Node {
		const key = tripleTermKey(term);
		if (this.uriToNode.has(key)) return this.uriToNode.get(key)!;
		this.tripleTerms.set(key, term);

		const label = formatTerm(term, this.namespacePrefixes);
		const dimensions = measureNodeDimensions(label, null, "tripleTerm", false);

		let position = this.cachedPositions.get(key)?.shift();
		if (!position) {
			const stableNearbyUri = this.resolveUriToStable(nearbyUri);
			const nearbyPosition =
				this.cachedPositions.get(stableNearbyUri)?.[0] ?? this.uriToNode.get(stableNearbyUri);
			if (nearbyPosition) {
				position = {
					x: nearbyPosition.x + (Math.random() - 0.5) * 300,
					y: nearbyPosition.y + (Math.random() - 0.5) * 300
				};
			}
		}

		const node: Node = {
			id: `node-${this.nextNodeId++}`,
			uri: key,
			label,
			prefix: null,
			nodeType: "tripleTerm",
			external: false,
			blank: false,
			collection: false,
			collectionType: null,
			x: position?.x ?? Math.random() * CANVAS_WIDTH,
			y: position?.y ?? Math.random() * CANVAS_HEIGHT,
			width: dimensions.width,
			height: dimensions.height,
			bodyLines: dimensions.bodyLines,
			badgeWidth: dimensions.badgeWidth
		};
		this.uriToNode.set(key, node);
		return node;
	}

	/**
	 * Lays out each triple term node as a card with a subject, predicate and object row, and links the subject and
	 * object rows to their nodes where those are drawn.
	 */
	private linkTripleTerms() {
		for (const [key, term] of this.tripleTerms) {
			const node = this.uriToNode.get(key);
			if (!node) continue;
			const subject = this.findTermNode(term.subject!, term);
			const object = this.findTermNode(term.object!, term);
			const predicate =
				this.uriToNode.get(this.resolveUriToStable(term.predicate!.value)) ??
				this.uriToNode.get(term.predicate!.value);

			const card = measureStatementCard([
				this.statementPart("subject", term.subject!, subject),
				this.statementPart("predicate", term.predicate!, predicate),
				this.statementPart("object", term.object!, object)
			]);
			node.statement = card.rows;
			node.width = card.width;
			node.height = card.height;
			node.bodyLines = [];

			if (subject && subject !== node) this.addTermEdge(node, subject, "subject");
			if (object && object !== node) this.addTermEdge(node, object, "object");
		}
	}

	/** What a card row shows: the label of the part's node where it is drawn, otherwise the part in Turtle form. */
	private statementPart(role: StatementRole, part: RdfTerm, node: Node | undefined): StatementPart {
		if (part.termType === "Literal" || part.termType === "Quad" || part.termType === "BlankNode") {
			const type: EntityType =
				part.termType === "Literal" ? "literal" : part.termType === "Quad" ? "tripleTerm" : "blank";
			return {
				role,
				prefix: null,
				text: formatTerm(part, this.namespacePrefixes),
				colour: node ? entityTypeColour(node.nodeType, node.external) : ENTITY_TYPE_COLOURS[type]
			};
		}
		if (node)
			return {
				role,
				prefix: node.prefix,
				text: node.label,
				colour: entityTypeColour(node.nodeType, node.external)
			};
		const prefix = resolvePrefix(part.value, this.namespacePrefixes);
		return {
			role,
			prefix: prefix || null,
			// a badge for a named prefix, Turtle's own form for the empty prefix and for full IRIs
			text: prefix ? resolveLocalName(part.value) : formatTerm(part, this.namespacePrefixes),
			colour: null
		};
	}

	private findTermNode(part: RdfTerm, term: RdfTerm): Node | undefined {
		const subject = this.resolveUriToStable(term.subject!.value);
		const predicate = term.predicate!.value;
		switch (part.termType) {
			case "Quad":
				return this.uriToNode.get(tripleTermKey(part));
			case "Literal":
				return this.uriToNode.get(`${subject}|${predicate}|${part.value}`);
			case "BlankNode":
				return this.uriToNode.get(this.resolveUriToStable(part.value));
			default:
				// external nodes are keyed per reference when duplicateExternalNodes is on
				return this.uriToNode.get(part.value) ?? this.uriToNode.get(`${subject}|${predicate}|${part.value}`);
		}
	}

	private addTermEdge(source: Node, target: Node, role: StatementRole) {
		const key = `term\u0000${role}\u0000${source.uri}\u0000${target.uri}`;
		if (this.keyToEdge.has(key)) return;
		const edge: Edge = {
			id: `edge-${this.edges.length}`,
			source,
			target,
			label: "",
			collectionEdge: false,
			termEdge: true,
			termRole: role
		};
		this.edges.push(edge);
		this.keyToEdge.set(key, edge);
	}

	private addEdge(source: Node, target: Node, predicateUri: string) {
		const prefix = resolvePrefix(predicateUri, this.namespacePrefixes);
		const localName = resolveLocalName(predicateUri);
		const fullName = prefix ? `${prefix}:${localName}` : localName;

		const key = `${source.uri}\u0000${target.uri}`;
		const existingEdge = this.keyToEdge.get(key);
		if (existingEdge) {
			existingEdge.label += `\n${fullName}`;
			return;
		}

		const edge: Edge = {
			id: `edge-${this.edges.length}`,
			source,
			target,
			label: fullName,
			collectionEdge: false,
			termEdge: false
		};
		this.edges.push(edge);
		this.keyToEdge.set(key, edge);
	}

	private addCollectionEdge(source: Node, target: Node) {
		const edge: Edge = {
			id: `edge-${this.edges.length}`,
			source,
			target,
			label: "",
			collectionEdge: true,
			termEdge: false
		};
		this.edges.push(edge);
	}
}
