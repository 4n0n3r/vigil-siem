"use client";

import { motion } from "framer-motion";

const agentSession = `# Claude Code running "triage" skill

$ vigil status --output json
{ "api_status": "ok", "clickhouse_status": "ok" }

$ vigil alerts list --status open --severity critical --output json
{ "alerts": [], "total": 0 }

$ vigil alerts list --status open --severity high --output json
{
  "alerts": [
    {
      "id": "a1b2c3d4",
      "rule_name": "Brute Force Multiple Failures",
      "severity": "high",
      "event_snapshot": {
        "event_data": {
          "IpAddress": "192.168.1.45",
          "TargetUserName": "admin"
        }
      }
    }
  ],
  "total": 1
}

# Pivoting on source IP...
$ vigil hunt --query "192.168.1.45" --timeline --output json
{ "total": 847, "timeline": [...] }

# 847 failed logons from one IP → spray attack confirmed`;

export function AgentPositioning() {
  return (
    <section className="py-24 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left — prose */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-3">
              AI-native
            </p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight mb-6 leading-tight">
              Your AI agent already knows how to use it.
            </h2>
            <p className="text-text-muted leading-relaxed mb-4">
              Every Vigil command returns structured JSON when you pass{" "}
              <code className="font-mono text-accent-cyan text-sm bg-bg-elevated px-1.5 py-0.5 rounded">
                --output json
              </code>
              . No screen-scraping. No fragile grep pipelines. Just clean objects
              your agent can reason about.
            </p>
            <p className="text-text-muted leading-relaxed mb-8">
              Vigil ships named playbooks — called{" "}
              <span className="text-text-primary font-medium">skills</span> — for
              common workflows: triage, investigate, hunt, forensic sweep. Drop them
              in your agent's system prompt. Claude Code can run a full incident
              investigation with no human intervention until it's ready to act.
            </p>

            {/* Callouts */}
            <div className="space-y-3">
              {[
                { label: "100% JSON output", desc: "Every command, every response" },
                { label: "Named skills", desc: "triage · investigate · hunt · forensic_sweep" },
                { label: "HITL gates", desc: "Agents propose, humans approve destructive actions" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-start gap-3 p-3 rounded-lg bg-bg-card border border-border-subtle"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-1.5 flex-shrink-0" />
                  <div>
                    <span className="text-sm font-semibold text-text-primary font-display">
                      {item.label}
                    </span>
                    <span className="text-sm text-text-muted ml-2">{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right — code block */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <div className="rounded-xl bg-bg-card border border-border-subtle overflow-hidden shadow-2xl">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-3 bg-bg-elevated border-b border-border-subtle">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-accent-red opacity-70" />
                  <div className="w-3 h-3 rounded-full bg-accent-amber opacity-70" />
                  <div className="w-3 h-3 rounded-full bg-accent-green opacity-70" />
                </div>
                <span className="flex-1 text-center text-xs text-text-muted font-mono">
                  claude code — triage skill
                </span>
              </div>

              <div className="p-4 overflow-auto max-h-[480px]">
                <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-text-muted">
                  {agentSession.split("\n").map((line, i) => {
                    if (line.startsWith("#")) {
                      return (
                        <span key={i} className="text-text-muted italic">
                          {line}
                          {"\n"}
                        </span>
                      );
                    }
                    if (line.startsWith("$")) {
                      const parts = line.split(" ");
                      return (
                        <span key={i}>
                          <span className="text-text-muted">$ </span>
                          <span className="text-accent-cyan font-semibold">{parts[1]}</span>
                          <span className="text-text-primary"> {parts.slice(2).join(" ")}</span>
                          {"\n"}
                        </span>
                      );
                    }
                    if (line.includes('"severity": "high"')) {
                      return (
                        <span key={i} className="text-accent-amber">
                          {line}
                          {"\n"}
                        </span>
                      );
                    }
                    if (line.includes('"ok"') || line.includes('"pass"')) {
                      return (
                        <span key={i} className="text-accent-green">
                          {line}
                          {"\n"}
                        </span>
                      );
                    }
                    return (
                      <span key={i} className="text-text-primary">
                        {line}
                        {"\n"}
                      </span>
                    );
                  })}
                </pre>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
