# Changelog

## Unreleased

- Turtle 1.2 graphs: triple terms are drawn as cards with a subject, predicate and object row, in the colours of those parts' entity types. Curved connectors run from the subject and object rows to their nodes, replacing the dashed lines. Literals show their value, with the datatype or language as a small tag (`112` with `zoo:Age` instead of `"112"^^zoo:Age`).

## 0.2.0 — 2026-10-08

- Renamed to **Carapace Turtle** with the extension ID `carapace-turtle-vscode`, because the previous Marketplace name was taken.
- Turtle 1.2 graphs:
    - Annotations (`{| … |}`) are now visible by default, drawn on the triple term they describe. Before, they were hidden along with blank nodes.
    - Triple terms are linked to their subject and object nodes with dashed lines.
    - Named reifiers are classified as instances.
    - Numbers and booleans inside triple terms use Turtle shorthand (`42` instead of `"42"^^xsd:integer`).
- Layout: unconnected nodes no longer drift far away, so "fit to view" keeps the graph readable.

## 0.1.0

Initial release — a VS Code port of [Carapace](https://github.com/sellsol/carapace).

- Live, OWL-aware graph preview for Turtle (`.ttl`) files, updating as you type and keeping the last valid graph while the document has syntax errors.
- Carapace's graph engine: entity classification (classes, datatypes, object/data/annotation properties, instances, literals, blank nodes), collections (`owl:unionOf`, `owl:intersectionOf`, `owl:oneOf`, RDF lists), node naming via `rdfs:label`, stable blank-node identities and force-directed layout.
- Editor ↔ graph navigation: clicking a node jumps to its definition, the graph follows the editor cursor, and _Reveal Node at Cursor_ centres the node for the current line.
- Graph controls: pan, zoom, fit, drag (multi-select with Ctrl/Cmd+click or box select), layout lock, re-layout, search over nodes and predicates.
- Per-document graph settings (entity types, hidden namespaces/predicates/instance-of IRIs, name predicate, duplicated external nodes), with workspace defaults in VS Code settings. Layout, camera, lock and settings are remembered per document.
- Export to SVG and PNG.
- Turtle 1.1 and 1.2: strict parsing that passes the full W3C Turtle 1.1 (313) and 1.2 (419) test suites. Supports `VERSION`/`@version` directives, triple terms `<<( s p o )>>`, reified triples `<< s p o ~ r >>`, annotations `{| … |}` and base directions (`@en--ltr`), all highlighted and visualised (Triple Term nodes).
- Turtle language support: syntax highlighting, syntax-error diagnostics, outline, go to definition and hover for prefixed names and IRIs.
- _Convert RDF/XML to Turtle_ for `.rdf`/`.owl`/`.xml` files, and _New Sample Ontology_.
