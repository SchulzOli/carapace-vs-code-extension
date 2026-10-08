export type EntityType =
	| "class"
	| "datatype"
	| "objectProperty"
	| "dataProperty"
	| "annotationProperty"
	| "instance"
	| "literal"
	| "blank"
	| "list"
	| "tripleTerm";

export type CollectionType = "list" | "union" | "intersection" | "enumeration";

export type StatementRole = "subject" | "predicate" | "object";

/** One row of a triple term card: a part of the statement, laid out by `measureStatementCard`. */
export type StatementRow = {
	role: StatementRole;
	prefix: string | null;
	lines: string[];
	badgeWidth: number;
	/** palette colour of the part's entity type, `null` for a part without a node of its own */
	colour: string | null;
	/** top of the row and centre of its connector, relative to the node */
	y: number;
	height: number;
	portY: number;
};

export type Node = {
	id: string;
	uri: string;
	prefix: string | null;
	label: string;

	x: number;
	y: number;
	width: number;
	height: number;
	bodyLines: string[];
	badgeWidth: number;

	nodeType: EntityType;
	external: boolean;
	blank: boolean;
	collection: boolean;
	collectionType: CollectionType | null;
	/** RDF 1.2: a triple term node is drawn as a card with a subject, predicate and object row */
	statement?: StatementRow[];
};

export type Edge = {
	id: string;
	source: Node;
	target: Node;
	label: string; // includes any prefix here so multiple prefix-label pairs can be stored

	collectionEdge: boolean;
	/** RDF 1.2: unlabelled link from a triple term node to its subject or object node. */
	termEdge: boolean;
	/** for a term edge, the row of the triple term card it starts at */
	termRole?: StatementRole;
};

export type GraphSearchResult = { kind: "node"; node: Node } | { kind: "edge"; edge: Edge };
