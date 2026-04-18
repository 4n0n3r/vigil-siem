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

const features = [
  {
    title: "Single binary, five platforms",
    body: "Windows, Linux, macOS. No dependencies. No installer.",
  },
  {
    title: "Structured JSON output",
    body: "Every command accepts --output json. AI agents query it directly.",
  },
  {
    title: "Sigma rules, no XML",
    body: "Deploy detection rules from a YAML file in one command.",
  },
  {
    title: "Web dashboard included",
    body: "Run vigil web start. No separate frontend to deploy.",
  },
  {
    title: "Forensic collection",
    body: "Point-in-time artifact sweep with vigil forensic collect.",
  },
  {
    title: "Enrollment tokens",
    body: "Secure agent onboarding via short-lived registration tokens.",
  },
];

const steps = [
  {
    number: "01",
    title: "Deploy the API",
    code: "docker-compose -f api/docker-compose.yml up -d",
  },
  {
    number: "02",
    title: "Install the agent",
    code: "curl -sSL https://vigil.sh/install | bash",
  },
  {
    number: "03",
    title: "Register",
    code: "vigil agent register --name prod-box-01",
  },
  {
    number: "04",
    title: "Monitor",
    code: "vigil alerts list --severity high --output json",
  },
];

const comparisonRows = [
  { label: "Pricing", vigil: "Free (self-hosted)", traditional: "$150+/GB" },
  { label: "Install time", vigil: "5 minutes", traditional: "Weeks" },
  { label: "Config format", vigil: "YAML (Sigma)", traditional: "XML / proprietary" },
  { label: "AI-native", vigil: "Yes (--output json)", traditional: "No" },
  { label: "On-prem", vigil: "Yes", traditional: "Limited" },
];

export default function SiemPage() {
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
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent-cyan/30 bg-accent-cyan/5 mb-6"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
              <span className="text-xs font-mono text-accent-cyan tracking-wider uppercase">
                Open Source SIEM
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
              The SIEM your team{" "}
              <span
                className="text-accent-cyan"
                style={{ textShadow: "0 0 30px rgba(0,229,255,0.3)" }}
              >
                actually deploys.
              </span>
            </motion.h1>

            {/* Sub */}
            <motion.p
              custom={2}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="text-lg text-text-muted leading-relaxed mb-8 max-w-2xl"
            >
              No $150/GB pricing. No XML config files. No dedicated ops team.
              One binary. One command. Running in minutes.
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
                href="#install"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-cyan text-bg-primary font-display font-semibold text-sm hover:bg-accent-cyan/90 transition-all duration-200 shadow-[0_0_20px_rgba(0,229,255,0.25)] hover:shadow-[0_0_30px_rgba(0,229,255,0.4)]"
              >
                Deploy Now
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
              id="install"
            >
              <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg bg-bg-card border border-border-subtle text-sm font-mono">
                <Terminal size={14} className="text-accent-cyan flex-shrink-0" />
                <code className="text-text-muted">
                  curl -sSL https://vigil.sh/install | bash
                </code>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(
                      "curl -sSL https://vigil.sh/install | bash"
                    )
                  }
                  className="text-text-muted hover:text-accent-cyan transition-colors text-xs ml-2"
                  title="Copy"
                >
                  copy
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
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
              Built for real deployments.
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="p-6 rounded-xl bg-bg-card border border-border-subtle hover:border-accent-cyan/30 transition-all duration-300"
              >
                <div className="w-2 h-2 rounded-full bg-accent-cyan mb-4" />
                <h3 className="font-display font-semibold text-text-primary mb-2 text-base">
                  {feat.title}
                </h3>
                <p className="text-sm text-text-muted leading-relaxed">
                  {feat.body}
                </p>
              </motion.div>
            ))}
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
            <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-3">
              How it works
            </p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight">
              From zero to collecting in four commands.
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="relative p-6 rounded-xl bg-bg-elevated border border-border-subtle"
              >
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-bg-card border border-border-subtle mb-4">
                  <span className="text-xs font-mono font-bold text-accent-cyan">
                    {step.number}
                  </span>
                </div>
                <h3 className="font-display font-semibold text-text-primary mb-3 text-base">
                  {step.title}
                </h3>
                <div className="rounded-lg bg-bg-primary border border-border-subtle p-3">
                  <pre className="text-xs font-mono text-text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto">
                    {step.code}
                  </pre>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-3">
              Comparison
            </p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight">
              Not another enterprise SIEM.
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="rounded-xl bg-bg-card border border-border-subtle overflow-hidden"
          >
            {/* Table header */}
            <div className="grid grid-cols-3 border-b border-border-subtle">
              <div className="px-6 py-4" />
              <div className="px-6 py-4 border-l border-border-subtle">
                <span className="text-sm font-display font-semibold text-accent-cyan">
                  Vigil
                </span>
              </div>
              <div className="px-6 py-4 border-l border-border-subtle">
                <span className="text-sm font-display font-semibold text-text-muted">
                  Traditional SIEM
                </span>
              </div>
            </div>

            {/* Rows */}
            {comparisonRows.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-3 ${
                  i < comparisonRows.length - 1 ? "border-b border-border-subtle" : ""
                }`}
              >
                <div className="px-6 py-4">
                  <span className="text-sm text-text-muted font-medium">
                    {row.label}
                  </span>
                </div>
                <div className="px-6 py-4 border-l border-border-subtle">
                  <span className="text-sm font-mono text-accent-green">
                    {row.vigil}
                  </span>
                </div>
                <div className="px-6 py-4 border-l border-border-subtle">
                  <span className="text-sm font-mono text-text-muted">
                    {row.traditional}
                  </span>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA footer */}
      <section className="py-24 px-4 sm:px-6 bg-bg-card border-t border-border-subtle">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight mb-4">
              Ready to deploy?
            </h2>
            <p className="text-text-muted mb-10">
              Self-hosted. Apache 2.0. No account required.
            </p>
            <div className="flex justify-center mb-8">
              <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg bg-bg-elevated border border-border-subtle text-sm font-mono">
                <Terminal size={14} className="text-accent-cyan flex-shrink-0" />
                <code className="text-text-muted">
                  curl -sSL https://vigil.sh/install | bash
                </code>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(
                      "curl -sSL https://vigil.sh/install | bash"
                    )
                  }
                  className="text-text-muted hover:text-accent-cyan transition-colors text-xs ml-2"
                  title="Copy"
                >
                  copy
                </button>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="https://github.com/your-org/vigil"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-cyan text-bg-primary font-display font-semibold text-sm hover:bg-accent-cyan/90 transition-all duration-200"
              >
                View on GitHub
                <ArrowRight size={15} />
              </Link>
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
