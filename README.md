# Colibri 🐦 — SAP Project System, alive

A white-label web platform for **SAP Project System (PS)** built to make Fiori feel beige:
spring-physics charts, choreographed transitions, one-click corporate rebranding, and
SAP-shaped security — with the SAP backend fully mocked today and swappable for the real
OData APIs the day you get system access.

Charting is powered by [nova-charts](https://github.com/vthibeault/nova-charts) — every data
change morphs, every entrance is staggered, every hover breathes.

## What's inside

| Area | What you get |
|---|---|
| **Portfolio overview** | Animated KPI tiles with count-ups & sparklines, `BudgetFlowChart` of the active portfolio (ribbon = budget, fill = burn, color = health), spend `StreamChart`, cumulative burn, health table |
| **Projects** | Searchable, filterable, staggered project cards with CPI / progress / health, plus a guided **New project wizard** (template phases, budget shares, review) that posts through the SAP seam |
| **Resources** | Portfolio work-centre load: brand-aware heatmap of scheduled activity-days per centre and month, stacked demand by project |
| **⌘K palette** | Command palette from anywhere: jump to any project or page, toggle dark mode, start a new project — authorization-aware |
| **Project workspace** | Overview (budget flow per phase, milestones, waterfall), **WBS & Schedule** (`CascadeChart` critical-path what-if + a full MS-Project-style `GanttEditor` with save-back), **Costs** (stacked categories, treemap, burn), **Forecast** (`ForecastChart` Monte-Carlo ridges, P50/P85/P95) |
| **Brand studio** | Live white-labeling: name, monogram, accent, radius, typography, light/dark/system, validated chart palettes — applied instantly across the app *and* every chart |
| **Integration** | Mock ⇄ live switch, gateway config, connection test, and an honest map of which SAP endpoints are wired vs. need mapping |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — sign in with any persona
npm run build      # typecheck + production bundle
```

No SAP system needed: the default **mock mode** serves a seeded, deterministic PS portfolio
(7 projects, WBS phases, network activities, milestones, monthly cost lines) with realistic
latency. Schedule edits and status changes persist to localStorage like a system of record.

## Architecture

```
src/
  sap/                    ← the SAP seam
    types.ts              domain model (PROJ / PRPS / activities / costs / auth objects)
    client.ts             SapPsClient interface + config + factory  ← the ONLY seam the UI sees
    mock/                 seeded dataset + MockSapClient (default)
    odata.ts              ODataSapClient → S/4HANA OData (CSRF handshake, field mapping)
    auth.ts               PFCG-style roles → authorization objects, authorityCheck()
  theme/branding.ts       BrandConfig → CSS custom properties (incl. --nova-* chart vars)
  state/                  Brand / Sap / Auth React contexts
  charts/NovaChart.tsx    React bridge: create → morph on data → recreate on rebrand
  pages/                  Dashboard, Projects, ProjectDetail, BrandStudio, Integration, Login
vendor/nova-charts/       vendored chart library (see vendor/nova-charts/README.md)
```

### Going live against real SAP

Everything the UI does flows through `SapPsClient`. To test with a real system:

1. Copy `.env.example` → `.env`, set `VITE_SAP_MODE=live`, `VITE_SAP_BASE_URL`
   (and `SAP_GATEWAY_URL` for the dev-server CORS proxy). Credentials go in `.env`
   (communication arrangement **SAP_COM_0308**) or ride on SSO cookies — they are never
   stored in the browser.
2. Projects and WBS already map to **`API_ENTERPRISE_PROJECT_SRV_0002`**
   (`A_EnterpriseProject`, `A_EnterpriseProjectElement`), including the
   `x-csrf-token` handshake for writes.
3. Network activities, milestones, and cost lines need a service decision per tenant
   (custom CDS or released query) — each method in `src/sap/odata.ts` documents the
   recommended SAP artifact and throws a clear message until mapped. The **Integration**
   page shows the same map in-app, plus a connection test button.

### Security model

Colibri mirrors SAP's authorization concept instead of inventing its own: PFCG-style roles
(`Z_PS_PROJECT_MANAGER`, `Z_PS_CONTROLLER`, `Z_PS_EXECUTIVE`, `Z_COLIBRI_ADMIN`) bundle
authorization objects (`C_PROJ`, `C_PRPS`, `C_AFKO`, `K_BUDG`, `Z_COLIBRI_BRAND`) with SAP
activity codes (01 create / 02 change / 03 display / 06 delete). The UI gates every mutating
affordance through `authorityCheck()` — e.g. the Gantt editor requires `C_AFKO/02` and
falls back to a read-only Gantt without it; Brand Studio requires `Z_COLIBRI_BRAND/02`.
In live mode, map your gateway's identity/role claims in `ODataSapClient.getCurrentUser`.

### White-labeling

A brand is one JSON object (`BrandConfig`): identity, accent, shape, type, chart palette,
color mode. `applyBrand()` writes it as CSS custom properties on `<html>`; app styles and
nova-charts (`--nova-c1…c8`, fonts, grid, tooltips) both consume them, so a rebrand restyles
the entire platform — charts included — with zero component changes. Ship defaults via
`BRAND_PRESETS`, or let admins tune everything live in **Brand Studio**.

Chart palettes are **validated** (lightness band, chroma floor, adjacent-pair CVD ΔE ≥ 12,
contrast vs. surface — per light *and* dark surface). Slot order is the color-blindness
safety mechanism; add new palettes only after running them through a palette validator.

### nova-charts

Vendored from source at `vendor/nova-charts` (the package isn't on npm yet and ships no
committed build). It's zero-dependency TypeScript, so Vite compiles it directly via the
`nova-charts` alias — imports look exactly like the npm package, and swapping to the real
package later is a two-line config change. Details in `vendor/nova-charts/README.md`.

## Scripts

- `npm run dev` — dev server (with optional SAP proxy via `SAP_GATEWAY_URL`)
- `npm run build` — `tsc --noEmit` + production build
- `npm run preview` — serve the production build
- `npm run typecheck` — types only
