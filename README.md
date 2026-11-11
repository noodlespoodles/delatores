# Delatores

Delatores is an early MVP for executive codebase intelligence. It lets a user paste a public GitHub repository URL and receive a directional, plain-English technical risk report based on public repository signals.

## Current MVP

- Public GitHub repository URL intake
- Client-side GitHub REST API analysis
- Executive dashboard with category scores
- Top risks and questions to ask the engineering team
- Evidence appendix with GitHub links
- Browser print flow for PDF-style exports

## Run

Open `index.html` in a browser.

No build step or server is required for this first cut.

## What It Analyzes

- Repository metadata and recent activity
- File tree structure
- Likely source and test files
- CI configuration files
- Dependency manifests and lockfiles
- Documentation signals
- Contributor concentration
- Language profile

## Product Notes

The score is intentionally directional. It is designed to help founders, executives, investors, and new technical leaders ask better questions before committing money, hiring decisions, or roadmap promises to a codebase.

Next likely steps:

- Add a backend scanner for full clones and larger repos
- Add GitHub App read-only private repo access
- Persist analyses and trends over time
- Add dependency vulnerability scanning
- Add language-specific static analysis tools
- Generate branded PDF reports
