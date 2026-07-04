# Vendored: nova-charts

This directory is the `src/` of [`vthibeault/nova-charts`](https://github.com/vthibeault/nova-charts),
vendored at commit `edbc87e1703576e1930372b10277f244c3cee895` (tests stripped).

nova-charts is zero-dependency TypeScript, so we compile it straight from
source: `vite.config.ts` and `tsconfig.json` alias the module name
`nova-charts` to `vendor/nova-charts/index.ts`. Application code imports it
exactly as if it were installed from npm:

```ts
import { CascadeChart, GanttEditor } from 'nova-charts';
```

## Refreshing the vendored copy

```bash
git clone --depth 1 https://github.com/vthibeault/nova-charts /tmp/nova-charts
rm -rf vendor/nova-charts && cp -r /tmp/nova-charts/src vendor/nova-charts
find vendor/nova-charts -name '*.test.ts' -delete
# restore this README, update the commit hash above
```

## Swapping to the published package (once it's on npm or built)

1. `npm install nova-charts` (or `npm install github:vthibeault/nova-charts`
   once the repo ships a `dist/` via a `prepare` script).
2. Delete the `nova-charts` alias from `vite.config.ts` and the `paths` entry
   in `tsconfig.json`.
3. Delete this directory. No import changes needed anywhere.

Licensed MIT by its author.
