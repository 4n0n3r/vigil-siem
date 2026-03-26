"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  TERMINAL_FRAMES,
  TOKEN_COLORS,
  type TerminalLine,
} from "./terminalScript";
import { TerminalWindow } from "./TerminalWindow";

interface DisplayLine {
  tokens: Array<{ text: string; type: string }>;
  isOutput?: boolean;
}

export function TerminalAnimator() {
  const [displayLines, setDisplayLines] = useState<DisplayLine[]>([]);
  const [showCursor, setShowCursor] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const clearTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const scheduleTimeout = (fn: () => void, delay: number) => {
    const id = setTimeout(fn, delay);
    timeoutsRef.current.push(id);
  };

  const runAnimation = useCallback(() => {
    clearTimeouts();
    setDisplayLines([]);
    setIsAnimating(true);

    let allLines: TerminalLine[] = [];
    let cumulativeDelay = 400;

    TERMINAL_FRAMES.forEach((frame) => {
      frame.lines.forEach((line) => {
        allLines.push(line);
        cumulativeDelay += line.delay ?? 80;

        const capturedLines = [...allLines];
        const capturedDelay = cumulativeDelay;

        scheduleTimeout(() => {
          setDisplayLines(
            capturedLines.map((l) => ({
              tokens: l.tokens,
              isOutput: l.isOutput,
            }))
          );
          // Scroll to bottom
          if (containerRef.current) {
            const scrollable =
              containerRef.current.querySelector("[data-scroll]");
            if (scrollable)
              scrollable.scrollTop = scrollable.scrollHeight;
          }
        }, capturedDelay);
      });

      // Add pause between frames
      cumulativeDelay += frame.pauseAfter ?? 500;
    });

    // After all frames, restart
    scheduleTimeout(() => {
      setIsAnimating(false);
      scheduleTimeout(runAnimation, 1500);
    }, cumulativeDelay + 1000);
  }, []);

  useEffect(() => {
    // Cursor blink
    const cursorInterval = setInterval(
      () => setShowCursor((v) => !v),
      530
    );

    // Start animation after mount
    const startId = setTimeout(runAnimation, 600);
    timeoutsRef.current.push(startId);

    return () => {
      clearInterval(cursorInterval);
      clearTimeouts();
    };
  }, [runAnimation]);

  return (
    <div ref={containerRef}>
      <TerminalWindow>
        <div data-scroll className="overflow-auto max-h-[380px]">
          {displayLines.map((line, i) => (
            <div
              key={i}
              className={`flex flex-wrap leading-6 ${
                line.isOutput ? "pl-0 text-sm" : "text-sm"
              }`}
            >
              {line.tokens.map((token, j) => (
                <span
                  key={j}
                  className={TOKEN_COLORS[token.type as keyof typeof TOKEN_COLORS] ?? "text-text-primary"}
                >
                  {token.text}
                </span>
              ))}
            </div>
          ))}
          {/* Cursor */}
          <span
            className={`inline-block w-2 h-4 bg-accent-cyan ml-0.5 align-middle transition-opacity ${
              showCursor ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
      </TerminalWindow>
    </div>
  );
}
