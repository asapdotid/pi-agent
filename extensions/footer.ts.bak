/**
 * Powerline-style standalone footer extension — ONE file, no @xynogen/* imports.
 * Deploy: cp footer.standalone.ts ~/.pi/agent/extensions/footer.ts
 * Needs only pi's own packages (provided by the host).
 *
 * Layout: [MODE] │ cwd branch markers │ model · thinking [ctx]   statuses · tokens · TPS │ clock
 * Differences from the pix package: icons are Nerd Font only, toggles are the OPTS
 * constant (no pix.json), no benchmark score, price fallback comes from pi's model
 * registry
 */

import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type {
  ExtensionAPI,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const run = promisify(execFile);

// Calibration knobs.
const OPTS = {
  mode: true,
  cwd: true,
  git: true,
  context: true,
  model: true,
  thinking: true,
  statuses: true,
  tokens: true,
  cost: true,
  tps: true,
  clock: true,
  wrap: false,
};
type Opts = typeof OPTS;
const GIT_POLL_MS = 2_000;
const FOOTER_PAD = 1;

const ICONS = {
  model: "\u{F06A9}",
  lsp: "\u{F0626}",
  mcp: "\u{F048D}",
  cwd: "\u{F0770}",
  "git.branch": "\u{F062C}",
  "git.unstaged": "\u2717",
  "git.ahead": "\u21E1",
  "git.behind": "\u21E3",
  "net.in": "\u21E1",
  "net.out": "\u21E3",
  thinking: "\u{F09D1}",
  cache: "\u{F01BC}",
  clock: "\u{F0150}",
} as const;
const icon = (k: keyof typeof ICONS) => ICONS[k];

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) =>
  s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, "");

type Theme = {
  fg(color: string, text: string): string;
  getThinkingBorderColor(level: never): (text: string) => string;
};

const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const THINK_ABBR: Record<string, string> = { minimal: "min", medium: "med" };

const fmtTokenCount = (n: number): string =>
  n < 1_000
    ? `${n}`
    : n < 1_000_000
      ? `${(n / 1_000).toFixed(1)}K`
      : `${(n / 1_000_000).toFixed(2)}M`;

// ─── Git ─────────────────────────────────────────────────────────────

interface GitStatus {
  dirty: boolean;
  staged: number;
  untracked: number;
  unstaged: number;
  ahead: number;
  behind: number;
}

/** Parse `git status`; null outside a repo or when git is missing. */
async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      "git",
      ["status", "--porcelain=v1", "--branch", "--untracked-files=normal"],
      { cwd, timeout: 2_000, maxBuffer: 1024 * 1024 },
    ));
  } catch {
    return null;
  }
  let staged = 0,
    unstaged = 0,
    untracked = 0,
    ahead = 0,
    behind = 0;
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith("## ")) {
      const m = line.match(
        /\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/,
      );
      if (m) {
        if (m[1]) ahead = parseInt(m[1], 10);
        if (m[2]) behind = parseInt(m[2], 10);
        if (m[3]) behind = parseInt(m[3], 10);
      }
      continue;
    }
    if (line.startsWith("??")) {
      untracked += 1;
      continue;
    }
    if (line[0] && line[0] !== " " && line[0] !== "?") staged += 1;
    if (line[1] && line[1] !== " " && line[1] !== "?") unstaged += 1;
  }
  return {
    dirty: unstaged + untracked > 0,
    staged,
    untracked,
    unstaged,
    ahead,
    behind,
  };
}

// ─── Segment builders ────────────────────────────────────────────────

interface SessionTotals {
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
  /** Every message cost is the provider-billed total, not a catalog estimate. */
  billed: boolean;
}

type Price = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};
type PriceLookup = (provider: string, id: string) => Price | undefined;

type MsgLike = {
  role?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite?: number;
    cost: { total: number; totalFromProvider?: boolean };
  };
  provider?: string;
  model?: string;
};

