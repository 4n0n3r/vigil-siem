import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

const entries = [
  {
    date: "2026-03-23",
    version: "Phase 5",
    title: "Production-ready foundations",
    highlights: [
      "vigil config get/set — persistent config file",
      "vigil doctor — 5-check connectivity diagnostic",
      "Multi-endpoint backend with per-key auth",
      "vigil agent register — saves API key to config",
      "Apache 2.0 license, README, CONTRIBUTING docs",
      "Error hints on all error responses",
      "Skills files for AI agent playbooks",
    ],
  },
  {
    date: "2026-02-10",
    version: "Phase 3",
    title: "Forensic collection and Linux agent",
    highlights: [
      "vigil forensic collect — point-in-time artifact sweep",
      "Linux agent: journald + syslog collectors",
      "--profile minimal|standard|full for vigil agent start",
      "10 Sigma detection rules across 6 MITRE tactics",
      "vigil alerts visualize — self-contained HTML dashboard",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <Navbar />
      <div className="pt-32 pb-24 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-3">
              Changelog
            </p>
            <h1 className="text-4xl font-display font-bold text-text-primary">
              What's new in Vigil
            </h1>
          </div>

          <div className="space-y-12">
            {entries.map((entry) => (
              <div
                key={entry.date}
                className="relative pl-6 border-l border-border-subtle"
              >
                <div className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-accent-cyan border-2 border-bg-primary" />
                <div className="mb-2">
                  <span className="text-xs font-mono text-text-muted">{entry.date}</span>
                  <span className="mx-2 text-text-muted">·</span>
                  <span className="text-xs font-mono text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded">
                    {entry.version}
                  </span>
                </div>
                <h2 className="font-display font-semibold text-xl text-text-primary mb-3">
                  {entry.title}
                </h2>
                <ul className="space-y-2">
                  {entry.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-text-muted">
                      <span className="w-1 h-1 rounded-full bg-accent-cyan mt-2 flex-shrink-0" />
                      <code className="font-mono text-text-primary text-xs">{item}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
