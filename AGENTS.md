# Bop workspace

- Run `npm run dev` from the repository root to start the local trip planner on port 8787. The browser code lives in `web/` and the Node.js API lives in `server/`.
- Edit assets in `web/`. `npm run build` copies them to `dist/` for deployment. Use `npm test` for application checks and `pre-commit run --all-files` for repository checks.
- Read the matching requirements in `openspec/specs/` when changing planner behavior.
- For AWS changes, follow [the Terraform runbook](terraform/README.md). `terraform/bootstrap/` manages the OIDC role and state bucket. `terraform/app/` manages the application stack.
