# brAIn

Monorepo for work in progress project.


## Project structure

- apps/: application services (api, admin, worker, etc.)
- packages/: shared libraries used across apps

## Notes

- The API dev script in [`apps/api/package.json`](apps/api/package.json:8) uses:
  [`nodemon --watch src --ext ts --exec ts-node src/index.ts`](apps/api/package.json:8)
- Use workspace filters (`pnpm --filter`) to run scripts across packages.
