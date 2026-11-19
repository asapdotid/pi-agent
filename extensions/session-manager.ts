import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, SessionManager } from "@mariozechner/pi-coding-agent";
import { Container, SelectList, type SelectItem, Text, matchesKey } from "@mariozechner/pi-tui";
import { unlink } from "node:fs/promises";
import { basename } from "node:path";

type SessionInfo = Awaited<ReturnType<typeof SessionManager.list>>[number];

// ─── Configuration ────────────────────────────────────────────────────────────
const NAME_WIDTH = 50;
const AGE_WIDTH = 6;
const MSG_WIDTH = 6;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatAge(date: Date): string {
	const s = Math.floor((Date.now() - date.getTime()) / 1000);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

function shortCwd(cwd: string): string {
	const home = process.env.HOME || "";
	const s = home ? cwd.replace(home, "~") : cwd;
	const p = s.split("/").filter(Boolean);
	return p.length <= 2 ? s : "…/" + p.slice(-2).join("/");
}

function title(s: SessionInfo): string {
	if (s.name) return s.name;
	const f = (s.firstMessage ?? "").trim();
	if (!f) return basename(s.path, ".jsonl");
	return f;
}

function ageColor(seconds: number): string {
	if (seconds < 60) return "success";
	if (seconds < 3600) return "accent";
	if (seconds < 86400) return "warning";
	return "error";
}

function msgColor(n: number): string {
	if (n === 0) return "dim";
	if (n < 5) return "warning";
	if (n < 20) return "accent";
	return "success";
}

// ─── Main UI Logic ────────────────────────────────────────────────────────────
async function browse(pi: ExtensionAPI, ctx: ExtensionCommandContext, showAll: boolean) {
	while (true) {
		const sessions = (showAll
			? await SessionManager.listAll()
			: await SessionManager.list(ctx.cwd)
		).sort((a, b) => b.modified.getTime() - a.modified.getTime());

		if (!sessions.length) {
			ctx.ui.notify("No sessions found.", "info");
			return;
		}

		const currentPath = ctx.sessionManager.getSessionFile() ?? "";
		let sel = sessions[0]!;

		type R = { a: "resume" | "delete" | "rename" | "toggle" | "cancel"; s?: SessionInfo };

		const r = await ctx.ui.custom<R>(
			(_tui, theme, _kb, done) => {
				const c = new Container();
				const border = (s: string) => theme.fg("accent", s);
				c.addChild(new DynamicBorder(border));

				// ── Header ──────────────────────────────────────────────
				const scopeBadge = showAll
					? theme.fg("warning", theme.bold("[ ALL PROJECTS ]"))
					: theme.fg("success", theme.bold("[ CURRENT PROJECT ]"));
				const countBadge = theme.fg(
					"dim",
					`${sessions.length} session${sessions.length === 1 ? "" : "s"}`,
				);
				c.addChild(
					new Text(
						` ${theme.bold(theme.fg("accent", "📁 Sessions"))}  ${scopeBadge}  ${countBadge}`,
						1,
						0,
					),
				);

				// ── Column Headers ──────────────────────────────────────
				const headerText = 
					"    " + // Space for markers (● / ★)
					theme.fg("dim", theme.bold("NAME".padEnd(NAME_WIDTH))) + " " +
					theme.fg("dim", theme.bold("AGE".padEnd(AGE_WIDTH))) + " · " +
					theme.fg("dim", theme.bold("MSGS".padEnd(MSG_WIDTH))) + " · " +
					theme.fg("dim", theme.bold("PATH"));
				c.addChild(new Text(" " + headerText, 1, 0));

				// ── Items ───────────────────────────────────────────────
				const items: SelectItem[] = sessions.map((s, i) => {
					const isCurrent = s.path === currentPath;
					const ageSec = Math.floor((Date.now() - s.modified.getTime()) / 1000);
					
					const marker = isCurrent ? theme.fg("success", "● ") : "  ";
					const star = s.name ? theme.fg("accent", "★ ") : "  ";
					
					// 1. Name
					const rawTitle = title(s);
					const paddedTitle = rawTitle.length > NAME_WIDTH 
						? rawTitle.slice(0, NAME_WIDTH - 1) + "…" 
						: rawTitle.padEnd(NAME_WIDTH);

					// 2. Age & Msgs (Pad before coloring for perfect alignment)
					const rawAge = `⏱ ${formatAge(s.modified)}`.padEnd(AGE_WIDTH);
					const rawMsgs = `💬 ${s.messageCount}`.padEnd(MSG_WIDTH);
					const age = theme.fg(ageColor(ageSec), rawAge);
					const msgs = theme.fg(msgColor(s.messageCount), rawMsgs);
					
					// 3. Path
					const cwd = theme.fg("dim", `📂 ${shortCwd(s.cwd)}`);
					const dot = theme.fg("dim", "·");

					return {
						value: String(i),
						label: `${marker}${star}${paddedTitle} ${age} ${dot} ${msgs} ${dot} ${cwd}`,
						description: "", // Bypassed; all data is in the label
					};
				});

				const list = new SelectList(items, Math.min(sessions.length, 12), {
					selectedPrefix: (t) => theme.fg("accent", theme.bold(t)),
					selectedText: (t) => theme.fg("accent", theme.bold(t)),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});
				
				list.onSelectionChange = (item) => { sel = sessions[Number(item.value)]!; };
				list.onSelect = (item) => done({ a: "resume", s: sessions[Number(item.value)]! });
				list.onCancel = () => done({ a: "cancel" });
				c.addChild(list);

				// ── Hint bar ────────────────────────────────────────────
				const key = (k: string) => theme.fg("accent", theme.bold(`[${k}]`));
				const desc = (t: string) => theme.fg("dim", t);
				const sep = theme.fg("dim", " · ");
				c.addChild(
					new Text(
						" " +
						`${key("Enter")}${desc(" resume")}${sep}` +
						`${key("d")}${desc(" delete")}${sep}` +
						`${key("n")}${desc(" rename")}${sep}` +
						`${key("Tab")}${desc(" scope")}${sep}` +
						`${key("Esc")}${desc(" close")}`,
						1,
						0,
					),
				);

				c.addChild(new DynamicBorder(border));
				
				return {
					render: (w) => c.render(w),
					invalidate: () => c.invalidate(),
					handleInput: (data) => {
						if (matchesKey(data, "tab")) { done({ a: "toggle" }); return; }
						if (data === "d") { done({ a: "delete", s: sel }); return; }
						if (data === "n") { done({ a: "rename", s: sel }); return; }
						list.handleInput(data);
					},
				};
			},
			{
				overlay: true,
				overlayOptions: { anchor: "center", width: "95%", minWidth: 110, maxHeight: "85%" },
			},
		);

		if (!r || r.a === "cancel") return;
		if (r.a === "toggle") { showAll = !showAll; continue; }

		if (r.a === "resume") {
			if (r.s!.path === currentPath) {
				ctx.ui.notify("Already in this session.", "info");
				return;
			}
			await ctx.switchSession(r.s!.path, {
				withSession: async (replacementCtx) => {
					const name = replacementCtx.sessionManager.getSessionName();
					replacementCtx.ui.setStatus(
						"sm",
						name ? replacementCtx.ui.theme.fg("accent", `📁 ${name}`) : undefined,
					);
				},
			});
			return;
		}

		if (r.a === "delete") {
			if (await ctx.ui.confirm("Delete?", `"${title(r.s!)}"\n\nThis cannot be undone.`)) {
				try {
					await unlink(r.s!.path);
					ctx.ui.notify("Deleted.", "info");
				} catch (e) {
					ctx.ui.notify(`Failed: ${e}`, "error");
				}
			}
			continue;
		}

		if (r.a === "rename") {
			if (r.s!.path === currentPath) {
				const name = await ctx.ui.input("New name:", r.s!.name ?? "");
				if (name?.trim()) {
					pi.setSessionName(name.trim());
					ctx.ui.setStatus("sm", ctx.ui.theme.fg("accent", `📁 ${name.trim()}`));
				}
			} else {
				ctx.ui.notify("Resume that session first, then use /name.", "warning");
			}
			continue;
		}
	}
}

// ─── Extension Setup ──────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_e, ctx) => {
		const name = ctx.sessionManager.getSessionName();
		ctx.ui.setStatus("sm", name ? ctx.ui.theme.fg("accent", `📁 ${name}`) : undefined);
	});

	pi.registerCommand("sessions", {
		description: "Browse sessions (/sessions [all])",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();
			await browse(pi, ctx, args.trim().toLowerCase() === "all");
		},
	});

	pi.registerCommand("sall", {
		description: "Browse all sessions",
		handler: async (_a, ctx) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();
			await browse(pi, ctx, true);
		},
	});
}