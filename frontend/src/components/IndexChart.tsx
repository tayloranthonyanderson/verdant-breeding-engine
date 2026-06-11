"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { IndexRow } from "@/lib/types";

export default function IndexChart({ rows }: { rows: IndexRow[] }) {
  const data = rows.slice(0, 15).map((r) => ({
    genotype: r.genotype,
    index: r.index,
  }));
  const max = Math.max(0.0001, ...data.map((d) => Math.abs(d.index)));

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 26)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <XAxis type="number" domain={[-max, max]} hide />
        <YAxis
          type="category"
          dataKey="genotype"
          width={72}
          tick={{ fontSize: 11, fill: "#475569" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(16,185,129,0.06)" }}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            fontSize: 12,
          }}
          formatter={(value) => [Number(value).toFixed(3), "index"]}
        />
        <Bar dataKey="index" radius={[4, 4, 4, 4]} barSize={16}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.index >= 0 ? "#10b981" : "#f43f5e"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
