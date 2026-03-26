import React from "react";

interface TerminalWindowProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function TerminalWindow({
  title = "vigil — bash — 80×24",
  children,
  className = "",
}: TerminalWindowProps) {
  return (
    <div
      className={`rounded-xl overflow-hidden border border-border-subtle bg-bg-card shadow-2xl ${className}`}
      style={{
        boxShadow:
          "0 0 0 1px rgba(30,38,51,0.8), 0 25px 50px rgba(0,0,0,0.5), 0 0 60px rgba(0,229,255,0.04)",
      }}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-3 bg-bg-elevated border-b border-border-subtle">
        {/* Traffic lights */}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-accent-red opacity-80" />
          <div className="w-3 h-3 rounded-full bg-accent-amber opacity-80" />
          <div className="w-3 h-3 rounded-full bg-accent-green opacity-80" />
        </div>
        <span className="flex-1 text-center text-xs text-text-muted font-mono select-none">
          {title}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 font-mono text-sm leading-relaxed overflow-auto max-h-[420px]">
        {children}
      </div>
    </div>
  );
}
