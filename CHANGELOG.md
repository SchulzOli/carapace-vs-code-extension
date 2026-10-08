# Changelog

## 0.1.0

Initial release — a VS Code port of [Carapace](https://github.com/sellsol/carapace).

- Live, OWL-aware graph preview for Turtle (`.ttl`) files, updating as you type and keeping the last valid graph while the document has syntax errors.
- Carapace's graph engine: entity classification (classes, datatypes, object/data/annotation properties, instances, literals, blank nodes), collections (`owl:unionOf`, `owl:intersectionOf`, `owl:oneOf`, RDF lists), node naming via `rdfs:label`, stable blank-node identities and force-directed layout.
- Editor ↔ graph navigation: clicking a node jumps to its definition, the graph follows the editor cursor, and _Reveal Node at Cursor_ centres the node for the current line.
- Graph controls: pan, zoom, fit, drag (multi-select with Ctrl/Cmd+click or box select), layout lock, re-layout, search over nodes and predicates.
- Per-document graph settings (entity types, hidden namespaces/predicates/instance-of IRIs, name predicate, duplicated external nodes), with workspace defaults in VS Code settings. Layout, camera, lock and settings are remembered per document.
- Export to SVG and PNG.
- Turtle language support: syntax highlighting, syntax-error diagnostics, outline, go to definition and hover for prefixed names and IRIs.
- _Convert RDF/XML to Turtle_ for `.rdf`/`.owl`/`.xml` files, and _New Sample Ontology_.
