"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Deploy the agent",
    body: "Run vigil agent register then vigil agent start. The single binary collects Windows Event Logs or Linux journald and ships batches every 5 seconds.",
    code: "vigil agent register --name MY-BOX\nvigil agent start --profile standard",
  },
  {
    number: "02",
    title: "Detections fire automatically",
    body: "Every batch is evaluated against your Sigma rule library before the response returns. Matches become structured alerts with full event snapshots.",
    code: "# Matches fire synchronously\nvigil alerts list --status open --output json",
  },
  {
    number: "03",
    title: "Agents or humans investigate",
    body: "AI agents call vigil alerts list --output json and follow skills-based playbooks. Humans approve sensitive actions through the web UI or CLI.",
    code: "vigil alerts acknowledge <id> \\\n  --note \"Confirmed TP: lateral movement\"",
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 px-4 sm:px-6 bg-bg-card border-y border-border-subtle">
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
            How it works
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight">
            From endpoint to alert in under a second.
          </h2>
        </motion.div>

        {/* Steps */}
        <div className="grid md:grid-cols-3 gap-6 relative">

          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15, duration: 0.5 }}
              className="relative p-6 rounded-xl bg-bg-elevated border border-border-subtle"
            >
              {/* Step number */}
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-bg-card border border-border-subtle mb-4">
                <span className="text-xs font-mono font-bold text-accent-cyan">
                  {step.number}
                </span>
              </div>

              <h3 className="font-display font-semibold text-text-primary mb-2 text-base">
                {step.title}
              </h3>
              <p className="text-sm text-text-muted leading-relaxed mb-4">
                {step.body}
              </p>

              {/* Code */}
              <div className="rounded-lg bg-bg-primary border border-border-subtle p-3">
                <pre className="text-xs font-mono text-text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto">
                  {step.code}
                </pre>
              </div>

              {/* Arrow (not last) */}
              {i < steps.length - 1 && (
                <div className="hidden md:flex absolute -right-3 top-8 z-10 w-6 h-6 items-center justify-center rounded-full bg-bg-elevated border border-border-subtle">
                  <ArrowRight size={12} className="text-text-muted" />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
