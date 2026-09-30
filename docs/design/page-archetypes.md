# Page archetypes (binding for lane F, and for lane D where it applies)

The failure to avoid: every tab being the same "title, KPI row, table" template with a new background. Each page below has its own layout archetype, its own hero visual, and its own mix of charts. Two pages must never share the same top-level arrangement. Read `consulting-grade.md` too.

Data comes only from the v2 hooks (`lib/api/hooks.ts`). Every card title is a computed finding (action title), with the metric as eyebrow. Every page has a KPI band with sparklines, but the KPI band is never the main event.

| Page | Archetype | Hero visual (top, largest) | Supporting visuals (all required) |
|---|---|---|---|
| `/command` | War room | Choropleth of the 5 districts by risk index with facility dots and live trucks, beside a district league table with inline bars | Facility by dimension heatmap (40 rows grouped by district, 6 columns), medicine by district heatmap, 7 day footfall multi-line, stacked risk bars, critical watchlist, pending approvals with inline approve, supply exceptions, AI briefing, impact panel, last 20 events timeline |
| `/districts` | Comparison lab | Small multiples: five identical district cards side by side, each with risk gauge, risk mix bar, footfall sparkline, top shortage, in transit count | Sortable comparison matrix of every metric with heat-coloured cells, quadrant scatter (x: stock cover, y: bed pressure, bubble: footfall) with the 5 districts labelled, grouped bars stock-outs vs pending approvals |
| `/districts/[id]` | Deep dive report | Zoomed district map with facilities, warehouse and live trucks next to a 7 KPI band | Facility table with risk chips and mini bars, footfall actual vs predicted with a tomorrow breakdown, causal chain flow, district warehouse cover as meters, recommendation list, print stylesheet scorecard |
| `/facilities` | Directory with a lens switch | Segmented lens (Risk, Stock, Beds, Staffing, Performance) that recolours a 40 tile grid map-like matrix and the table below | Ranked table with inline bars per lens, risk mix donut, distribution histogram of performance scores |
| `/facilities/[id]` | Case file | Header strip with risk, district link, performance radar-like five bars | Medicine cover meters against 21 days, bed triple meter, doctors and diagnostics panels, inbound shipment trackers, recommendation timeline, causal chain |
| `/map` | GIS console | Full-height map with layer panel, legend and right drawer | Choropleth, facilities, warehouses, live trucks, active routes, delayed only, drawer with charts per selection |
| `/recommendations` | Decision desk | Kanban-like columns Pending, Approved and moving, Completed, Rejected and expired with cards | Funnel (generated, approved, dispatched, fulfilled), what-if strip (approve all critical, projected critical count), approvals by district table |
| `/inventory` | Heatmap-first | Facilities by medicines heatmap (40 x 7, days of cover) full width | Stock-out ladder (facilities sorted by minimum cover), emergency medicine cover by district, expiring and cold chain at risk cards, full stock table with filters |
| `/footfall` | Forecast studio | Forecast fan chart (actual, predicted, confidence band) for the selected district | Calendar heatmap district by next 7 days, tomorrow breakdown bars, five district comparison, factor chips |
| `/beds` | Capacity board | Occupancy strip heatmap (facility rows, columns now, tomorrow, next week) | Capacity waterfall (total beds, occupied, predicted extra, free), redirect recommendations, top 10 pressure list with meters |
| `/doctors` | Roster and attendance | Attendance heat calendar (doctor rows, weekday columns) | Absence risk ranking, patient delay bars, staff-transfer recommendations, coverage by district |
| `/diagnostics` | Availability matrix | Facilities by tests matrix (available, degraded, down) | Downtime bars, nearest alternative table with distance, district availability donut |
| `/analytics` | Analyst workbench | Causal chain explorer for a chosen facility as a connected flow | Performance scorecard heat table, forecast confidence histogram, correlation style small multiples, last 20 events |
| `/supply` | Live dispatch monitor | Exactly as `docs/design/supply-reference.md` (image 4) | as that file |
| `/supply/fleet`, `/supply/planning`, `/supply/drivers` | as images 1 to 3 | as `supply-reference.md` | as that file |

## Rules that stop the "same dashboard" look

1. Different hero per page (table above). No page opens with a plain table.
2. At least three distinct chart types per page, and at least one heatmap or matrix on every analytic page.
3. Vary the grid: some pages use 8+4, some 3 equal columns, some full-bleed map, some board columns. The reviewer compares the screenshots side by side, and two pages with the same silhouette fail.
4. Density: minimum 8 data cards per page (10 on `/command`), no empty gutters larger than 24 px.
5. Every page has a distinct accent use: the page's hero visual owns the brightest colour, everything else stays muted.
6. Screenshot every page at 1440 x 900 (dark and light) into `docs/v2-shots/` and include them in the report; the orchestrator will reject pages whose silhouette matches another page.
