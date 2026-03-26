"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const tactics = [
  { name: "Initial Access", covered: true, count: 1 },
  { name: "Execution", covered: true, count: 3 },
  { name: "Persistence", covered: true, count: 2 },
  { name: "Privilege Escalation", covered: true, count: 1 },
  { name: "Defense Evasion", covered: true, count: 4 },
  { name: "Credential Access", covered: true, count: 4 },
  { name: "Discovery", covered: true, count: 1 },
  { name: "Lateral Movement", covered: true, count: 2 },
  { name: "Command & Control", covered: true, count: 1 },
  { name: "Exfiltration", covered: false, count: 0 },
  { name: "Impact", covered: false, count: 0 },
];

const severityData = [
  { label: "CRITICAL", pct: 15, color: "bg-accent-red", textColor: "text-accent-red", count: 2 },
  { label: "HIGH", pct: 30, color: "bg-accent-amber", textColor: "text-accent-amber", count: 4 },
  { label: "MEDIUM", pct: 40, color: "bg-yellow-400", textColor: "text-yellow-400", count: 5 },
  { label: "LOW", pct: 15, color: "bg-accent-green", textColor: "text-accent-green", count: 2 },
];

export function DetectionCoverage() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="py-24 px-4 sm:px-6 bg-bg-card border-y border-border-subtle">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-3">
            Detection library
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight mb-4">
            Built-in detections. Write your own in YAML.
          </h2>
          <p className="text-text-muted max-w-xl mx-auto text-sm leading-relaxed">
            Ships with 13 Sigma rules across 9 MITRE ATT&CK tactics. Add your own
            with <code className="font-mono text-accent-cyan bg-bg-elevated px-1 rounded">vigil detections create</code>.
          </p>
        </motion.div>

        {/* MITRE Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-12">
          {tactics.map((tactic, i) => (
            <motion.div
              key={tactic.name}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={inView ? { opacity: 1, scale: 1 } : {}}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className={`p-4 rounded-lg border transition-all duration-300 ${
                tactic.covered
                  ? "bg-accent-cyan/5 border-accent-cyan/30 hover:border-accent-cyan/50"
                  : "bg-bg-elevated border-border-subtle opacity-40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`text-xs font-display font-semibold leading-snug ${
                    tactic.covered ? "text-text-primary" : "text-text-muted"
                  }`}
                >
                  {tactic.name}
                </span>
                {tactic.covered && (
                  <span className="flex-shrink-0 text-xs font-mono text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded">
                    {tactic.count}
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Severity bar */}
        <div className="max-w-2xl mx-auto">
          <p className="text-xs text-text-muted text-center mb-4 font-mono uppercase tracking-widest">
            Alert severity distribution
          </p>
          <div className="flex h-3 rounded-full overflow-hidden gap-px bg-bg-primary mb-4">
            {severityData.map((s, i) => (
              <motion.div
                key={s.label}
                className={s.color}
                initial={{ width: 0 }}
                animate={inView ? { width: `${s.pct}%` } : { width: 0 }}
                transition={{ delay: i * 0.1 + 0.3, duration: 0.6, ease: "easeOut" }}
              />
            ))}
          </div>
          <div className="flex justify-center gap-6">
            {severityData.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-sm ${s.color}`} />
                <span className={`text-xs font-mono ${s.textColor}`}>
                  {s.label}
                </span>
                <span className="text-xs text-text-muted">({s.count})</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