function computeSessionTotals(
  entries: Iterable<unknown>,
  price?: PriceLookup,
): SessionTotals {
  let input = 0,
    output = 0,
    cacheRead = 0,
    cost = 0,
    billed = true;
  for (const e of entries as Iterable<{ type: string; message?: MsgLike }>) {
    const m = e.message;
    if (e.type !== "message" || m?.role !== "assistant" || !m.usage) continue;
    const u = m.usage;
    input += u.input;
    output += u.output;
    cacheRead += u.cacheRead;
    let c = u.cost.total;
    if (!u.cost.totalFromProvider && !(c > 0) && m.provider && m.model) {
      const p = price?.(m.provider, m.model);
      if (p)
        c =
          (u.input * (p.input ?? 0) +
            u.output * (p.output ?? 0) +
            u.cacheRead * (p.cacheRead ?? p.input ?? 0) +
            (u.cacheWrite ?? 0) * (p.cacheWrite ?? p.input ?? 0)) /
          1_000_000;
    }
    cost += c;
    if (c > 0 && !u.cost.totalFromProvider) billed = false;
  }
  return { input, output, cacheRead, cost, billed };
}

/** Live tokens/sec; null when the window is too short to trust (reasoning tokens land as a lump). */
const computeTps = (totalOutput: number, elapsedSec: number): number | null =>
  totalOutput <= 0 || elapsedSec < 1
    ? null
    : Math.round(totalOutput / elapsedSec);

function renderTokens(
  totals: SessionTotals,
  theme: Theme,
  faded: boolean,
  o: Pick<Opts, "tokens" | "cost">,
) {
  let s = o.tokens
    ? `${icon("net.in")} ${fmtTokenCount(totals.input)} ${icon("net.out")} ${fmtTokenCount(totals.output)}`
    : "";
  if (o.cost && totals.cost > 0)
    s += `${s ? " · " : ""}$${totals.billed ? "" : "~"}${totals.cost.toFixed(3)}`;
  return s ? theme.fg(faded ? "muted" : "dim", s) : "";
}

function renderCtxUsage(
  usage: { percent?: number | null; contextWindow?: number } | undefined,
  theme: Theme,
): string {
  if (usage?.percent == null || !usage.contextWindow) return "";
  const pct = Math.round(usage.percent);
  const used = Math.round((usage.percent / 100) * usage.contextWindow);
  const color = pct >= 80 ? "error" : pct >= 50 ? "warning" : "success";
  return (
    theme.fg("muted", "[") +
    theme.fg("success", fmtTokenCount(used)) +
    theme.fg(
      "muted",
      `/${fmtTokenCount(usage.contextWindow)} ${icon("cache")} `,
    ) +
    theme.fg(color, `${pct}%`) +
    theme.fg("muted", "]")
  );
}

function renderClock(now: Date, theme: Theme): string {
  const hhmm = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return theme.fg("muted", `${icon("clock")} `) + theme.fg("dim", hhmm);
}

function renderBranch(
  branch: string | null,
  gs: GitStatus | null,
  theme: Theme,
) {
  if (!branch) return { branchSeg: "", markersSeg: "" };
  const branchSeg = ` ${theme.fg("success", ` ${icon("git.branch")} `) + theme.fg("warning", branch) + (gs?.dirty ? theme.fg("error", "*") : "")}`;
  const markers: string[] = [];
  if (gs) {
    if (gs.staged > 0) markers.push(theme.fg("success", `+${gs.staged}`));
    if (gs.unstaged > 0)
      markers.push(theme.fg("error", `${icon("git.unstaged")}${gs.unstaged}`));
    if (gs.untracked > 0) markers.push(theme.fg("warning", `?${gs.untracked}`));
    if (gs.ahead > 0)
      markers.push(theme.fg("accent", `${icon("git.ahead")}${gs.ahead}`));
    if (gs.behind > 0)
      markers.push(theme.fg("accent", `${icon("git.behind")}${gs.behind}`));
  }
  return { branchSeg, markersSeg: markers.join(" ") };
}

