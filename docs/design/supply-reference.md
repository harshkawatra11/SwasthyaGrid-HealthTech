# Supply chain visual reference (binding for lane D)

The four screenshots in `images/` are the design target for every `/supply/*` page. Open the image with the Read tool before building the matching page and compare the result to it side by side (Playwright screenshot at 1440 px wide). Match layout, density, chip styles and chart types. Use our tokens (plan section 4), so the palette is our mint, amber, violet and status colours, not the screenshot's exact greens.

Only image 4 is high resolution. Images 1 to 3 are small, so what they contain is described here.

## Image 4: `Screenshot 2026-09-26 131342.png` (dark "Dispatch", the main reference for `/supply`)

Layout, top to bottom, at 1440 px:

1. Sidebar (already our shell). Content header: breadcrumb "Dashboard / Shipment map" left, date and weather right.
2. **Map card, full width of the content, about 400 px tall**, rounded 12 px, dark map with the road network faint, water in blue, parks in muted green blocks.
   - Search field top-left inside the map (translucent dark, magnifier icon, placeholder "Search"), an eye icon button beside it (layer toggle).
   - Fullscreen icon top-right, zoom plus and minus stacked bottom-right.
   - **Shipment pins**: each shipment is a compact label chip `[box icon] #4869 [status text]` with a small grey dot below-left marking the exact location. The chip is dark translucent with a 1 px border. The status word is coloured and sits on a tint of the same colour: Delivered green, In Transit amber, Loading blue, Delayed teal/cyan (we use orange), Cancelled red. Chips are placed all over the map, not only on trucks. Use our `LiveTruckLayer` chip: shipment id, then `StatusChip` compact.
   - **Stat overlay bottom-left** in mono, three lines: `Delivered Today: 543`, `In Transit Today: 301`, `On-Time Rate Today (%): 87%`.
3. **Bottom row, two columns** (left about 58%, right about 42%):
   - Left column, top card **"Shipments Volume & Transit Time"** with a `Month` select (top right): a smooth **green area chart** (shipments) with a lower **grey line** (average transit time) overlaid, x axis month labels (Feb, Apr, Jun, Jul, Sep, Nov), a vertical dashed hover guide with a tooltip card `05.06.2025 / Shipments 4634 / Avg. Time 8h 53m`. Area has a vertical gradient fill.
   - Left column, bottom row two small cards: **"Status Overview"** (a `Month` select, one horizontal **stacked bar** made of proportional coloured segments Delivered / In Transit / Loading / Delayed / Cancelled, with a legend of coloured dots below) and **"Vehicles in Transit"** (small delta `+5` in green, big number `78`, a truck illustration cropped at the right edge).
   - Right column, tall card **"Orders"** with `Total: 6489`, a `Month` select, filter icon and more icon. A scrolling list of order cards. Each card: `#783456901` and a status chip on the first line; below a two-column block: left a vertical **route timeline** (top marker is a filled triangle or dot, dashed line, bottom marker a diamond) with two address lines under the label "Shipment Route"; right "Est. delivery" with a date and "Total weight" with a value. Cards are separated by hairlines; the list has a thin scrollbar.
4. Visual tone: near-black surfaces (`--bg`, `--surface-1`), 1 px borders, 12 px radius, small labels in muted grey, numbers in a mono face, status colours used only on chips and chart segments.

## Image 1: `Screenshot 2026-09-26 130931.png` (light "Truck Visualization" plus shipment queue)

Small image. Contents to reproduce (in our dark tokens, light theme also works):

- **Truck Visualization card**: a photographic-style side view of a truck (we draw it as SVG) with the trailer shown cut away. Inside the trailer a **grid of coloured pallet blocks**, several rows high, colour coded by state, with a legend top right: Loaded, In Progress, Pending, Fragile. Below the truck a row of **six mini metric tiles** (icon, label, value), for example weight used, pallets, temperature, route progress, and one donut mini chart.
- **Shipment Queue card** (right column, tall): header "Shipment Queue" with an "Auto Assign" action. Rows: shipment id (`SHP-4728`), a **priority chip** (Priority, Standard, Restricted use tone colours) and a small **Load** button on the right. Below, "Load Assignment" footer action.
- **Route cards** (bottom left, two stacked): `Delhi to Mumbai` with an `In Transit` chip and metadata (pickup time, vehicle id) and `Mumbai to Pune` with a `Scheduled` chip and metadata (departure, load kg).
- **Truck & Capacity card** (bottom right): a large truck side photo style illustration on the left, on the right a capacity title, a utilisation bar `10,000 / 20,000 kg` and a percentage.

Maps to: `/supply/fleet` vehicle detail (`TruckCargoView` large), `/supply/planning` (queue), route cards on `/supply`.

## Image 2: `Screenshot 2026-09-26 131055.png` (light "Trucks Management" on a monitor)

- Page title "Trucks Management" with a subtitle sentence. Three KPI figures top right: **Weight 7,340 kg**, **Pallets 120**, **Alerts 62** (the alerts value is a purple pill).
- Large **truck side view with cargo bay grid**: the trailer is a grid of cells (rows by columns), most cells outlined grey, some filled, one selected cell highlighted purple.
- A horizontal strip of **shipment number cards** (small truck thumbnails with a shipment id such as `USA-14627855`) that the user scrolls sideways.
- **Gantt chart** at the bottom titled "Gantt Chart" with a `Freight Orders` select: left column of freight orders (id, vehicle), the time axis across (days), **solid purple bars** for scheduled trips with a label inside each bar, lighter grey bars for other work, a vertical "now" marker line in red.
- Right panel top: **"Load Planning"** list of checkable rows with a truck id and small status pills, and a search or filter.

Maps to: `/supply/planning` (KPI strip, `TruckCargoView`, `FleetGantt`). Our Gantt uses our series colours (violet for driving, cyan for loading, orange hatched for incidents) and the red now line.

## Image 3: `Screenshot 2026-09-26 131117.png` (light fleet and driver panel on a laptop)

- Three-pane layout: **fleet list** on the left (vehicle id, a green `Active` style chip, route text, small status rows), a **light map** in the centre with a thin route line and a moving marker, and a **detail panel** on the right for the selected vehicle and its driver: header with vehicle id, key facts as label/value rows, and a **driver photo strip** (we use `Avatar` initials, no photos) with name, licence and rating.

Maps to: `/supply/drivers` (roster, map, `DriverPanel`) and the vehicle list on `/supply/fleet`.

## Fidelity checklist (the reviewer will use this)

1. `/supply` reads as image 4: full-width dark map with labelled status chips scattered on it, the mono stat overlay bottom-left, area plus line chart with hover tooltip, stacked status bar, big "Vehicles in Transit" number, and the Orders list with route timelines.
2. `/supply/fleet` and `/supply/planning` show the cut-away truck with the coloured pallet grid and legend, KPI trio (weight, pallets, alerts), the shipment queue with priority chips and Load buttons, and the Gantt with the red now line.
3. `/supply/drivers` shows the three-pane list, map and detail layout.
4. Every chip is a word plus colour, never colour alone. Numbers are mono. Density matches the screenshots: many small cards, no big empty areas.
5. Take a Playwright screenshot of each finished page at 1440 x 900 into `docs/v2-shots/` and describe, in the task report, what differs from the reference image and why.
