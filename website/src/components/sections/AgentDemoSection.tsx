"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Brain, Zap, CheckCircle, Clock } from "lucide-react";

// --- Types ---
type StageId = "prompt" | "reading" | "executing" | "results" | "hitl";

interface Stage {
  id: StageId;
  label: string;
  icon: React.ReactNode;
  duration: number; // how long this stage is "active" in ms
}

const STAGES: Stage[] = [
  {
    id: "prompt",
    label: "User prompt received",
    icon: <Terminal size={14} />,
    duration: 1200,
  },
  {
    id: "reading",
    label: "Reading context",
    icon: <Brain size={14} />,
    duration: 1800,
  },
  {
    id: "executing",
    label: "Executing commands",
    icon: <Zap size={14} />,
    duration: 3500,
  },
  {
    id: "results",
    label: "Synthesizing findings",
    icon: <CheckCircle size={14} />,
    duration: 2000,
  },
  {
    id: "hitl",
    label: "Awaiting approval",
    icon: <Clock size={14} />,
    duration: 99999, // stays until restart
  },
];

const COMMANDS = [
  { cmd: "vigil status", args: "--output json", delay: 0 },
  { cmd: "vigil alerts list", args: "--status open --output json", delay: 500 },
  { cmd: "vigil alerts list", args: "--status open --severity critical --output json", delay: 1000 },
  { cmd: "vigil hunt", args: '--query "event_id:4625" --agg event_data.IpAddress --output json', delay: 1600 },
];

const RESULTS_TEXT = [
  { text: "✓  API healthy · ClickHouse online · Postgres connected", color: "text-accent-green", delay: 0 },
  { text: "✓  1 open alert found: Brute Force Multiple Failures [HIGH]", color: "text-accent-amber", delay: 300 },
  { text: "✓  0 critical alerts", color: "text-accent-green", delay: 600 },
  { text: "✓  Source IP 192.168.1.45 → 847 failed logons (spray pattern)", color: "text-accent-red", delay: 900 },
  { text: "→  Assessment: password spray attack, single source IP, single target account 'admin'", color: "text-text-primary", delay: 1300 },
];

const HITL_TEXT = "Acknowledge alert a1b2c3d4 with note: \"Confirmed spray attack from 192.168.1.45. Recommend immediate firewall block.\" Awaiting human approval to proceed.";

