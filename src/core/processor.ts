import type { RdfTerm } from "./tripleTerms";
import type { CollectionType, EntityType } from "./types";

export class NodeDescriptor {
	nodeType: EntityType | null = null;

	stableKey?: string;
	fingerprintParts?: string[];
	nameOverride?: string;

	isSubject = false;
	isLocal = false;
	isHidden = false;
	isBlank = false;
	isList = false;

	isChain = false;
	chainFirst: string | null = null;
	chainFirstType: string | null = null;
	chainNext: string | null = null;
	isChainRest = false;

	isCollection = false;
	collectionType: CollectionType | null = null;
	collectionSource: string | null = null;

	isBridge = true;
	bridgeTarget: string | null = null;

	/** RDF 1.2: triple terms this node reifies (it is the subject of `rdf:reifies`). */
	reifiedTerms: RdfTerm[] = [];
}

export interface CollectionDescriptor {
	headUri: string;
	collectionType: CollectionType;
	members: { uri: string; type: string; subjectUri: string }[];
}
