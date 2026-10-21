//#region lib/types/client/index.js
/**
 * Job progress (browser half).
 *
 * Background jobs started from a session (a `curl`/`wget`/`apt` download, a build,
 * a render…) run server-side and report nothing but "running" to the chat. The
 * shipped job list lives behind a header popover and only streams output after a
 * row is expanded, so progress is invisible unless the reader keeps opening it.
 *
 * This plugin renders a small floating card in the session view:
 *   - one row per live job — label, elapsed time, progress bar and the latest
 *     output line;
 *   - a progress bar fed by the job's own `progress` field when the producer sets
 *     one, otherwise parsed from the live output tail (`45%`, curl's table row,
 *     `1.2 GB / 3.4 GB`, speed and ETA);
 *   - settled jobs stay for a few seconds with their final state, then the card
 *     disappears when nothing is left;
 *   - the card collapses to a compact pill with the aggregate percentage.
 *
 * It reads only the jobs of the current session through `ctx.jobs` and never
 * looks at conversation content. No host code, no network beyond the job stream.
 */
window.__ModuleLoader__.load({
	id: "dsh-job-progress",
	factory: (require) => {
		"use strict";
		const React = require("react");
		const jsxRuntime = require("react/jsx-runtime");
		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;
		const { createPortal } = require("react-dom");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } = primitives;

		/** Locale namespace owned by this plugin. */
		const NS = "jobProgress";
		/** How long a settled job stays on the card after it ends. */
		const LINGER_MS = 8000;
		/** At most this many rows are rendered; the rest collapse into a counter. */
		const MAX_ROWS = 4;
		/** Where the reader parked the card, in viewport pixels. */
		const POSITION_KEY = "dsh-job-progress/position";
		/** Pointer travel before a press becomes a drag instead of a click. */
		const DRAG_THRESHOLD = 4;
		/** Stable empty roster so a session with no jobs keeps one array identity. */
		const NO_JOBS = [];

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"title": "后台任务",
			"count": "{n} 个",
			"collapse": "收起",
			"expand": "展开",
			"status.running": "运行中",
			"status.stopping": "正在停止",
			"status.completed": "已完成",
			"status.killed": "已取消",
			"status.failed": "已失败",
			"more": "还有 {n} 个",
			"waiting": "等待输出…",
			"eta": "剩余 {eta}"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"title": "Background jobs",
			"count": "{n}",
			"collapse": "Collapse",
			"expand": "Expand",
			"status.running": "Running",
			"status.stopping": "Stopping",
			"status.completed": "Done",
			"status.killed": "Cancelled",
			"status.failed": "Failed",
			"more": "{n} more",
			"waiting": "Waiting for output…",
			"eta": "{eta} left"
		};

		/** Card styles; colours come from the theme tokens. */
		const CSS = `
.djp-card{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom, 0px) + 92px);z-index:60;width:340px;max-width:calc(100vw - 32px);box-sizing:border-box;border-radius:14px;background:var(--dsw-specific-menu, #1f1f22);box-shadow:var(--dsw-elevation-prominent, 0 8px 30px rgba(0,0,0,.35));border:.5px solid var(--dsw-alias-border-l1, rgba(255,255,255,.08));overflow:hidden;font-size:12px;color:var(--dsw-alias-label-primary,#eee)}
.djp-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:grab;user-select:none;touch-action:none}
.djp-card[data-dragging="true"] .djp-head{cursor:grabbing}
.djp-title{font-weight:600;font-size:12px}
.djp-count{color:var(--dsw-alias-label-tertiary,#999);font-size:11px}
.djp-chevron{margin-left:auto;display:inline-flex;color:var(--dsw-alias-label-tertiary,#999)}
.djp-body{display:flex;flex-direction:column;gap:1px;padding:0 6px 6px}
.djp-row{padding:6px 6px 7px;border-radius:9px}
.djp-row:hover{background:var(--dsw-alias-fill-l1,rgba(255,255,255,.04))}
.djp-line1{display:flex;align-items:baseline;gap:8px;min-width:0}
.djp-dot{width:7px;height:7px;border-radius:50%;flex:none;align-self:center;background:var(--dsw-alias-label-tertiary,#999)}
.djp-dot[data-status="running"]{background:var(--dsw-alias-state-success-primary,#2fb344);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary,#2fb344) 18%, transparent)}
.djp-dot[data-status="stopping"]{background:var(--dsw-alias-state-warning-primary,#e0a100)}
.djp-dot[data-status="failed"]{background:var(--dsw-alias-state-error-primary,#e5484d)}
.djp-dot[data-status="killed"]{background:var(--dsw-alias-label-tertiary,#999)}
.djp-label{flex:1;min-width:0;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.djp-pct{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#bbb);font-size:11px}
.djp-time{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:10.5px;font-variant-numeric:tabular-nums}
.djp-bar{position:relative;height:3px;border-radius:2px;background:var(--dsw-alias-fill-l2,rgba(255,255,255,.1));margin:6px 0 5px;overflow:hidden}
.djp-fill{position:absolute;inset:0 auto 0 0;width:0;border-radius:2px;background:var(--dsw-alias-state-success-primary,#2fb344);transition:width .25s ease}
.djp-bar[data-indeterminate="true"] .djp-fill{width:30%!important;animation:djp-slide 1.2s ease-in-out infinite}
@keyframes djp-slide{0%{left:-30%}100%{left:100%}}
.djp-tail{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.djp-more{padding:2px 8px 4px;color:var(--dsw-alias-label-tertiary,#999);font-size:10.5px}
.djp-pill{touch-action:none;cursor:grab;position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom, 0px) + 92px);z-index:60;display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;background:var(--dsw-specific-menu,#1f1f22);box-shadow:var(--dsw-elevation-prominent,0 8px 30px rgba(0,0,0,.35));border:.5px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:11.5px;color:var(--dsw-alias-label-primary,#eee);cursor:pointer}
.djp-pill-bar{width:54px;height:3px;border-radius:2px;background:var(--dsw-alias-fill-l2,rgba(255,255,255,.12));overflow:hidden}
.djp-pill-fill{height:100%;background:var(--dsw-alias-state-success-primary,#2fb344);border-radius:2px}
`;

		//#region parsing
		/** Strip SGR/CSI escape sequences so progress meters do not leak colour codes. */
		function stripAnsi(text) {
			return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
		}

		/**
		 * Derive a progress reading from a job's output tail.
		 * Recognises wget/apt/pip style `NN%`, curl's table row (`  5 1024M   5 ...`),
		 * byte ratios (`1.2 GB / 3.4 GB`), transfer speed and `eta`.
		 * @param text - the accumulated output text (may be empty).
		 * @returns `{ percent, line, speed, eta, bytes }`, with `percent` null when unknown.
		 */
		function parseProgress(text) {
			if (typeof text !== "string" || text === "") return { percent: null, line: "", speed: null, eta: null, bytes: null };
			const clean = stripAnsi(text).slice(-4000);
			const lines = clean.split(/[\r\n]+/).map((line) => line.trim()).filter((line) => line !== "");
			const tail = lines.length === 0 ? "" : lines[lines.length - 1].replace(/\s+/g, " ").slice(0, 180);
			let percent = null;
			for (let i = lines.length - 1; i >= 0 && i >= Math.max(0, lines.length - 40); i -= 1) {
				const line = lines[i];
				const direct = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
				if (direct !== null) {
					const value = Number.parseFloat(direct[1]);
					if (value >= 0 && value <= 100) {
						percent = value;
						break;
					}
				}
				// curl's default meter prints the total percentage as a bare first column.
				const table = line.match(/^\s*(\d{1,3})\s+\d+(?:\.\d+)?\s*[KMGT]?\s+\d{1,3}\s+\d+(?:\.\d+)?\s*[KMGT]?/i);
				if (table !== null) {
					const value = Number.parseInt(table[1], 10);
					if (value >= 0 && value <= 100) {
						percent = value;
						break;
					}
				}
			}
			const speed = clean.match(/([\d.]+\s*(?:[KMGT]i?B|[KMGT]?B)\s*\/\s*s)/i);
			const eta = clean.match(/(?:eta|ETA)\s*([0-9]+(?::[0-9]{2}){1,2}|[0-9]+[hms](?:\s*[0-9]+[ms])?)/);
			const ratio = clean.match(/([\d.]+\s*(?:[KMGT]i?B|[KMGT]?B))\s*\/\s*([\d.]+\s*(?:[KMGT]i?B|[KMGT]?B))/i);
			return {
				percent,
				line: tail,
				speed: speed === null ? null : speed[1].replace(/\s+/g, " ").replace(/\s*\/\s*/, "/"),
				eta: eta === null ? null : eta[1],
				bytes: ratio === null ? null : `${ratio[1].replace(/\s+/g, " ")} / ${ratio[2].replace(/\s+/g, " ")}`
			};
		}
		//#endregion

		//#region helpers
		/** `m:ss` / `h:mm:ss` elapsed label. */
		function formatElapsed(ms) {
			const total = Math.max(0, Math.floor(ms / 1000));
			const seconds = total % 60;
			const minutes = Math.floor(total / 60) % 60;
			const hours = Math.floor(total / 3600);
			if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
			return `${minutes}:${String(seconds).padStart(2, "0")}`;
		}

		/** True while the job can still produce output. */
		function isLive(job) {
			return job.status === "running" || job.status === "stopping";
		}

		/** Status label for the row tooltip. */
		function statusLabel(status, t) {
			return t(`status.${status}`);
		}

		/** One-second clock that only runs while the card is mounted. */
		function useNow(active) {
			const [now, setNow] = React.useState(() => Date.now());
			React.useEffect(() => {
				if (!active) return undefined;
				const timer = setInterval(() => setNow(Date.now()), 1000);
				return () => clearInterval(timer);
			}, [active]);
			return now;
		}

		/** Keep a number inside [min, max]; a zero-size viewport collapses to min. */
		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), Math.max(min, max));
		}

		/** Read the parked position, or null for the default bottom-right corner. */
		function readSavedPosition() {
			try {
				const raw = window.localStorage.getItem(POSITION_KEY);
				if (raw === null) return null;
				const parsed = JSON.parse(raw);
				if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return { x: parsed.x, y: parsed.y };
			} catch {
				// Corrupt or unavailable storage falls back to the default corner.
			}
			return null;
		}

		/** Persist the parked position; failures are non-fatal. */
		function savePosition(position) {
			try {
				window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
			} catch {
				// Private mode: the card still drags, it just forgets after a reload.
			}
		}

		/**
		 * Pointer drag for a fixed-position element: press anywhere on the handle,
		 * move past a small threshold, and the element follows; a press that never
		 * crosses the threshold counts as a tap. The position is clamped to the
		 * viewport and persisted after a drag.
		 * @param ref - the element being moved.
		 * @param onTap - runs for a press that did not turn into a drag.
		 */
		function useDraggable(ref) {
			const [position, setPositionState] = React.useState(readSavedPosition);
			const [dragging, setDragging] = React.useState(false);
			const positionRef = React.useRef(position);
			const dragRef = React.useRef(null);
			const movedRef = React.useRef(false);
			const setPosition = React.useCallback((next) => {
				positionRef.current = next;
				setPositionState(next);
			}, []);
			React.useEffect(() => {
				const onResize = () => {
					const current = positionRef.current;
					const element = ref.current;
					if (current === null || element === null) return;
					setPosition({
						x: clamp(current.x, 0, window.innerWidth - element.offsetWidth),
						y: clamp(current.y, 0, window.innerHeight - element.offsetHeight)
					});
				};
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, [ref, setPosition]);
			const consumeDrag = React.useCallback(() => {
				if (!movedRef.current) return false;
				movedRef.current = false;
				return true;
			}, []);
			return {
				position,
				dragging,
				consumeDrag,
				handlers: {
					onPointerDown(event) {
						if (event.button !== undefined && event.button !== 0) return;
						const element = ref.current;
						if (element === null) return;
						const rect = element.getBoundingClientRect();
						dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, x: event.clientX, y: event.clientY };
						movedRef.current = false;
						element.setPointerCapture?.(event.pointerId);
						setDragging(true);
					},
					onPointerMove(event) {
						const drag = dragRef.current;
						if (drag === null) return;
						if (!movedRef.current && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < DRAG_THRESHOLD) return;
						movedRef.current = true;
						const element = ref.current;
						if (element === null) return;
						setPosition({
							x: clamp(event.clientX - drag.dx, 0, window.innerWidth - (element.offsetWidth || 340)),
							y: clamp(event.clientY - drag.dy, 0, window.innerHeight - (element.offsetHeight || 120))
						});
					},
					onPointerUp(event) {
						const drag = dragRef.current;
						dragRef.current = null;
						setDragging(false);
						ref.current?.releasePointerCapture?.(event.pointerId);
						if (drag === null) return;
						if (movedRef.current && positionRef.current !== null) savePosition(positionRef.current);
					},
					onPointerCancel() {
						dragRef.current = null;
						setDragging(false);
					}
				}
			};
		}
		//#endregion

		//#region components
		/**
		 * One job row. Mounting it starts the job's output observation (ref-counted
		 * by `ctx.jobs`), unmounting releases it.
		 * @param props.job - the roster row.
		 * @param props.view - the observed output view, when one has arrived.
		 * @param props.observe - starts the observation; returns its release.
		 * @param props.now - the ticking clock.
		 * @param props.t - locale lookup.
		 */
		function JobRow({ job, view, now, t }) {
			const parsed = React.useMemo(() => parseProgress(view?.text ?? ""), [view?.text]);
			const progressText = typeof job.progress === "string" && job.progress !== "" ? job.progress : null;
			const numeric = React.useMemo(() => {
				if (progressText !== null) {
					const match = progressText.match(/(\d{1,3}(?:\.\d+)?)/);
					return match === null ? null : Number.parseFloat(match[1]);
				}
				return parsed.percent;
			}, [progressText, parsed.percent]);
			const label = progressText ?? (numeric === null ? null : `${Math.round(numeric)}%`);
			const live = isLive(job);
			const elapsed = formatElapsed((job.finishedAt ?? now) - job.startedAt);
			const tail = parsed.line !== "" ? parsed.line : t("waiting");
			return jsxs("div", {
				className: "djp-row",
				title: `${statusLabel(job.status, t)} · ${elapsed}`,
				children: [
					jsxs("div", {
						className: "djp-line1",
						children: [
							jsx("span", { className: "djp-dot", "data-status": job.status }),
							jsx("span", { className: "djp-label", children: job.label }),
							label === null ? null : jsx("span", { className: "djp-pct", children: label }),
							jsx("span", { className: "djp-time", children: elapsed })
						]
					}),
					jsx("div", {
						className: "djp-bar",
						"data-indeterminate": numeric === null && live ? "true" : "false",
						children: jsx("div", { className: "djp-fill", style: numeric === null ? undefined : { width: `${Math.max(0, Math.min(100, numeric))}%` } })
					}),
					jsx("div", { className: "djp-tail", children: parsed.eta !== null ? `${tail} · ${t("eta", { eta: parsed.eta })}` : tail })
				]
			});
		}

		/**
		 * The floating card. Lives in the session header slot only for its
		 * `sessionId`; it renders through a portal on `document.body` so it is not
		 * clipped by the header or the conversation column.
		 * @param props.sessionId - the current session.
		 * @param props.useJobs - the jobs store hook.
		 * @param props.watchRows - keeps the session roster stream open.
		 * @param props.observe - starts one job's output observation.
		 * @param props.t - locale lookup.
		 */
		function JobProgressCard({ sessionId, useJobs, watchRows, observe, t }) {
			const jobs = useJobs((state) => state.rows[sessionId]) ?? NO_JOBS;
			const observed = useJobs((state) => state.observed);
			const [collapsed, setCollapsed] = React.useState(false);
			const panelRef = React.useRef(null);
			const { position, dragging, consumeDrag, handlers } = useDraggable(panelRef);
			const positionStyle = position === null ? undefined : { left: `${position.x}px`, top: `${position.y}px`, right: "auto", bottom: "auto" };
			React.useEffect(() => watchRows(sessionId), [sessionId, watchRows]);
			const now = useNow(jobs.length > 0);
			const liveIds = React.useMemo(
				() =>
					jobs
						.filter(isLive)
						.sort((left, right) => left.startedAt - right.startedAt)
						.slice(0, MAX_ROWS)
						.map((job) => String(job.id))
						.join("|"),
				[jobs]
			);
			React.useEffect(() => {
				if (liveIds === "") return undefined;
				const releases = liveIds.split("|").map((id) => observe(sessionId, id));
				return () => {
					for (const release of releases) release();
				};
			}, [sessionId, observe, liveIds]);
			const rows = React.useMemo(() => {
				const live = [];
				const settled = [];
				for (const job of jobs) {
					if (isLive(job)) live.push(job);
					else if ((job.finishedAt ?? job.startedAt) + LINGER_MS > Date.now()) settled.push(job);
				}
				settled.sort((left, right) => (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt));
				live.sort((left, right) => left.startedAt - right.startedAt);
				return [...live, ...settled];
			}, [jobs, now]);
			if (rows.length === 0) return null;
			const shown = rows.slice(0, MAX_ROWS);
			const hidden = rows.length - shown.length;
			const livePercent = rows.filter((job) => isLive(job)).map((job) => {
				const parsed = parseProgress(observed[String(job.id)]?.text ?? "");
				return typeof parsed.percent === "number" ? parsed.percent : null;
			});
			const known = livePercent.filter((value) => value !== null);
			const average = known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
			const header = jsxs("div", {
				className: "djp-head",
				role: "button",
				tabIndex: 0,
				"aria-expanded": !collapsed,
				"aria-label": collapsed ? t("expand") : t("collapse"),
				...handlers,
				onClick: () => {
					if (consumeDrag()) return;
					setCollapsed((value) => !value);
				},
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						setCollapsed((value) => !value);
					}
				},
				children: [
					jsx("span", { className: "djp-title", children: t("title") }),
					jsx("span", { className: "djp-count", children: t("count", { n: rows.length }) }),
					jsx("span", { className: "djp-chevron", children: collapsed ? jsx(IconChevronUpOutlineRegular, { size: 12 }) : jsx(IconChevronDownOutlineRegular, { size: 12 }) })
				]
			});
			if (collapsed) {
				return createPortal(jsxs("button", {
					type: "button",
					ref: panelRef,
					className: "djp-pill",
					...handlers,
					style: positionStyle,
					onClick: () => {
						if (consumeDrag()) return;
						setCollapsed(false);
					},
					title: t("expand"),
					children: [
						jsx("span", { children: `${t("title")} ${t("count", { n: rows.length })}` }),
						jsx("span", {
							className: "djp-pill-bar",
							children: jsx("span", { className: "djp-pill-fill", style: { width: `${average === null ? 30 : Math.round(average)}%` } })
						}),
						average === null ? null : jsx("span", { children: `${Math.round(average)}%` })
					]
				}), document.body);
			}
			return createPortal(jsxs("div", {
				ref: panelRef,
				className: "djp-card",
				"data-dragging": dragging ? "true" : "false",
				style: positionStyle,
				children: [
					header,
					jsxs("div", {
						className: "djp-body",
						children: [
							...shown.map((job) => jsx(JobRow, {
								job,
								view: observed[String(job.id)],
								now,
								t
							}, String(job.id))),
							hidden > 0 ? jsx("div", { className: "djp-more", children: t("more", { n: hidden }) }) : null
						]
					})
				]
			}), document.body);
		}
		//#endregion

		//#region plugin body
		/**
		 * Register dictionaries, the card styles and the session header mount point.
		 * @param ctx - client root context carrying jobs, slots and locale.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "job-progress: dictionaries");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-job-progress";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, "job-progress: styles");
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: "job-progress.card",
						order: 21,
						locale: NS,
						inject: () => ({
							hooks: { jobs: ctx.jobs.state },
							watchRows: (sessionId) => ctx.jobs.watchRows(sessionId),
							observe: (sessionId, id) => ctx.jobs.observe(sessionId, id)
						})
					},
					JobProgressCard
				)
			);
		}

		/** Services this plugin needs before it can register its UI. */
		const inject = ["jobs", "slots", "locale"];
		if (window.__DSH_JOB_PROGRESS_DEBUG__ === true) window.__dshJobProgress = { parseProgress, clamp };
		return { inject, apply };
	}
});
//#endregion