// --- Main Component ---
export function AgentDemoSection() {
  const [activeStage, setActiveStage] = useState<StageId | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<StageId>>(new Set());
  const [visibleCommands, setVisibleCommands] = useState<number>(0);
  const [visibleResults, setVisibleResults] = useState<number>(0);
  const [showHitl, setShowHitl] = useState(false);
  const [hitlDecision, setHitlDecision] = useState<"approved" | "rejected" | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sectionRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  function clearAll() {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }

  function schedule(fn: () => void, delay: number) {
    const id = setTimeout(fn, delay);
    timeoutsRef.current.push(id);
  }

  function runSequence() {
    clearAll();
    setActiveStage(null);
    setCompletedStages(new Set());
    setVisibleCommands(0);
    setVisibleResults(0);
    setShowHitl(false);
    setHitlDecision(null);

    let t = 400;

    // Stage: prompt
    schedule(() => setActiveStage("prompt"), t);
    t += STAGES[0].duration;
    schedule(() => setCompletedStages(s => new Set(Array.from(s).concat("prompt"))), t);

    // Stage: reading
    schedule(() => setActiveStage("reading"), t);
    t += STAGES[1].duration;
    schedule(() => setCompletedStages(s => new Set(Array.from(s).concat("reading"))), t);

    // Stage: executing — commands appear one by one
    schedule(() => setActiveStage("executing"), t);
    const execStart = t;
    COMMANDS.forEach((_, i) => {
      schedule(() => setVisibleCommands(i + 1), execStart + _.delay + 300);
    });
    t += STAGES[2].duration;
    schedule(() => setCompletedStages(s => new Set(Array.from(s).concat("executing"))), t);

    // Stage: results
    schedule(() => setActiveStage("results"), t);
    const resultsStart = t;
    RESULTS_TEXT.forEach((r, i) => {
      schedule(() => setVisibleResults(i + 1), resultsStart + r.delay + 200);
    });
    t += STAGES[3].duration;
    schedule(() => setCompletedStages(s => new Set(Array.from(s).concat("results"))), t);

    // Stage: HITL
    schedule(() => {
      setActiveStage("hitl");
      setShowHitl(true);
    }, t);

    // Auto restart after a pause
    t += 5000;
    schedule(() => runSequence(), t);
  }

  // Start animation when section scrolls into view.
  // Empty deps — runs once on mount. Cleanup only fires on unmount,
  // so it never wipes the timeouts that runSequence just scheduled.
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !startedRef.current) {
          startedRef.current = true;
          obs.disconnect();
          runSequence();
        }
      },
      { threshold: 0.15 }
    );
    if (sectionRef.current) obs.observe(sectionRef.current);
    return () => { obs.disconnect(); clearAll(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      ref={sectionRef}
      className="py-24 px-4 sm:px-6 bg-bg-card border-y border-border-subtle overflow-hidden"
    >
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-3">
            See it live
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-text-primary tracking-tight mb-4">
            One prompt. Full investigation.
          </h2>
          <p className="text-text-muted max-w-xl mx-auto text-sm leading-relaxed">
            Drop{" "}
            <code className="font-mono text-accent-cyan bg-bg-elevated px-1.5 py-0.5 rounded text-xs">
              AGENT.md
            </code>{" "}
            into your agent's system prompt. It reads the skill playbooks, picks
            the right commands, and runs the investigation — without you writing
            a single line of glue code.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-5 gap-6 items-start">
          {/* Left: stages + user prompt */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* User message */}
            <div className="p-4 rounded-xl bg-bg-elevated border border-border-subtle">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-accent-cyan/20 flex items-center justify-center text-accent-cyan text-xs font-bold">
                  U
                </div>
                <span className="text-xs text-text-muted font-mono">User → Claude Code</span>
              </div>
              <p className="text-sm text-text-primary font-display leading-relaxed">
                "Review connectors and recent alerts. If there's anything suspicious, investigate and tell me what you find."
              </p>
            </div>

            {/* Stage pipeline */}
            <div className="flex flex-col gap-2">
              {STAGES.map((stage, i) => {
                const isActive = activeStage === stage.id;
                const isDone = completedStages.has(stage.id);
                return (
                  <div
                    key={stage.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-400 ${
                      isActive
                        ? "bg-accent-cyan/5 border-accent-cyan/40"
                        : isDone
                        ? "bg-accent-green/5 border-accent-green/20 opacity-60"
                        : "bg-bg-elevated border-border-subtle opacity-30"
                    }`}
                  >
                    <span
                      className={`transition-colors duration-300 ${
                        isActive
                          ? "text-accent-cyan"
                          : isDone
                          ? "text-accent-green"
                          : "text-text-muted"
                      }`}
                    >
                      {stage.icon}
                    </span>
                    <span
                      className={`text-xs font-mono transition-colors duration-300 ${
                        isActive
                          ? "text-accent-cyan"
                          : isDone
                          ? "text-text-muted"
                          : "text-text-muted"
                      }`}
                    >
                      {stage.label}
                    </span>
                    {isActive && (
                      <span className="ml-auto flex gap-1">
                        {[0, 1, 2].map((dot) => (
                          <span
                            key={dot}
                            className="w-1 h-1 rounded-full bg-accent-cyan animate-pulse"
                            style={{ animationDelay: `${dot * 200}ms` }}
                          />
                        ))}
                      </span>
                    )}
                    {isDone && (
                      <span className="ml-auto text-accent-green text-xs">✓</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: execution output panel */}
          <div className="lg:col-span-3">
            <div
              className="rounded-xl bg-bg-primary border border-border-subtle overflow-hidden"
              style={{
                boxShadow: "0 0 40px rgba(0,229,255,0.04), 0 20px 40px rgba(0,0,0,0.4)",
              }}
            >
              {/* Panel header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-bg-elevated border-b border-border-subtle">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-accent-red opacity-70" />
                  <div className="w-2.5 h-2.5 rounded-full bg-accent-amber opacity-70" />
                  <div className="w-2.5 h-2.5 rounded-full bg-accent-green opacity-70" />
                </div>
                <span className="flex-1 text-center text-xs text-text-muted font-mono">
                  claude code — vigil investigation
                </span>
              </div>

              <div className="p-4 min-h-[380px] font-mono text-xs leading-relaxed space-y-1 overflow-auto">
                {/* Reading context */}
                <AnimatePresence>
                  {(completedStages.has("reading") || activeStage === "reading") && (
                    <motion.div
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="space-y-1"
                    >
                      <div className="text-text-muted italic">
                        # Reading AGENT.md...
                      </div>
                      <div className="text-accent-green">
                        ✓ Skills loaded: triage · investigate_alert · hunt
                      </div>
                      <div className="text-text-muted italic mb-2">
                        # Selecting skill: triage (user asked for review + alerts)
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Commands */}
                {COMMANDS.slice(0, visibleCommands).map((c, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex flex-wrap items-baseline gap-1"
                  >
                    <span className="text-text-muted">$</span>
                    <span className="text-accent-cyan font-semibold">{c.cmd}</span>
                    <span className="text-accent-amber">{c.args}</span>
                  </motion.div>
                ))}

                {/* Results */}
                {visibleResults > 0 && (
                  <div className="pt-2 space-y-1">
                    {RESULTS_TEXT.slice(0, visibleResults).map((r, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`${r.color}`}
                      >
                        {r.text}
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* HITL panel */}
                <AnimatePresence>
                  {showHitl && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 p-3 rounded-lg border border-accent-amber/40 bg-accent-amber/5"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-pulse" />
                        <span className="text-accent-amber text-xs font-semibold uppercase tracking-wider">
                          Human approval required
                        </span>
                      </div>
                      <p className="text-text-muted text-xs leading-relaxed mb-3">
                        {HITL_TEXT}
                      </p>
                      {hitlDecision === null ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setHitlDecision("approved")}
                            className="px-3 py-1.5 rounded bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs hover:bg-accent-green/20 transition-colors"
                          >
                            ✓ Approve
                          </button>
                          <button
                            onClick={() => setHitlDecision("rejected")}
                            className="px-3 py-1.5 rounded bg-accent-red/10 border border-accent-red/30 text-accent-red text-xs hover:bg-accent-red/20 transition-colors"
                          >
                            ✗ Reject
                          </button>
                        </div>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`text-xs font-semibold ${
                            hitlDecision === "approved"
                              ? "text-accent-green"
                              : "text-accent-red"
                          }`}
                        >
                          {hitlDecision === "approved"
                            ? "✓ Approved — agent proceeding with acknowledgement"
                            : "✗ Rejected — agent stopped. Awaiting further instruction."}
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Blinking cursor */}
                {activeStage !== null && (
                  <span className="inline-block w-2 h-3.5 bg-accent-cyan animate-cursor-blink ml-0.5 align-middle" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
