"use client";

import { motion } from "framer-motion";

const sigmaRule = `title: Multiple Failed Logon Attempts (Brute Force)
id: 3c4d5e6f-7890-abcd-ef01-234567890abc
status: stable
description: >
  Detects failed Windows logon attempts (Event ID 4625).
logsource:
  product: windows
  service: security
detection:
  selection:
    event_id: 4625
    event_data.LogonType:
      - "2"
      - "3"
      - "7"
      - "10"
  condition: selection
level: medium
tags:
  - attack.credential_access
  - attack.t1110.001`;

const alertJson = `{
  "id": "a1b2c3d4",
  "rule_name": "Brute Force Multiple Failures",
  "severity": "medium",
  "status": "open",
  "matched_at": "2026-03-23T14:22:01Z",
  "source_event_id": "winlog:Security:8821",
  "event_snapshot": {
    "event_id": 4625,
    "channel": "Security",
    "computer": "PROD-BOX-01",
    "event_data": {
      "TargetUserName": "admin",
      "IpAddress": "192.168.1.45",
      "LogonType": "3"
    }
  }
}`;

export function SigmaShowcase() {
  return (
    <section className="py-24 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-3">
            Sigma-compatible
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight mb-4">
            Rules in. Alerts out.
          </h2>
          <p className="text-text-muted max-w-xl mx-auto text-sm">
            Write a Sigma rule in YAML. Deploy it with one command. Every matching
            event becomes a structured alert instantly.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Rule */}
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="rounded-xl bg-bg-card border border-border-subtle overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-bg-elevated border-b border-border-subtle">
              <span className="text-xs font-mono text-text-muted">
                detections/credential_access/brute_force.yml
              </span>
              <span className="text-xs px-2 py-0.5 rounded border border-accent-amber/30 text-accent-amber font-mono">
                YAML
              </span>
            </div>
            <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto text-text-muted whitespace-pre">
              {sigmaRule.split("\n").map((line, i) => {
                if (line.startsWith("title:") || line.startsWith("detection:") || line.startsWith("logsource:")) {
                  return <span key={i} className="text-accent-cyan">{line}{"\n"}</span>;
                }
                if (line.includes("event_id:") || line.includes("event_data.LogonType:")) {
                  return <span key={i} className="text-accent-amber">{line}{"\n"}</span>;
                }
                if (line.startsWith("  - attack.")) {
                  return <span key={i} className="text-accent-green">{line}{"\n"}</span>;
                }
                return <span key={i}>{line}{"\n"}</span>;
              })}
            </pre>

            {/* Deploy command */}
            <div className="px-4 py-3 border-t border-border-subtle bg-bg-elevated">
              <code className="text-xs font-mono text-text-muted">
                <span className="text-text-muted">$ </span>
                <span className="text-accent-cyan font-semibold">vigil</span>
                <span className="text-text-primary"> detections create </span>
                <span className="text-accent-amber">--file</span>
                <span className="text-text-primary"> brute_force.yml</span>
              </code>
            </div>
          </motion.div>

          {/* Alert output */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-xl bg-bg-card border border-border-subtle overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-bg-elevated border-b border-border-subtle">
              <span className="text-xs font-mono text-text-muted">
                vigil alerts get a1b2c3d4 --output json
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />
                <span className="text-xs font-mono text-accent-amber">ALERT FIRED</span>
              </span>
            </div>
            <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre">
              {alertJson.split("\n").map((line, i) => {
                const isKey = line.match(/^\s+"[^"]+": /);
                if (isKey) {
                  const colonIdx = line.indexOf('": ');
                  const key = line.substring(0, colonIdx + 2);
                  const val = line.substring(colonIdx + 2);
                  const valClass = val.includes('"medium"') ? "text-yellow-400" :
                    val.includes('"open"') ? "text-accent-amber" :
                    val.startsWith(' "') ? "text-accent-green" :
                    val.match(/\d+/) && !val.includes('"') ? "text-accent-amber" :
                    "text-text-primary";
                  return (
                    <span key={i}>
                      <span className="text-accent-cyan">{key}</span>
                      <span className={valClass}>{val}</span>
                      {"\n"}
                    </span>
                  );
                }
                return <span key={i} className="text-text-muted">{line}{"\n"}</span>;
              })}
            </pre>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
