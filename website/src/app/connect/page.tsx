"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Terminal } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" },
  }),
};

const howItWorksSteps = [
  {
    number: "01",
    title: "Connect",
    body: "Point Vigil at your existing Wazuh or Elastic deployment.",
    code: "vigil connector add wazuh",
  },
  {
    number: "02",
    title: "Investigate",
    body: "AI agents read structured JSON alerts directly.",
    code: "vigil feed alerts --severity high --output json",
  },
  {
    number: "03",
    title: "Act",
    body: "Acknowledge false positives, escalate real threats, get full log context.",
    code: "vigil feed context <alert-id> --window 10m --output json",
  },
];

const siems = [
  {
    name: "Wazuh",
    description:
      "Full support. Alerts via OpenSearch, context via archives.",
    status: "available",
    statusLabel: "Available now",
  },
  {
    name: "Elastic",
    description:
      "Full support. Security alerts via .alerts-security index, ancestor-based context.",
    status: "available",
    statusLabel: "Available now",
  },
  {
    name: "Splunk",
    description: "Integration in progress.",
    status: "soon",
    statusLabel: "Coming soon",
  },
  {
    name: "Microsoft Sentinel",
    description: "Integration in progress.",
    status: "soon",
    statusLabel: "Coming soon",
  },
];

const investigationFlow = `# Step 1: Get recent high-severity alerts
vigil feed alerts --severity high --since 1h --output json

# Step 2: Investigate a specific alert (get surrounding raw logs)
vigil feed context <alert-id> --window 10m --output json

# Step 3: Acknowledge or escalate
vigil alerts acknowledge <id> --note "False positive — dev build server"`;

