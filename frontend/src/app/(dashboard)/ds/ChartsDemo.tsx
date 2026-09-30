"use client";

import { Card } from "@/components/ds/Card";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { FunnelBars } from "@/components/charts/FunnelBars";
import { MultiLineForecast } from "@/components/charts/MultiLineForecast";
import { Sparkline } from "@/components/charts/Sparkline";
import { StackedRiskBars } from "@/components/charts/StackedRiskBars";
import { VolumeComposed } from "@/components/charts/VolumeComposed";

const DAYS = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 1 + i));
  const label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const shipments = 18 + Math.round(6 * Math.sin(i / 3) + (i % 5));
  return { day: label, shipments, delivered: Math.max(0, shipments - 2 - (i % 3)), transit: 5.5 + Math.round(10 * Math.cos(i / 4)) / 10 };
});

const FORECAST = Array.from({ length: 14 }, (_, i) => {
  const base = 320 + Math.round(40 * Math.sin(i / 2));
  return {
    day: `D${i + 1}`,
    actual: i < 8 ? base : null,
    predicted: base + (i % 3) * 6 - 6,
    upper: base + 30,
  };
});

const DISTRICTS = [
  { district: "Jaipur Rural", healthy: 5, monitor: 2, stress: 1, critical: 0 },
  { district: "Alwar", healthy: 4, monitor: 2, stress: 1, critical: 1 },
  { district: "Bikaner", healthy: 3, monitor: 2, stress: 2, critical: 1 },
  { district: "Udaipur", healthy: 6, monitor: 1, stress: 1, critical: 0 },
  { district: "Kota", healthy: 3, monitor: 2, stress: 2, critical: 1 },
];

export function ChartsDemo() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Shipments per day, last 30 days" eyebrow="AreaTrend" footer="Simulated operational data.">
        <AreaTrend data={DAYS} xKey="day" series={[{ key: "shipments", name: "Shipments" }]} unit="shipments" />
      </Card>
      <Card title="Shipments and delivered per day" eyebrow="VolumeComposed" footer="Simulated operational data.">
        <VolumeComposed data={DAYS} xKey="day" bar={{ key: "shipments", name: "Shipments" }} line={{ key: "delivered", name: "Delivered" }} />
      </Card>
      <Card title="Facilities by risk level, per district" eyebrow="StackedRiskBars">
        <StackedRiskBars data={DISTRICTS} categoryKey="district" />
      </Card>
      <Card title="OPD footfall, visits per day" eyebrow="MultiLineForecast">
        <MultiLineForecast
          data={FORECAST}
          xKey="day"
          forecastFrom="D8"
          series={[
            { key: "actual", name: "Actual" },
            { key: "predicted", name: "Forecast", dashed: true },
            { key: "upper", name: "Upper bound", dashed: true },
          ]}
          unit="visits"
        />
      </Card>
      <Card title="Recommendation to delivery, count" eyebrow="FunnelBars">
        <FunnelBars
          stages={[
            { label: "Recommended", value: 120 },
            { label: "Approved", value: 96 },
            { label: "Loaded", value: 90 },
            { label: "In transit", value: 84 },
            { label: "Delivered", value: 78 },
          ]}
        />
      </Card>
      <Card title="Sparkline" eyebrow="Inline">
        <div className="flex items-center gap-6">
          <Sparkline data={DAYS.map((d) => d.shipments)} width={160} height={36} color="var(--series-1)" />
          <Sparkline data={DAYS.map((d) => d.transit)} width={160} height={36} color="var(--series-2)" />
        </div>
      </Card>
    </div>
  );
}
