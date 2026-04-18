"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { ArrowRight, CheckCircle } from "lucide-react";

export function FinalCTA() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !name) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError("Something went wrong. Try again.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      id="waitlist"
      className="py-24 px-4 sm:px-6 relative overflow-hidden"
    >
      {/* Glow */}
      <div className="absolute inset-0 bg-radial-glow pointer-events-none" />

      <div className="relative max-w-2xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-4">
            Get started
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary mb-4 tracking-tight leading-tight">
            Start watching.
            <br />
            <span className="text-text-muted">Nothing to trust us with.</span>
          </h2>
          <p className="text-text-muted mb-10 leading-relaxed">
            Self-hosted, open source, no phone-home. Deploy in 5 minutes with
            Docker. Or get on the waitlist for Vigil Cloud — managed hosting,
            zero ops.
          </p>

          {/* Docker CTA */}
          <div className="flex flex-wrap justify-center gap-3 mb-12">
            <a
              href="https://github.com/vigilsec/vigil"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bg-elevated border border-border-subtle text-sm text-text-primary hover:border-text-muted transition-all font-display font-medium"
            >
              Deploy with Docker →
            </a>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-8">
            <div className="flex-1 h-px bg-border-subtle" />
            <span className="text-xs text-text-muted font-mono">or join the cloud waitlist</span>
            <div className="flex-1 h-px bg-border-subtle" />
          </div>

          {/* Waitlist form */}
          {submitted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 p-6 rounded-xl bg-bg-card border border-accent-green/30"
            >
              <CheckCircle className="text-accent-green" size={28} />
              <p className="font-display font-semibold text-text-primary">
                You're on the list.
              </p>
              <p className="text-sm text-text-muted">
                We'll reach out when Vigil Cloud launches.
              </p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="px-4 py-2.5 rounded-lg bg-bg-card border border-border-subtle text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent-cyan/50 transition-colors font-mono"
                />
                <input
                  type="email"
                  placeholder="Work email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="px-4 py-2.5 rounded-lg bg-bg-card border border-border-subtle text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent-cyan/50 transition-colors font-mono"
                />
              </div>
              {error && (
                <p className="text-xs text-accent-red font-mono">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-accent-cyan text-bg-primary font-display font-semibold text-sm hover:bg-accent-cyan/90 transition-all shadow-[0_0_20px_rgba(0,229,255,0.2)] hover:shadow-[0_0_30px_rgba(0,229,255,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Sending..." : "Join the Waitlist"}
                {!loading && <ArrowRight size={15} />}
              </button>
              <p className="text-xs text-text-muted">
                No spam. We'll only email when Vigil Cloud launches.
              </p>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  );
}