export default function ConnectPage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-4 sm:px-6 overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-100 pointer-events-none" />
        <div className="absolute inset-0 bg-radial-glow pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-bg-primary to-transparent pointer-events-none" />

        <div className="relative max-w-7xl mx-auto">
          <div className="max-w-3xl">
            {/* Pill */}
            <motion.div
              custom={0}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent-amber/30 bg-accent-amber/5 mb-6"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-pulse" />
              <span className="text-xs font-mono text-accent-amber tracking-wider uppercase">
                AI Investigation Layer
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-text-primary leading-[1.1] tracking-tight mb-6"
            >
              Give your AI agents{" "}
              <span
                className="text-accent-amber"
                style={{ textShadow: "0 0 30px rgba(255,181,71,0.3)" }}
              >
                structured access
              </span>{" "}
              to your SIEM.
            </motion.h1>

            {/* Sub */}
            <motion.p
              custom={2}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="text-lg text-text-muted leading-relaxed mb-8 max-w-2xl"
            >
              Vigil Connect sits on top of Wazuh, Elastic, or Splunk. Your AI
              agents get clean JSON alerts and a structured API. No new agents
              on endpoints.
            </motion.p>

            {/* CTAs */}
            <motion.div
              custom={3}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="flex flex-wrap gap-3 mb-10"
            >
              <a
                href="#setup"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-amber text-bg-primary font-display font-semibold text-sm hover:bg-accent-amber/90 transition-all duration-200 shadow-[0_0_20px_rgba(255,181,71,0.25)] hover:shadow-[0_0_30px_rgba(255,181,71,0.4)]"
              >
                Connect your SIEM
                <ArrowRight size={15} />
              </a>
              <Link
                href="https://github.com/your-org/vigil"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-all duration-200 text-sm font-display font-medium"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                View on GitHub
              </Link>
            </motion.div>

            {/* Install command */}
            <motion.div
              custom={4}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              id="setup"
            >
              <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg bg-bg-card border border-border-subtle text-sm font-mono max-w-full overflow-x-auto">
                <Terminal size={14} className="text-accent-amber flex-shrink-0" />
                <code className="text-text-muted whitespace-nowrap">
                  vigil connector add wazuh --name prod --indexer-url https://wazuh:9200 --indexer-user admin --indexer-pass &lt;pass&gt;
                </code>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(
                      "vigil connector add wazuh --name prod --indexer-url https://wazuh:9200 --indexer-user admin --indexer-pass <pass>"
                    )
                  }
                  className="text-text-muted hover:text-accent-amber transition-colors text-xs ml-2 flex-shrink-0"
                  title="Copy"
                >
                  copy
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-4 sm:px-6 bg-bg-card border-y border-border-subtle">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <p className="text-xs font-mono text-accent-amber uppercase tracking-widest mb-3">
              How it works
            </p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight">
              Three steps to AI-powered investigation.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 relative">
            {howItWorksSteps.map((step, i) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15, duration: 0.5 }}
                className="relative p-6 rounded-xl bg-bg-elevated border border-border-subtle"
              >
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-bg-card border border-border-subtle mb-4">
                  <span className="text-xs font-mono font-bold text-accent-amber">
                    {step.number}
                  </span>
                </div>
                <h3 className="font-display font-semibold text-text-primary mb-2 text-base">
                  {step.title}
                </h3>
                <p className="text-sm text-text-muted leading-relaxed mb-4">
                  {step.body}
                </p>
                <div className="rounded-lg bg-bg-primary border border-border-subtle p-3">
                  <pre className="text-xs font-mono text-text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto">
                    {step.code}
                  </pre>
                </div>
                {i < howItWorksSteps.length - 1 && (
                  <div className="hidden md:flex absolute -right-3 top-8 z-10 w-6 h-6 items-center justify-center rounded-full bg-bg-elevated border border-border-subtle">
                    <ArrowRight size={12} className="text-text-muted" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported SIEMs */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <p className="text-xs font-mono text-accent-amber uppercase tracking-widest mb-3">
              Supported SIEMs
            </p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight">
              Works with your existing stack.
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {siems.map((siem, i) => (
              <motion.div
                key={siem.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="p-6 rounded-xl bg-bg-card border border-border-subtle"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-display font-semibold text-text-primary text-base">
                    {siem.name}
                  </h3>
                  <span
                    className={`text-xs font-mono px-2 py-0.5 rounded-full border ${
                      siem.status === "available"
                        ? "text-accent-green border-accent-green/30 bg-accent-green/5"
                        : "text-text-muted border-border-subtle bg-bg-elevated"
                    }`}
                  >
                    {siem.statusLabel}
                  </span>
                </div>
                <p className="text-sm text-text-muted leading-relaxed">
                  {siem.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Why no normalization */}
      <section className="py-24 px-4 sm:px-6 bg-bg-card border-y border-border-subtle">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-xs font-mono text-accent-amber uppercase tracking-widest mb-3">
              Design decision
            </p>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-text-primary tracking-tight mb-6">
              AI reads raw JSON better than normalized schemas.
            </h2>
            <div className="space-y-4 text-sm text-text-muted leading-relaxed">
              <p>
                Every SIEM uses different field names. Building a normalization
                layer takes months and breaks with every SIEM version upgrade.
                A normalized schema is a bet that you can predict every field
                an AI agent will ever need — and that bet always loses.
              </p>
              <p>
                Instead, Vigil passes raw alert JSON to the AI. Claude reads
                Wazuh's{" "}
                <code className="font-mono text-xs bg-bg-elevated border border-border-subtle px-1.5 py-0.5 rounded text-text-primary">
                  rule.description
                </code>{" "}
                and Elastic's{" "}
                <code className="font-mono text-xs bg-bg-elevated border border-border-subtle px-1.5 py-0.5 rounded text-text-primary">
                  kibana.alert.rule.name
                </code>{" "}
                equally well. The model understands structure without being told
                what the structure means.
              </p>
              <p>
                The only fields Vigil extracts:{" "}
                <code className="font-mono text-xs bg-bg-elevated border border-border-subtle px-1.5 py-0.5 rounded text-text-primary">
                  id
                </code>
                ,{" "}
                <code className="font-mono text-xs bg-bg-elevated border border-border-subtle px-1.5 py-0.5 rounded text-text-primary">
                  severity
                </code>
                ,{" "}
                <code className="font-mono text-xs bg-bg-elevated border border-border-subtle px-1.5 py-0.5 rounded text-text-primary">
                  source_siem
                </code>
                , and{" "}
                <code className="font-mono text-xs bg-bg-elevated border border-border-subtle px-1.5 py-0.5 rounded text-text-primary">
                  raw
                </code>{" "}
                — the entire original alert, untouched.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Investigation flow */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-10"
          >
            <p className="text-xs font-mono text-accent-amber uppercase tracking-widest mb-3">
              Investigation flow
            </p>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-text-primary tracking-tight">
              The full workflow in three commands.
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-xl bg-bg-card border border-border-subtle overflow-hidden"
          >
            {/* Terminal chrome */}
            <div className="flex items-center gap-1.5 px-4 py-3 bg-bg-elevated border-b border-border-subtle">
              <span className="w-3 h-3 rounded-full bg-accent-red/60" />
              <span className="w-3 h-3 rounded-full bg-accent-amber/60" />
              <span className="w-3 h-3 rounded-full bg-accent-green/60" />
              <span className="ml-3 text-xs font-mono text-text-muted">
                terminal
              </span>
            </div>
            <div className="p-6">
              <pre className="text-sm font-mono text-text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto">
                {investigationFlow}
              </pre>
            </div>
          </motion.div>
        </div>
      </section>

      {/* npx skill installer */}
      <section className="py-24 px-4 sm:px-6 bg-bg-card border-t border-border-subtle">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <p className="text-xs font-mono text-accent-amber uppercase tracking-widest mb-3">
              Claude Code integration
            </p>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-text-primary tracking-tight mb-4">
              Deploy with Claude Code in one command.
            </h2>
            <p className="text-text-muted mb-10 max-w-xl mx-auto">
              After running, Claude Code knows how to deploy agents, add
              connectors, and investigate alerts. No MCP server. No running
              process. Just instructions.
            </p>

            <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg bg-bg-elevated border border-border-subtle text-sm font-mono mb-10">
              <Terminal size={14} className="text-accent-amber flex-shrink-0" />
              <code className="text-text-muted">npx @vigil/skill</code>
              <button
                onClick={() =>
                  navigator.clipboard.writeText("npx @vigil/skill")
                }
                className="text-text-muted hover:text-accent-amber transition-colors text-xs ml-2"
                title="Copy"
              >
                copy
              </button>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="#setup"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-amber text-bg-primary font-display font-semibold text-sm hover:bg-accent-amber/90 transition-all duration-200"
              >
                Connect your SIEM
                <ArrowRight size={15} />
              </a>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-all duration-200 text-sm font-display font-medium"
              >
                Read the docs
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
