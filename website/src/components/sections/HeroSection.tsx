"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Terminal } from "lucide-react";
import { TerminalAnimator } from "@/components/terminal/TerminalAnimator";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" },
  }),
};

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-grid opacity-100 pointer-events-none" />
      <div className="absolute inset-0 bg-radial-glow pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-bg-primary to-transparent pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 w-full">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          {/* Left — copy */}
          <div>
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
              The SIEM your{" "}
              <span
                className="text-accent-cyan"
                style={{ textShadow: "0 0 30px rgba(0,229,255,0.3)" }}
              >
                AI agents
              </span>{" "}
              can actually use.
            </motion.h1>

            {/* Sub */}
            <motion.p
              custom={2}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="text-lg text-text-muted leading-relaxed mb-8 max-w-xl"
            >
              Vigil ingests endpoint events, evaluates Sigma detections in real
              time, and returns structured JSON. Claude, Codex, and your own
              agents query it directly. No dashboards required.
            </motion.p>

            {/* CTAs */}
            <motion.div
              custom={3}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="flex flex-wrap gap-3 mb-6"
            >
              <a
                href="#waitlist"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-cyan text-bg-primary font-display font-semibold text-sm hover:bg-accent-cyan/90 transition-all duration-200 shadow-[0_0_20px_rgba(0,229,255,0.25)] hover:shadow-[0_0_30px_rgba(0,229,255,0.4)]"
              >
                Get Early Access
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

            {/* Trust line */}
            <motion.p
              custom={4}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="text-xs text-text-muted font-mono"
            >
              Apache 2.0 · Self-hosted in 5 minutes · No cloud account required
            </motion.p>
          </div>

          {/* Right — terminal */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
            className="relative"
          >
            <TerminalAnimator />

            {/* Floating badges */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.4, duration: 0.4 }}
              className="absolute -top-4 -right-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated border border-accent-amber/30 shadow-lg"
            >
              <span className="w-2 h-2 rounded-full bg-accent-amber animate-pulse-glow-red" />
              <span className="text-xs font-mono text-accent-amber font-medium">
                1 ALERT · HIGH
              </span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.7, duration: 0.4 }}
              className="absolute -bottom-4 -left-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated border border-accent-green/30 shadow-lg"
            >
              <span className="w-2 h-2 rounded-full bg-accent-green" />
              <span className="text-xs font-mono text-accent-green font-medium">
                AGENT ACTIVE · PROD-BOX-01
              </span>
            </motion.div>
          </motion.div>
        </div>

        {/* Install command */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="mt-16 flex justify-center"
        >
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-bg-card border border-border-subtle text-sm font-mono">
            <Terminal size={14} className="text-accent-cyan flex-shrink-0" />
            <code className="text-text-muted">
              docker-compose -f api/docker-compose.yml up -d
            </code>
            <button
              onClick={() =>
                navigator.clipboard.writeText(
                  "docker-compose -f api/docker-compose.yml up -d"
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
    </section>
  );
}