function renderModel(
  model: { id?: string } | undefined,
  thinking: string,
  theme: Theme,
  o: Opts,
  context = "",
): string {
  const id = (model?.id ?? "?").replace(/^[a-z]+\//i, "");
  let out = o.model
    ? theme.fg("success", `${icon("model")}  `) + theme.fg("accent", id)
    : "";
  const sep = () => (out ? theme.fg("muted", `  ${icon("thinking")} `) : "");
  if (o.thinking && thinking) {
    const abbr = THINK_ABBR[thinking] ?? thinking.slice(0, 5);
    out +=
      sep() +
      (THINKING_LEVELS.has(thinking)
        ? `\x1b[38;2;215;135;175m${abbr}\x1b[39m`
        : theme.fg("dim", abbr));
  }
  if (context) out += (out ? " " : "") + context;
  return out;
}

/** Replace verbose status text with icon + value. */
function compactStatus(key: string, value: string, theme: Theme): string {
  const raw = stripAnsi(value);
  switch (key) {
    case "pi-lens-lsp": {
      const legacy = raw.match(/LSP Active \((\d+)\)/)?.[1];
      const active = raw.match(/LSP Active:\s*([^·]+)/)?.[1];
      const failed = raw.match(/LSP Failed:\s*([^·]+)/)?.[1];
      const count = (l?: string) =>
        l ? l.split(",").filter((i) => i.trim()).length : 0;
      const a = legacy ? Number(legacy) : count(active);
      const f = count(failed);
      if (a > 0)
        return theme.fg(
          "success",
          `${icon("lsp")}  ${a}${f > 0 ? ` !${f}` : ""}`,
        );
      if (f > 0) return theme.fg("error", `${icon("lsp")}  !${f}`);
      if (/LSP Inactive/.test(raw))
        return theme.fg("muted", `${icon("lsp")}  off`);
      return value;
    }
    case "mcp": {
      const m = raw.match(/(\d+)\/(\d+)\s+servers/);
      return m ? theme.fg("dim", `${icon("mcp")} ${m[1]}/${m[2]}`) : value;
    }
    case "caveman": {
      const m = raw.match(/caveman level:\s*(\S+)/);
      return m ? theme.fg("dim", `🪨 ${m[1]}`) : value;
    }
    default:
      return value;
  }
}

function renderStatuses(
  statuses: ReadonlyMap<string, string>,
  sep: string,
  theme: Theme,
) {
  const seen = new Set<string>(["plan", "phase", "unattended"]);
  const others: string[] = [];
  for (const k of ["mcp", "pi-lens-lsp", "caveman"]) {
    const v = statuses.get(k);
    seen.add(k);
    if (v) others.push(compactStatus(k, v, theme));
  }
  for (const [k, v] of statuses)
    if (!seen.has(k) && v) others.push(compactStatus(k, v, theme));
  return {
    modePart: statuses.get("plan") ?? statuses.get("phase") ?? "",
    unattendedPart: statuses.get("unattended") ?? "",
    otherPart: others.join(sep),
  };
}

// ─── Layout & font weight ────────────────────────────────────────────

// Terminals only have faint / normal / bold; "semi" is the normal weight.
const WEIGHTS = { light: "\x1b[2m", semi: "", bold: "\x1b[1m" } as const;
type Weight = keyof typeof WEIGHTS;
const WEIGHT_ORDER = Object.keys(WEIGHTS) as Weight[];

const joinSegs = (segs: string[], sep: string) =>
  segs.filter(Boolean).join(sep);

// ─── Extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let liveTps: string | null = null;
  // TPS and tokens share visibility: "on" → (4s) → "dim" → (4s) → "off".
  let weight: Weight = "semi";
  pi.registerCommand("footer-font", {
    description: "Cycle footer font weight: light → semi → bold (or pass one)",
    handler: async (args, ctx) => {
      const want = args.trim() as Weight;
      weight =
        WEIGHTS[want] !== undefined
          ? want
          : WEIGHT_ORDER[(WEIGHT_ORDER.indexOf(weight) + 1) % 3];
      requestRender?.();
      ctx.ui.notify(`footer font: ${weight}`, "info");
    },
  });
  let tokensState: "on" | "dim" | "off" = "off";
  let tokensTimer: ReturnType<typeof setTimeout> | null = null;
  let requestRender: (() => void) | null = null;
  let totals = computeSessionTotals([]);
  let price: PriceLookup | undefined;

  let gitStatus: GitStatus | null = null;
  let gitTimer: ReturnType<typeof setInterval> | null = null;
  let currentCwd = "";
  // ── TPS tracking ──
  const activeStreams = new Map<string, { start: number; output: number }>();
  let tpsTicker: ReturnType<typeof setInterval> | null = null;

  const recomputeTps = () => {
    let total = 0;
    let earliest = Infinity;
    for (const s of activeStreams.values()) {
      total += s.output;
      if (s.start < earliest) earliest = s.start;
    }
    if (earliest === Infinity) return;
    const rate = computeTps(total, (Date.now() - earliest) / 1000);
    if (rate === null) return;
    const next = `${rate} t/s`;
    if (next !== liveTps) {
      liveTps = next;
      requestRender?.();
    }
  };
  const stopTpsTicker = () => {
    if (tpsTicker) clearInterval(tpsTicker);
    tpsTicker = null;
  };

  // AssistantMessage.id exists at runtime but not in the published types.
  type RuntimeMsg = {
    id: string;
    role?: string;
    usage?: { input?: number; output?: number };
  };
  const asMsg = (m: unknown) => m as RuntimeMsg;

  pi.on("message_start", async (event) => {
    const msg = asMsg(event.message);
    if (msg.role !== "assistant") return;
    if (activeStreams.size === 0) liveTps = null;
    activeStreams.set(msg.id, { start: Date.now(), output: 0 });
    tpsTicker ??= setInterval(recomputeTps, 100);
    if (tokensTimer) clearTimeout(tokensTimer);
    tokensTimer = null;
    if (tokensState !== "on") {
      tokensState = "on";
      requestRender?.();
    }
  });

  pi.on("message_update", async (event) => {
    const msg = asMsg(event.message);
    if (msg.role !== "assistant") return;
    const s = activeStreams.get(msg.id);
    if (!s) return;
    const partial = (event.assistantMessageEvent as { partial?: RuntimeMsg })
      .partial;
    const out = partial?.usage?.output ?? msg.usage?.output ?? 0;
    if (out > s.output) s.output = out;
  });

  pi.on("message_end", async (event) => {
    const msg = asMsg(event.message);
    if (msg.role !== "assistant") return;
    const s = activeStreams.get(msg.id);
    const finalOut = msg.usage?.output ?? 0;
    if (s && finalOut > s.output) s.output = finalOut;
    recomputeTps();
    activeStreams.delete(msg.id);
    if (activeStreams.size === 0) stopTpsTicker();
    if (typeof msg.usage?.input === "number") {
      const d = computeSessionTotals(
        [{ type: "message", message: event.message }],
        price,
      );
      totals.input += d.input;
      totals.output += d.output;
      totals.cacheRead += d.cacheRead;
      totals.cost += d.cost;
      totals.billed &&= d.billed;
      requestRender?.();
    }
  });

  pi.on("agent_end", () => {
    stopTpsTicker();
    activeStreams.clear();
    if (tokensTimer) clearTimeout(tokensTimer);
    tokensTimer = setTimeout(() => {
      tokensState = "dim";
      requestRender?.();
      tokensTimer = setTimeout(() => {
        tokensState = "off";
        liveTps = null;
        tokensTimer = null;
        requestRender?.();
      }, 4_000);
    }, 4_000);
  });

  // ── Git ──
  const refreshGit = async (cwd: string) => {
    const next = await getGitStatus(cwd);
    const changed = JSON.stringify(next) !== JSON.stringify(gitStatus);
    gitStatus = next;
    if (changed) requestRender?.();
  };

  pi.on("tool_execution_end", async (_event, ctx) => {
    await refreshGit(ctx.cwd);
  });

  pi.on("session_tree", (_event, ctx) => {
    totals = computeSessionTotals(ctx.sessionManager.getBranch(), price);
    requestRender?.();
  });

  pi.on("session_start", (_event, ctx) => {
    currentCwd = ctx.cwd;
    // Price fallback for messages without provider cost: pi's registered model rates ($/1M).
    price = (provider, id) =>
      (ctx.modelRegistry?.find(provider, id) as { cost?: Price } | undefined)
        ?.cost;
    totals = computeSessionTotals(ctx.sessionManager.getBranch(), price);
    void refreshGit(currentCwd);
    if (gitTimer) clearInterval(gitTimer);
    gitTimer = setInterval(() => {
      if (currentCwd) void refreshGit(currentCwd);
      requestRender?.(); // also refreshes the clock
    }, GIT_POLL_MS);

    ctx.ui.setFooter(
      (tui, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
        requestRender = () => tui.requestRender();
        const unsub = footerData.onBranchChange(() => {
          void refreshGit(ctx.cwd);
          tui.requestRender();
        });

        const row = (width: number): string[] => {
          const sep = theme.fg("muted", " │ ");
          const tokens =
            tokensState === "off"
              ? ""
              : renderTokens(totals, theme, tokensState === "dim", {
                  ...OPTS,
                  cost: false,
                });
          const spend = renderTokens(totals, theme, false, {
            ...OPTS,
            tokens: false,
          });
          const model = renderModel(
            ctx.model,
            pi.getThinkingLevel?.() ?? "",
            theme,
            OPTS,
            OPTS.context ? renderCtxUsage(ctx.getContextUsage?.(), theme) : "",
          );
          const { branchSeg, markersSeg } = renderBranch(
            footerData.getGitBranch(),
            gitStatus,
            theme,
          );
          const { modePart, unattendedPart, otherPart } = renderStatuses(
            footerData.getExtensionStatuses(),
            sep,
            theme,
          );
          const loc = OPTS.cwd
            ? theme.fg("warning", `${icon("cwd")}  `) +
              `\x1b[1;35m${basename(ctx.cwd) || ctx.cwd}\x1b[0m`
            : "";
          const tpsPart = [
            OPTS.tps && tokensState !== "off"
              ? theme.fg(
                  tokensState === "dim" ? "muted" : "dim",
                  liveTps ?? "— t/s",
                )
              : "",
            tokens,
            spend,
          ]
            .filter(Boolean)
            .join(theme.fg("muted", " · "));
          const left = joinSegs(
            [
              OPTS.mode ? modePart : "",
              loc + (OPTS.git ? branchSeg : ""),
              OPTS.git ? markersSeg : "",
              model,
            ],
            sep,
          );
          const right = joinSegs(
            [
              tpsPart,
              OPTS.statuses ? unattendedPart : "",
              OPTS.statuses ? otherPart : "",
              OPTS.clock ? renderClock(new Date(), theme) : "",
            ],
            sep,
          );
          const line = joinSegs([left, right], sep);
          if (!line || width < 1) return [];
          const gap = width - visibleWidth(left) - visibleWidth(right);
          if (left && right && gap >= 3)
            return [left + " ".repeat(gap) + right];
          if (OPTS.wrap) return wrapTextWithAnsi(line, width);
          if (visibleWidth(line) <= width) return [line];
          // Cut with an ellipsis (the pix package fades the tail instead).
          return [truncateToWidth(line, width, "…")];
        };

        return {
          dispose() {
            unsub();
            requestRender = null;
          },
          invalidate() {},
          render(width: number): string[] {
            const pad = " ".repeat(FOOTER_PAD);
            const w = WEIGHTS[weight];
            return row(Math.max(0, width - 2 * FOOTER_PAD)).map(
              (l) =>
                (w
                  ? w + l.replaceAll("\x1b[0m", `\x1b[0m${w}`) + "\x1b[22m"
                  : l
                ).replace(/^/, pad) + pad,
            );
          },
        };
      },
    );
  });

  pi.on("session_shutdown", () => {
    if (gitTimer) clearInterval(gitTimer);
    gitTimer = null;
    if (tokensTimer) clearTimeout(tokensTimer);
    tokensTimer = null;
    stopTpsTicker();
  });
}
