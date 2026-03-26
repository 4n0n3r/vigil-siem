"use client";

import { motion } from "framer-motion";

const stats = [
  { value: "< 50ms", label: "detection latency" },
  { value: "Apache 2.0", label: "fully open source" },
  { value: "MITRE ATT&CK", label: "aligned detections" },
  { value: "1 binary", label: "the only agent dep" },
  { value: "ClickHouse", label: "event backend" },
];

export function TrustBand() {
  return (
    <section className="border-y border-border-subtle bg-bg-card py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.value}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className="flex flex-col items-center text-center"
            >
              <span className="text-lg font-display font-bold text-text-primary">
                {stat.value}
              </span>
              <span className="text-xs text-text-muted mt-0.5">{stat.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
