import Link from "next/link";
import { Logo } from "./Logo";

const footerLinks = {
  Product: [
    { label: "Features", href: "/#features" },
    { label: "Pricing", href: "/pricing" },
    { label: "Changelog", href: "/changelog" },
    { label: "Roadmap", href: "#roadmap" },
  ],
  Docs: [
    { label: "Installation", href: "https://github.com/vigilsec/vigil/blob/main/docs/installation.md" },
    { label: "Configuration", href: "https://github.com/vigilsec/vigil/blob/main/docs/configuration.md" },
    { label: "API Reference", href: "https://github.com/vigilsec/vigil/blob/main/docs/api-reference.md" },
    { label: "Detection Rules", href: "https://github.com/vigilsec/vigil/blob/main/docs/detections.md" },
  ],
  "Open Source": [
    { label: "GitHub", href: "https://github.com/vigilsec/vigil" },
    { label: "Contributing", href: "https://github.com/vigilsec/vigil/blob/main/CONTRIBUTING.md" },
    { label: "License (Apache 2.0)", href: "https://github.com/vigilsec/vigil/blob/main/LICENSE" },
    { label: "Issues", href: "https://github.com/vigilsec/vigil/issues" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "#" },
    { label: "Terms of Service", href: "#" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-border-subtle bg-bg-card">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Logo size="sm" />
            <p className="mt-3 text-xs text-text-muted leading-relaxed">
              CLI-first SIEM built for AI agents and the humans who trust them.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-accent-green animate-pulse" />
              <span className="text-xs text-text-muted">Apache 2.0</span>
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([section, links]) => (
            <div key={section}>
              <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-3 font-display">
                {section}
              </h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-text-muted hover:text-text-primary transition-colors duration-150"
                      {...(link.href.startsWith("http")
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-border-subtle flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-text-muted">
            © 2026 Vigil. Built for agents. Watched by humans.
          </p>
          <p className="text-xs text-text-muted">
            Self-hosted · Open source · No phone-home
          </p>
        </div>
      </div>
    </footer>
  );
}
