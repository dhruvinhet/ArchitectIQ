# Changelog

## [1.0.9] - 20 March 2026

### Fixed
- Replaced activity bar icon with a VS Code-compliant monochrome glyph for proper rendering in the left panel.
- Updated container/view icon references to use the dedicated activity bar icon asset.

## [1.0.8] - 20 March 2026

### Added
- Privacy-first and security-focused user documentation updates.
- Responsibility-aware seed filtering to prioritize business-logic files.
- Improved feature-cluster scoring and seed-quality diagnostics.
- Dedicated privacy and security documentation files for downloaded artifacts.

### Changed
- Refined retrieval ranking weights to improve feature-change prediction accuracy.
- Simplified end-user analysis panel output to remove internal scoring noise.
- Improved shortest-path and dependency proximity behavior for ranking stability.

### Fixed
- Corrected runtime loading issue caused by invalid boolean constant casing in retrieval debug configuration.

## [1.0.4] - 19 March 2026

### Added
- Complete interactive RIG viewer redesign with split graph + inspector layout.
- Tabbed right panel with Overview, Node Details, Dependencies, Dependents, and Suggestions views.
- Role and edge-type legend toggles, hide-external and hide-tests quick filters.
- Dependency depth slider, request-term simulation filter, and neighborhood focus controls.
- Risk heatmap mode, blast-radius summary, dependency trace explorer, and architecture-smell indicators.
- Working set builder with clipboard export and compare mode for pinned nodes.
- Subgraph JSON export and graph PNG export actions from the viewer toolbar.

### Changed
- Node metadata now includes content preview to power richer inspector snippets.

## [1.0.3] - 19 March 2026

### Fixed
- Restored reliable `.architectiq/rig.json` and `.architectiq/rig-view.html` generation in multi-root workspaces.
- Improved workspace selection to avoid using extension source folder as scan target.
- Ensured `rig-view.html` is recreated on cache-hit runs when missing.

## [1.0.2] - 19 March 2026

### Changed
- Fixed Python import resolution so absolute module imports (e.g. `app.pricing`) connect to real workspace files.
- Improved workspace detection in multi-root setups to scan the active project instead of extension source.
- Applied depth-aware scanner exclusion behavior consistently for better file coverage in nested projects.

## [1.0.1] - 19 March 2026

### Changed
- Marketplace publish version bump and metadata updates.

## [1.0.0] - 19 March 2026

### Added
- Initial release
- Repository scanning for TypeScript, JavaScript, React, Next.js, Python
- Dependency graph construction
- Architectural prompt generation from plain-English input
- VS Code sidebar panel with prompt input and output UI
- Copy-to-clipboard functionality
