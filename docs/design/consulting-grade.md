# Consulting-grade dashboard bar (binding for lane F and for chart work in lane D)

The dashboard must read like a management-consulting operations review, dense and structured, and it must answer "so what" on every card. A judge should be able to look at any page for five seconds and state the finding. This document is added to plan sections 4 and 9.3 to 9.9 and does not replace them.

## Rules for every page

1. **Action titles.** Every card title states the finding, with the metric name as the eyebrow. Example: eyebrow `Emergency medicine cover`, title `Kota has 3 facilities under 3 days of ARV`. Titles are computed from live data (a small pure function per card, unit tested), never hard coded numbers.
2. **Layered density.** Each page has: a KPI band (6 tiles with delta and sparkline), one hero visual (map or heatmap), two to three analytic charts, and at least one ranked table with inline bars. Minimum 8 distinct data cards per page for Command Centre, Districts, District detail, Facility profile, Supply Dispatch.
3. **Chart repertoire (use several, not only bars):** choropleth map, facility by dimension heatmap, medicine by district heatmap, ranked league table with inline bars, stacked risk bars, small multiples per district, area plus line combo, funnel (recommendation to fulfilled), Gantt, donut for status mix, gauge for utilisation, sparkline in every KPI, waterfall for "stock in, consumption, stock out" per medicine if data allows.
4. **Annotations.** Charts carry direct labels on the important point (worst district, peak day, breach) and a one line "Read" caption under the chart.
5. **Source and method footer** on each card that shows derived numbers, in 11 px muted text: `Source: SwasthyaGrid seed data, forecast method days of cover = units / avg daily use`. Supply pages carry the provenance footer from plan 4.1 item 6.
6. **Comparability.** Whenever a metric is shown for one district, show the state average or the other four districts next to it (a thin reference line or a peer bar).
7. **Every number is a link or has a tooltip** giving definition and time basis. Tooltips use `ChartTooltip`.
8. **Executive header.** Command Centre opens with a three-line auto-generated "Situation" banner (from the briefing endpoint, template fallback) above the KPI band: one sentence on state risk, one on supply movement, one on the recommended next action with a button.
9. **Stress test the empty and scale cases:** with the backend offline the same layout renders from fixtures; with a district scope the same cards re-render for that scope.
10. **Polish list:** tabular mono numbers, consistent 12 px radius, no default browser controls, focus rings, keyboard reachable rows, skeleton loaders that match the final layout, no layout shift, dark and light both reviewed.

## Extra content that makes a judge remember it (build after the plan's screens work)

- **Impact panel** on Command Centre: "Stock-outs prevented by approved shipments" (count and units from delivered shipments whose facility was under 3 days), average recommendation to delivery time, on-time delivery rate, vaccine cold chain compliance. All from the simulator, labelled simulated.
- **What-if strip** on Recommendations: toggle "approve all critical" and show the projected change in critical facility count and stock-out items (computed client side from the recommendation payload and the facilities' days of cover).
- **District scorecard** printable page (`/districts/[id]` print stylesheet) that fits one A4 page: KPIs, heatmap row, top 5 risks, actions taken.
- **Timeline of the last 20 events** in the Command Centre right rail with icons per event type.
- **Keyboard shortcuts overlay** (`?`) and Cmd/Ctrl K palette already planned.

## Patterns borrowed from the case-competition-deck skill (binding additions)

These come from the winning-deck playbook in `case-competition-deck.skill` (archetypes I, J, M, N, K, P and the "reusable patterns" list) and translate directly to dashboard cards.

1. **Two-chart action-title card (the workhorse).** Default analytic card is a pair: left chart establishes the trend, right chart shows the implication, under one full-sentence finding headline with a number. Example: left `Stock cover by district over 14 days`, right `Which facilities drive the drop`, headline `Kota lost 4.1 days of ARV cover in a week, driven by 3 facilities`.
2. **Annotation callouts on every chart.** At least one callout pointing at a specific data point with what it means (worst district, peak day, breach, delivery that fixed a stock-out).
3. **Moneyshot number.** Each page has exactly one hero number in the strongest colour, large, with a one line explanation: Command Centre `10 of 40 facilities critical`, Supply `87% on time`, Inventory `12 stock-outs inside 3 days`. Only the moneyshot uses the top-severity colour outside chips.
4. **Three-scenario projection.** Forecast cards (footfall, stock cover, bed pressure) offer a Pessimistic / Realistic / Optimistic switch with the three named assumptions shown under the chart (for example demand surge +25 percent, baseline, -10 percent). Computed client side from the forecast series.
5. **Sensitivity matrix.** On `/recommendations` add a 5 by 5 matrix: rows share of pending recommendations approved (0, 25, 50, 75, 100 percent), columns average delivery delay (0, 30, 60, 120, 240 minutes), cells projected critical facilities at day 3. Base case cell outlined. Uses the heatmap colours.
6. **MECE option filter.** Each recommendation card can expand to "Options considered": DDW replenishment, central replenishment, lateral transfer, each with distance, ETA, cost of delay and a tick or cross against shared criteria (in range, stock available, cold chain, ETA under threshold), ending with the chosen option.
7. **Symmetry.** Comparisons across districts or options use identical card structures side by side, same axes and scales.
8. **Triads.** Prefer three column groupings (three KPI bands of three, three scenarios, three lenses). Colour discipline: three to five colours per page plus risk and status semantics.
9. **Sub-section label and source line** on every card, bottom edge: `Supply chain / Dispatch` bottom right, `Source: ...` bottom left.
10. **Defensive depth.** Every headline number links to the table or drawer that proves it (click a KPI to open its backing rows).
11. **Executive summary block** at the top of Command Centre in a two column For / Watch layout: left `What is working` (green ticks: on-time rate, stock-outs prevented), right `What needs action` (red: critical facilities, delayed shipments), each line a computed sentence.
12. **KPI tree.** On `/analytics` add a KPI tree (Performance score to stock, beds, staffing, diagnostics, each expanding to its drivers) as a connected node diagram with values.
