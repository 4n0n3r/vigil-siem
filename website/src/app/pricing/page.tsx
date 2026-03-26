import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Check, X } from "lucide-react";

const tiers = [
  {
    name: "Open Source",
    price: "Free",
    description: "Self-hosted. Forever free. Full source on GitHub.",
    cta: "Deploy with Docker",
    ctaHref: "https://github.com/your-org/vigil",
    ctaVariant: "secondary" as const,
    highlight: false,
    features: [
      { text: "Unlimited events (ClickHouse)", included: true },
      { text: "Sigma detection rules", included: true },
      { text: "Threat hunting (HQL)", included: true },
      { text: "Multi-endpoint support", included: true },
      { text: "Windows & Linux agents", included: true },
      { text: "Forensic collection", included: true },
      { text: "JSON output for AI agents", included: true },
      { text: "Managed hosting", included: false },
      { text: "SSO / SAML", included: false },
      { text: "SLA", included: false },
    ],
  },
  {
    name: "Cloud",
    price: "Coming soon",
    description: "Managed hosting. No ops. Scales automatically.",
    cta: "Join Waitlist",
    ctaHref: "/#waitlist",
    ctaVariant: "primary" as const,
    highlight: true,
    features: [
      { text: "Everything in Open Source", included: true },
      { text: "Managed ClickHouse + Postgres", included: true },
      { text: "Automatic updates", included: true },
      { text: "99.9% uptime SLA", included: true },
      { text: "Web dashboard", included: true },
      { text: "Email + Slack alerts", included: true },
      { text: "API key management", included: true },
      { text: "Managed hosting", included: true },
      { text: "SSO / SAML", included: false },
      { text: "Dedicated infra", included: false },
    ],
  },
  {
    name: "Enterprise",
    price: "Contact us",
    description: "Dedicated infrastructure, SSO, custom SLAs, and support.",
    cta: "Talk to us",
    ctaHref: "mailto:hello@vigilsec.io",
    ctaVariant: "secondary" as const,
    highlight: false,
    features: [
      { text: "Everything in Cloud", included: true },
      { text: "Dedicated infrastructure", included: true },
      { text: "SSO / SAML", included: true },
      { text: "Custom SLA", included: true },
      { text: "On-premise deployment", included: true },
      { text: "Custom detection development", included: true },
      { text: "Dedicated Slack channel", included: true },
      { text: "Annual invoicing", included: true },
      { text: "SOC 2 report", included: true },
      { text: "Custom integrations", included: true },
    ],
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <Navbar />

      <div className="pt-32 pb-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <p className="text-xs font-mono text-accent-cyan uppercase tracking-widest mb-3">
              Pricing
            </p>
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-text-primary tracking-tight mb-4">
              Start free. Scale when ready.
            </h1>
            <p className="text-text-muted max-w-xl mx-auto">
              Open source forever. Managed cloud when you want it.
              No surprises.
            </p>
          </div>

          {/* Tiers */}
          <div className="grid md:grid-cols-3 gap-6">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-xl p-6 border ${
                  tier.highlight
                    ? "bg-accent-cyan/5 border-accent-cyan/40 shadow-[0_0_30px_rgba(0,229,255,0.08)]"
                    : "bg-bg-card border-border-subtle"
                }`}
              >
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full bg-accent-cyan text-bg-primary text-xs font-display font-bold">
                      Recommended
                    </span>
                  </div>
                )}

                <h2 className="font-display font-bold text-xl text-text-primary mb-1">
                  {tier.name}
                </h2>
                <p className="text-2xl font-display font-bold text-text-primary mb-2">
                  {tier.price}
                </p>
                <p className="text-sm text-text-muted mb-6 leading-relaxed">
                  {tier.description}
                </p>

                <a
                  href={tier.ctaHref}
                  className={`block text-center w-full py-2.5 rounded-lg text-sm font-display font-semibold transition-all mb-6 ${
                    tier.ctaVariant === "primary"
                      ? "bg-accent-cyan text-bg-primary hover:bg-accent-cyan/90 shadow-[0_0_20px_rgba(0,229,255,0.2)]"
                      : "border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted"
                  }`}
                >
                  {tier.cta}
                </a>

                <ul className="space-y-2.5">
                  {tier.features.map((feat) => (
                    <li key={feat.text} className="flex items-start gap-2.5">
                      {feat.included ? (
                        <Check size={14} className="text-accent-green mt-0.5 flex-shrink-0" />
                      ) : (
                        <X size={14} className="text-text-muted mt-0.5 flex-shrink-0 opacity-40" />
                      )}
                      <span
                        className={`text-sm ${
                          feat.included ? "text-text-primary" : "text-text-muted opacity-40"
                        }`}
                      >
                        {feat.text}
                      </span>
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
