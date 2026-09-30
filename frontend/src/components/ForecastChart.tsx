"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface Point {
  day: string;
  predicted: number;
  actual?: number;
}

interface Breakdown {
  label: string;
  value: number;
}

export function ForecastChart({
  series,
  breakdown,
}: {
  series: Point[];
  breakdown: Breakdown[];
}) {
  return (
    <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
      <div className="border border-hairline bg-paper-dim/40 p-5">
        <p className="text-[11px] tracking-[0.14em] uppercase text-ink-soft mb-4">
          Footfall Forecast — 7 Days
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={series}>
            <CartesianGrid stroke="#D8CBB4" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="day"
              stroke="#4A433A"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: "#D8CBB4" }}
            />
            <YAxis stroke="#4A433A" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                background: "#F4EEE4",
                border: "1px solid #D8CBB4",
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="predicted"
              stroke="#8A6D3B"
              fill="#8A6D3B"
              fillOpacity={0.15}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="#B5502E"
              fill="#B5502E"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="border border-hairline bg-paper-dim/40 p-5">
        <p className="text-[11px] tracking-[0.14em] uppercase text-ink-soft mb-4">
          Tomorrow&apos;s Breakdown
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={breakdown} layout="vertical" margin={{ left: 10 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              stroke="#4A433A"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              width={70}
            />
            <Tooltip
              contentStyle={{
                background: "#F4EEE4",
                border: "1px solid #D8CBB4",
                fontSize: 12,
              }}
            />
            <Bar dataKey="value" fill="#B5502E" radius={[0, 3, 3, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
