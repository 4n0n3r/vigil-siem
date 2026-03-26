"use client";

import { motion } from "framer-motion";
import {
  Zap,
  Shield,
  Search,
  UserCheck,
} from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Ingest anything.",
    body: "Push events from any source over HTTP. The agent runs as a single static binary on Windows and Linux — no installer, no config file needed.",
    snippet: `vigil agent register --name PROD-BOX-01\nvigil agent start --profile standard`,
    iconColor: "text-accent-cyan",
    borderHover: "hover:border-accent-cyan/40",
  },
  {
    icon: Shield,
    title: "Sigma rules. Real time.",
    body: "Every ingested event is evaluated against your rule set before the HTTP response returns. Write detection logic in standard Sigma YAML.",
    snippet: `vigil detections create --file brute_force.yml\nvigil alerts list --severity high --output json`,
    iconColor: "text-accent-amber",
    borderHover: "hover:border-accent-amber/40",
  },
  {
    icon: Search,
    title: "Hunt with HQL.",
    body: "Query the full event history with aggregations and timelines. Filter by endpoint, time range, and field values. 100% JSON output.",
    snippet: `vigil hunt --query "event_id:4625" \\\n  --agg event_data.IpAddress \\\n  --timeline --output json`,
    iconColor: "text-accent-green",
    borderHover: "hover:border-accent-green/40",
  },
  {
    icon: UserCheck,
    title: "Agents propose. Humans approve.",
    body: "Destructive actions require explicit human approval. The CLI blocks and polls. Your agent resumes when you respond Yes, No, or Other.",
    snippet: `vigil alerts acknowledge <id> \\\n  --note "confirmed lateral movement"`,
    iconColor: "text-accent-red",
    borderHover: "hover:border-accent-red/40",
  },
];

export function FeatureCards() {
  return (
    <section id="features" className="py-24 px-4 sm:px-6">
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
            Capabilities
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight">
            Everything you need. Nothing you don't.
          </h2>
        </motion.div>

        {/* Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className={`group relative p-6 rounded-xl bg-bg-card border border-border-subtle ${feat.borderHover} transition-all duration-300`}
            >
              {/* Icon */}
              <div className={`w-10 h-10 rounded-lg bg-bg-elevated flex items-center justify-center mb-4 ${feat.iconColor}`}>
                <feat.icon size={18} />
              </div>

              <h3 className="font-display font-semibold text-text-primary mb-2 text-base">
                {feat.title}
              </h3>
              <p className="text-sm text-text-muted leading-relaxed mb-4">
                {feat.body}
              </p>

              {/* Code snippet */}
              <div className="rounded-lg bg-bg-primary border border-border-subtle p-3 mt-auto">
                <pre className="text-xs font-mono text-text-muted leading-relaxed overflow-x-auto whitespace-pre-wrap">
                  {feat.snippet}
                </pre>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
