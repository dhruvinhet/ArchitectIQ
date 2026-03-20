# Privacy Notice

ArchitectIQ is designed for local repository analysis in VS Code.

## Data Processing Scope

ArchitectIQ processes repository metadata and code structure, including:

- file paths and dependency relationships
- imports/exports and symbol names
- selected content-derived signals used for relevance ranking
- local Git history metadata for co-change analysis (when available)

## Processing Location

- Core analysis is performed in the local VS Code extension host.
- Generated graph artifacts are stored in the local workspace.
- Local Git commands are used to compute change-coupling signals.

## Data Sharing

ArchitectIQ does not require a custom remote ingestion service for core analysis.

However, users may manually copy generated prompts or analysis into external systems. That action is user-controlled and outside extension enforcement.

## User Responsibilities

1. Treat generated prompts and analysis as potentially sensitive.
2. Redact confidential file paths, symbols, and implementation details before external sharing.
3. Follow your organization's data classification and retention policies.

## Retention

Workspace artifacts and outputs remain under your local repository/workspace unless you explicitly export or share them.

## Recommended Controls

- Use private repositories and trusted developer environments.
- Restrict workspace access permissions.
- Use secret-scanning and DLP controls where required.
