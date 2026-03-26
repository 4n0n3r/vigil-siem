export type TokenType =
  | "prompt"
  | "cmd"
  | "flag"
  | "flagval"
  | "plain"
  | "json-key"
  | "json-str"
  | "json-num"
  | "json-bool"
  | "severity-high"
  | "severity-critical"
  | "severity-medium"
  | "ok"
  | "table-border"
  | "comment";

export interface TerminalToken {
  text: string;
  type: TokenType;
}

export interface TerminalLine {
  tokens: TerminalToken[];
  delay?: number; // ms before this line appears (default 80)
  isOutput?: boolean;
}

export interface TerminalFrame {
  lines: TerminalLine[];
  pauseAfter?: number; // ms pause after all lines typed
}

// Helper to build a prompt line
function prompt(cmd: TerminalToken[]): TerminalLine {
  return {
    tokens: [{ text: "$ ", type: "prompt" }, ...cmd],
    delay: 0,
  };
}

function t(text: string, type: TokenType): TerminalToken {
  return { text, type };
}

export const TERMINAL_FRAMES: TerminalFrame[] = [
  // Frame 1: vigil doctor
  {
    lines: [
      prompt([
        t("vigil", "cmd"),
        t(" doctor ", "plain"),
        t("--output", "flag"),
        t(" json", "flagval"),
      ]),
      {
        tokens: [t("{", "plain")],
        isOutput: true,
        delay: 120,
      },
      {
        tokens: [
          t('  "checks": [', "plain"),
        ],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [
          t('    { "name": ', "plain"),
          t('"api"', "json-str"),
          t(",", "plain"),
          t(' "status": ', "plain"),
          t('"pass"', "ok"),
          t(" },", "plain"),
        ],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [
          t('    { "name": ', "plain"),
          t('"clickhouse"', "json-str"),
          t(",", "plain"),
          t(' "status": ', "plain"),
          t('"pass"', "ok"),
          t(" },", "plain"),
        ],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [
          t('    { "name": ', "plain"),
          t('"postgres"', "json-str"),
          t(",", "plain"),
          t(' "status": ', "plain"),
          t('"pass"', "ok"),
          t(" }", "plain"),
        ],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [t("  ]", "plain")],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [t("}", "plain")],
        isOutput: true,
        delay: 60,
      },
    ],
    pauseAfter: 700,
  },

  // Frame 2: vigil alerts list
  {
    lines: [
      prompt([
        t("vigil", "cmd"),
        t(" alerts list ", "plain"),
        t("--severity", "flag"),
        t(" high ", "flagval"),
        t("--output", "flag"),
        t(" json", "flagval"),
      ]),
      {
        tokens: [t("{", "plain")],
        isOutput: true,
        delay: 120,
      },
      {
        tokens: [t('  "alerts": [', "plain")],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [t("    {", "plain")],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [
          t('      "id": ', "plain"),
          t('"a1b2c3d4"', "json-str"),
          t(",", "plain"),
        ],
        isOutput: true,
        delay: 50,
      },
      {
        tokens: [
          t('      "rule_name": ', "plain"),
          t('"Brute Force Multiple Failures"', "json-str"),
          t(",", "plain"),
        ],
        isOutput: true,
        delay: 50,
      },
      {
        tokens: [
          t('      "severity": ', "plain"),
          t('"high"', "severity-high"),
          t(",", "plain"),
        ],
        isOutput: true,
        delay: 50,
      },
      {
        tokens: [
          t('      "matched_at": ', "plain"),
          t('"2026-03-23T14:22:01Z"', "json-str"),
        ],
        isOutput: true,
        delay: 50,
      },
      {
        tokens: [t("    }", "plain")],
        isOutput: true,
        delay: 50,
      },
      {
        tokens: [t("  ],", "plain")],
        isOutput: true,
        delay: 50,
      },
      {
        tokens: [
          t('  "total": ', "plain"),
          t("1", "json-num"),
        ],
        isOutput: true,
        delay: 50,
      },
      {
        tokens: [t("}", "plain")],
        isOutput: true,
        delay: 50,
      },
    ],
    pauseAfter: 700,
  },

  // Frame 3: vigil hunt
  {
    lines: [
      prompt([
        t("vigil", "cmd"),
        t(" hunt ", "plain"),
        t("--query", "flag"),
        t(' "event_id:4625" ', "flagval"),
        t("--agg", "flag"),
        t(" event_data.IpAddress", "flagval"),
      ]),
      {
        tokens: [
          t("┌─────────────────┬────────┐", "table-border"),
        ],
        isOutput: true,
        delay: 200,
      },
      {
        tokens: [
          t("│ ", "table-border"),
          t("IpAddress       ", "json-key"),
          t(" │ ", "table-border"),
          t("count  ", "json-key"),
          t(" │", "table-border"),
        ],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [
          t("├─────────────────┼────────┤", "table-border"),
        ],
        isOutput: true,
        delay: 40,
      },
      {
        tokens: [
          t("│ ", "table-border"),
          t("192.168.1.45    ", "json-str"),
          t(" │ ", "table-border"),
          t("   847  ", "severity-high"),
          t(" │", "table-border"),
        ],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [
          t("│ ", "table-border"),
          t("10.0.0.12       ", "json-str"),
          t(" │ ", "table-border"),
          t("   203  ", "json-num"),
          t(" │", "table-border"),
        ],
        isOutput: true,
        delay: 60,
      },
      {
        tokens: [
          t("└─────────────────┴────────┘", "table-border"),
        ],
        isOutput: true,
        delay: 40,
      },
    ],
    pauseAfter: 2000,
  },
];

export const TOKEN_COLORS: Record<TokenType, string> = {
  prompt: "text-text-muted",
  cmd: "text-accent-cyan font-semibold",
  flag: "text-accent-amber",
  flagval: "text-text-primary",
  plain: "text-text-primary",
  "json-key": "text-accent-cyan",
  "json-str": "text-accent-green",
  "json-num": "text-accent-amber",
  "json-bool": "text-accent-amber",
  "severity-high": "text-accent-amber font-semibold",
  "severity-critical": "text-accent-red font-semibold",
  "severity-medium": "text-yellow-400",
  ok: "text-accent-green font-semibold",
  "table-border": "text-text-muted",
  comment: "text-text-muted italic",
};
