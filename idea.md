# Medieval Code — Code-Visualized 3D Pixel Art Town

Parse a codebase and explore it as a **3D isometric voxel town** — Age of Empires style. Cute blocky pixel-art buildings rise from grass terrain; districts are walled quarters connected by roads and bridges.

## Core metaphor

**Code structure becomes architecture in 3D.** Folders are walled districts, files are streets of buildings, and you fly an RTS camera over your kingdom.

## Mapping rules

| Code construct | Building | Size rule |
|---|---|---|
| Package / top-level folder | **District** (walled quarter) | LOC + file count → footprint |
| Source file | **Street row** | Constructs left-to-right in source order |
| `class` / `struct` / `enum` | **Castle** | LOC → tower height; members → walls |
| `interface` / `type` alias | **Bridge** | Spans between modules |
| `function` / `method` | **House** | Params → width; body LOC → height |
| `for` / `while` / `loop` | **Factory** | Nesting depth → smokestacks |
| `if` / `else` | **Church** | Branch count → spires |
| `switch` / `match` | **Cathedral** | Cases → stained glass |
| `try` / `catch` | **Guard tower** | Catch clauses → platforms |
| `import` / `require` | **Shop** | Import count → storefront width |
| `export` | **Town square flag** | Banner poles |
| Top-level `const` / `let` | **Tree / lamp** | Decorative gap filler |
| Test files | **Training grounds** | Lavender palette |
| Config files | **Town hall** | Landmark sprite |
| Overflow (caps hit) | **Tenement** | `+N more` aggregation |

## Layout

```
[ District: src/ ]
  [ File row: auth.ts ] → Shop + Castle + Houses + Church + Trees
  [ File row: api.ts  ] → Factory + Houses + Trees
  --- road ---
[ District: tests/ ]
  ...
```

- Buildings placed **left to right** in order of appearance
- Rows connected by pixel roads; districts connected by bridges (import edges)
- Deterministic 1–3px vertical jitter per building (organic feel)
- Same-type buildings share a palette with per-instance hue variation

## Hierarchy (complex repos)

- **Kingdom** = repository
- **District** = folder group (e.g. `src/auth`)
- **Neighborhood** = file
- **Import edge** = bridge/road between districts

## Scaling

1. Respects `.gitignore` + denylist (`node_modules`, `.git`, `dist`, `vendor`, …)
2. Caps (defaults): 500 files, 80 constructs/file, 512px row width
3. Aggregation into **tenement** sprites when caps exceeded
4. **LOD**: zoomed out → district silhouettes; mid → rows; close → labels + animations
5. Viewer filters: folder, language, construct type, symbol search

## Usage

```bash
npm install && npm run build
node packages/cli/dist/index.js scan ./my-project --open
```

Config: `.medieval-code.json` — see [README.md](README.md).

## Visual polish

- **3D voxel buildings** with flat-shaded pixel-art colors
- Language palettes: `.ts` cool slate, `.js` warm amber, `.py` sage green
- Sky themes: `dawn` | `day` | `dusk` | `night`
- Factory smoke particles, church windows, district banners
- Isometric RTS camera: pan, zoom, Q/E rotate
- Click building → `vscode://file/...`

## Architecture

```
CLI scan → Parser → Layout → town.json → Three.js 3D Viewer (voxel meshes)
```

Packages: `model`, `parser`, `layout`, `viewer`, `cli` — npm workspaces monorepo.

See [README.md](README.md) for full documentation.
