# Security Guidance

This document provides secure usage guidance for ArchitectIQ.

## Security Model

ArchitectIQ is an assistant for architectural impact prediction. It is not a security scanner and does not replace:

- threat modeling
- static/dynamic security testing
- dependency vulnerability scanning
- code review and approval workflows

## Threat Considerations

Potential risks if misused:

- accidental disclosure of internal architecture details
- sharing sensitive file paths, symbols, or code context externally
- over-trusting generated recommendations without review

## Secure Deployment Checklist

1. Install only trusted extension packages.
2. Validate package integrity through your software supply chain process.
3. Keep VS Code and extension dependencies up to date.
4. Restrict extension usage to trusted workspaces and users.
5. Enforce policy on where generated outputs may be shared.
6. Use least privilege on developer endpoints.

## Secure Usage Checklist

1. Review generated file lists before implementation.
2. Do not include secrets or credentials in user prompts.
3. Redact sensitive output before sharing to third-party services.
4. Keep repository-level .gitignore rules aligned with generated artifacts.

## Incident Response

If sensitive information is exposed through copied output:

1. Revoke affected secrets/tokens immediately.
2. Rotate credentials and invalidate leaked access paths.
3. Remove exposed artifacts from external systems where possible.
4. Run post-incident review and update usage controls.
