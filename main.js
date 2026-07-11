"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  VIEW_TYPE_HEATMAP: () => VIEW_TYPE_HEATMAP,
  default: () => VaultActivityHeatmapPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian11 = require("obsidian");

// src/defaults.ts
var VIEW_TYPE_HEATMAP = "vault-activity-heatmap";
var LOCAL_STATE_KEY = "vault-activity-heatmap-device-v1";
var LOCAL_SHARD_KEY_PREFIX = "vault-activity-heatmap-shard-v2:";
var DEFAULT_AI_SECRET_ID = "vault-activity-heatmap-ai-api-key";
var DEFAULT_NOTIFY_SECRET_ID = "vault-activity-heatmap-notification-webhook";
var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
var DEFAULT_SETTINGS = {
  baseColor: "#40c463",
  emptyColor: "",
  metric: "files",
  thresholds: [1, 3, 6, 10],
  weeksToShow: 26,
  excludeFolders: [],
  firstDayOfWeek: 1,
  lastFolderFilter: "",
  reflectionFolder: "Daily reflection",
  dailyNoteFormat: "YYYY-MM-DD",
  taskHeading: "## Tasks",
  sessionGapMinutes: 15,
  showTasks: true,
  showTimeline: true,
  notesPathDisplay: "name",
  backdropPath: "",
  backdropDim: 0.45,
  backdropBlur: 0,
  panelTextColor: "",
  panelBgColor: "",
  aiProvider: "anthropic",
  aiSecretId: DEFAULT_AI_SECRET_ID,
  aiModel: "",
  aiBaseUrl: "",
  aiSummaryFolder: "AI summaries",
  aiAutoWeekly: false,
  aiAutoMonthly: false,
  aiLastWeekly: "",
  aiLastMonthly: "",
  notifyDesktop: true,
  notifySecretId: DEFAULT_NOTIFY_SECRET_ID
};

// src/services/activity.ts
var import_obsidian2 = require("obsidian");

// src/utils/date.ts
var import_obsidian = require("obsidian");
var momentFn = import_obsidian.moment;
function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfToday() {
  const d = /* @__PURE__ */ new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekStartOf(date, firstDayOfWeek) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() - firstDayOfWeek + 7) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}
function formatClockTime(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function formatByteDelta(delta) {
  const sign = delta > 0 ? "+" : "-";
  const abs = Math.abs(delta);
  return sign + (abs < 1024 ? `${abs} B` : `${(abs / 1024).toFixed(1)} KB`);
}

// src/utils/path.ts
function isUnderFolder(path, folder) {
  if (!folder) return true;
  return path.startsWith(folder + "/");
}
function notePathLabels(paths, mode) {
  const stripExt = (p) => p.replace(/\.md$/, "");
  if (mode === "full") return paths.map(stripExt);
  const segs = paths.map((p) => stripExt(p).split("/"));
  const suffix = (parts, take) => parts.slice(Math.max(0, parts.length - take)).join("/");
  return segs.map((parts, idx) => {
    for (let take = 1; take <= parts.length; take++) {
      const label = suffix(parts, take);
      const unique = segs.every(
        (other, j) => j === idx || suffix(other, take) !== label
      );
      if (unique || take === parts.length) return label;
    }
    return parts.join("/");
  });
}

// src/services/activity.ts
var EDIT_IDLE_MS = 1200;
var EDIT_MAX_MS = 5e3;
var ActivityService = class {
  constructor(plugin) {
    this.plugin = plugin;
    /** Last known file sizes, for timeline byte deltas. */
    this.lastSizes = /* @__PURE__ */ new Map();
    this.pendingEditorChanges = /* @__PURE__ */ new Map();
    this.suppressEditorUntil = /* @__PURE__ */ new Map();
    this.refreshViews = (0, import_obsidian2.debounce)(() => this.plugin.renderAllViews(), 600, true);
  }
  primeLastSizes() {
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      this.lastSizes.set(f.path, f.stat.size);
    }
  }
  recordEditorChange(file, text) {
    if (!this.isTracked(file)) return;
    const textSize = new TextEncoder().encode(text).byteLength;
    if ((this.suppressEditorUntil.get(file.path) ?? 0) > Date.now()) {
      this.lastSizes.set(file.path, textSize);
      return;
    }
    this.suppressEditorUntil.delete(file.path);
    const now = Date.now();
    const existing = this.pendingEditorChanges.get(file.path);
    if (existing) {
      window.clearTimeout(existing.timer);
      existing.file = file;
      existing.text = text;
      if (now - existing.startedAt >= EDIT_MAX_MS) {
        this.flushEditorChange(file.path);
        return;
      }
      existing.timer = window.setTimeout(
        () => this.flushEditorChange(file.path),
        EDIT_IDLE_MS
      );
      return;
    }
    this.pendingEditorChanges.set(file.path, {
      file,
      text,
      startedAt: now,
      timer: window.setTimeout(() => this.flushEditorChange(file.path), EDIT_IDLE_MS)
    });
  }
  beginLocalMutation(file) {
    if (this.pendingEditorChanges.has(file.path)) {
      this.flushEditorChange(file.path);
    }
    this.suppressEditorUntil.set(file.path, Date.now() + 750);
  }
  recordLocalMutation(file, isCreate, content) {
    this.beginLocalMutation(file);
    this.recordActivity(
      file,
      isCreate,
      new TextEncoder().encode(content).byteLength
    );
  }
  flushEditorChange(path) {
    const pending = this.pendingEditorChanges.get(path);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    this.pendingEditorChanges.delete(path);
    const isCreate = !this.lastSizes.has(path) && Date.now() - pending.file.stat.ctime < 3e4;
    const size = new TextEncoder().encode(pending.text).byteLength;
    this.recordActivity(pending.file, isCreate, size);
  }
  stop() {
    for (const path of [...this.pendingEditorChanges.keys()]) {
      this.flushEditorChange(path);
    }
    this.suppressEditorUntil.clear();
  }
  isTracked(file) {
    if (!(file instanceof import_obsidian2.TFile) || file.extension !== "md") return false;
    for (const folder of this.plugin.settings.excludeFolders) {
      if (folder && isUnderFolder(file.path, folder)) return false;
    }
    return true;
  }
  recordActivity(file, isCreate = false, sizeOverride) {
    if (!this.isTracked(file)) return;
    const now = Date.now();
    const key = toDateKey(/* @__PURE__ */ new Date());
    const days = this.plugin.sync.getLocalShard().days;
    const day = days[key] ?? (days[key] = { edits: 0, files: {} });
    day.edits += 1;
    day.files[file.path] = (day.files[file.path] ?? 0) + 1;
    const newSize = sizeOverride ?? file.stat.size;
    const prevSize = this.lastSizes.get(file.path);
    const delta = prevSize === void 0 ? isCreate ? newSize : 0 : newSize - prevSize;
    this.lastSizes.set(file.path, newSize);
    const sessions = day.sessions ?? (day.sessions = []);
    const gapMs = Math.max(1, this.plugin.settings.sessionGapMinutes) * 6e4;
    let last;
    for (let i = sessions.length - 1; i >= 0; i--) {
      const session = sessions[i];
      if (session?.f === file.path) {
        last = session;
        break;
      }
    }
    if (last && !isCreate && now - last.e <= gapMs) {
      last.e = now;
      last.n += 1;
      last.d += delta;
    } else if (sessions.length < 300) {
      const rec = { f: file.path, s: now, e: now, n: 1, d: delta };
      if (isCreate) rec.k = "create";
      sessions.push(rec);
    } else if (last) {
      last.e = now;
      last.n += 1;
      last.d += delta;
    }
    this.plugin.sync.touchActivity();
    this.refreshViews();
  }
  /** Keep history consistent when files are renamed or moved. */
  migratePath(file, oldPath) {
    if (file instanceof import_obsidian2.TFolder) {
      this.plugin.sync.setPathAlias(`${oldPath.replace(/\/$/, "")}/`, `${file.path}/`);
      return;
    }
    if (file instanceof import_obsidian2.TFile) {
      const suppressedUntil = this.suppressEditorUntil.get(oldPath);
      if (suppressedUntil !== void 0) {
        this.suppressEditorUntil.delete(oldPath);
        this.suppressEditorUntil.set(file.path, suppressedUntil);
      }
      const pending = this.pendingEditorChanges.get(oldPath);
      if (pending) {
        window.clearTimeout(pending.timer);
        this.pendingEditorChanges.delete(oldPath);
        pending.file = file;
        pending.timer = window.setTimeout(
          () => this.flushEditorChange(file.path),
          EDIT_IDLE_MS
        );
        this.pendingEditorChanges.set(file.path, pending);
      }
      const size = this.lastSizes.get(oldPath);
      if (size !== void 0) {
        this.lastSizes.delete(oldPath);
        this.lastSizes.set(file.path, size);
      }
      this.plugin.sync.setPathAlias(oldPath, file.path);
    }
  }
  /**
   * Seed history from file created/modified timestamps so the heatmap is not
   * empty on first install. Each file counts once on its creation day and
   * once on its last-modified day.
   */
  backfillFromFileStats() {
    const files = this.plugin.app.vault.getMarkdownFiles();
    const days = this.plugin.sync.getLocalShard().days;
    let added = 0;
    for (const file of files) {
      if (!this.isTracked(file)) continue;
      const stamps = /* @__PURE__ */ new Set([
        toDateKey(new Date(file.stat.ctime)),
        toDateKey(new Date(file.stat.mtime))
      ]);
      for (const key of stamps) {
        const day = days[key] ?? (days[key] = { edits: 0, files: {} });
        const aggregateDay = this.plugin.activity.days[key];
        if (day.files[file.path] === void 0 && aggregateDay?.files[file.path] === void 0) {
          day.files[file.path] = 1;
          day.edits += 1;
          added += 1;
        }
      }
    }
    if (added > 0) this.plugin.sync.touchActivity();
    this.refreshViews();
    new import_obsidian2.Notice(
      added > 0 ? `Heatmap: backfilled ${added} activity entries from ${files.length} notes.` : "Heatmap: nothing new to backfill."
    );
  }
  clearHistory() {
    this.plugin.sync.clearActivity();
    new import_obsidian2.Notice("Heatmap history cleared.");
  }
  /** Activity count for one day under an optional folder filter. */
  countForDay(key, folder) {
    const day = this.plugin.activity.days[key];
    if (!day) return 0;
    if (!folder) {
      return this.plugin.settings.metric === "edits" ? day.edits : Object.keys(day.files).length;
    }
    let files = 0;
    let edits = 0;
    for (const [path, n] of Object.entries(day.files)) {
      if (isUnderFolder(path, folder)) {
        files += 1;
        edits += n;
      }
    }
    return this.plugin.settings.metric === "edits" ? edits : files;
  }
  filesForDay(key, folder) {
    const day = this.plugin.activity.days[key];
    if (!day) return [];
    return Object.entries(day.files).filter(([path]) => isUnderFolder(path, folder)).sort((a, b) => b[1] - a[1]);
  }
  intensityLevel(count) {
    if (count <= 0) return 0;
    const [, level2 = 3, level3 = 6, level4 = 10] = this.plugin.settings.thresholds;
    if (count >= level4) return 4;
    if (count >= level3) return 3;
    if (count >= level2) return 2;
    return 1;
  }
  allFolderPaths() {
    const out = [];
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof import_obsidian2.TFolder) {
          out.push(child.path);
          walk(child);
        }
      }
    };
    walk(this.plugin.app.vault.getRoot());
    return out.sort((a, b) => a.localeCompare(b));
  }
};

// src/services/ai-summary.ts
var import_obsidian3 = require("obsidian");
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function getArrayProp(value, key) {
  const prop = value[key];
  return Array.isArray(prop) ? prop : [];
}
function parseAnthropicResponse(value) {
  if (!isRecord(value)) return "";
  return getArrayProp(value, "content").map(
    (block) => isRecord(block) && typeof block.text === "string" ? block.text : ""
  ).join("");
}
function parseOpenAiResponse(value) {
  if (!isRecord(value)) return "";
  const first = getArrayProp(value, "choices")[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  return typeof first.message.content === "string" ? first.message.content : "";
}
function versionedApiUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${/\/v1$/i.test(base) ? "" : "/v1"}/${path}`;
}
var AiSummaryService = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.aiRunning = false;
  }
  /** Summarize completed periods that have not been summarized yet. */
  async maybeAutoSummarize() {
    if (!this.plugin.isAutomationDevice() || !this.plugin.getAiApiKey()) return;
    const today = startOfToday();
    if (this.plugin.settings.aiAutoWeekly) {
      const thisWeekStart = weekStartOf(today, this.plugin.settings.firstDayOfWeek);
      const prevStart = new Date(thisWeekStart);
      prevStart.setDate(prevStart.getDate() - 7);
      const prevKey = toDateKey(prevStart);
      if (this.plugin.settings.aiLastWeekly !== prevKey) {
        const prevEnd = new Date(thisWeekStart);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const result = await this.summarizePeriod(
          prevKey,
          toDateKey(prevEnd),
          "Weekly",
          `Weekly summary ${prevKey}`
        );
        if (result === "completed" || result === "no-activity") {
          this.plugin.settings.aiLastWeekly = prevKey;
          this.plugin.saveSettings();
        }
      }
    }
    if (this.plugin.settings.aiAutoMonthly) {
      const y = today.getFullYear();
      const m = today.getMonth();
      const prevId = m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
      if (this.plugin.settings.aiLastMonthly !== prevId) {
        const lastDayPrev = new Date(y, m, 0);
        const result = await this.summarizePeriod(
          `${prevId}-01`,
          toDateKey(lastDayPrev),
          "Monthly",
          `Monthly summary ${prevId}`
        );
        if (result === "completed" || result === "no-activity") {
          this.plugin.settings.aiLastMonthly = prevId;
          this.plugin.saveSettings();
        }
      }
    }
  }
  async summarizePeriod(startKey, endKey, label, noteName) {
    if (!this.plugin.getAiApiKey()) {
      new import_obsidian3.Notice("Heatmap: set an AI API key in the plugin settings first.");
      return "missing-key";
    }
    if (this.aiRunning) {
      new import_obsidian3.Notice("Heatmap: a summary is already being generated.");
      return "busy";
    }
    this.aiRunning = true;
    new import_obsidian3.Notice(`Heatmap: generating ${label.toLowerCase()} summary...`);
    try {
      const material = await this.collectPeriodMaterial(startKey, endKey);
      if (material.fileCount === 0) {
        new import_obsidian3.Notice(`Heatmap: no recorded activity between ${startKey} and ${endKey}.`);
        return "no-activity";
      }
      const prompt = [
        `You are summarizing the writing activity of a personal Obsidian vault for the period ${startKey} to ${endKey}.`,
        `Activity: ${material.fileCount} notes edited across ${material.activeDays} active days, ${material.totalEdits} edits in total.`,
        `Write a concise markdown summary with the sections **Overview**, **Main themes**, **Progress**, and **Suggested focus for the next period**. Keep it under 300 words. Respond in the language most of the notes are written in (they may be English, Chinese, or mixed).`,
        `Excerpts of the edited notes follow, each preceded by its path and edit count:`,
        ...material.excerpts
      ].join("\n\n");
      const summary = await this.callModel(prompt);
      const path = await this.writeSummaryNote(
        noteName,
        label,
        startKey,
        endKey,
        summary,
        material
      );
      await this.plugin.notifications.notifyAll(
        `${label} writing summary ready`,
        summary.trim().split("\n").slice(0, 4).join(" ").slice(0, 300)
      );
      new import_obsidian3.Notice(`Heatmap: ${label.toLowerCase()} summary saved to ${path}`);
      return "completed";
    } catch (e) {
      console.error("vault-activity-heatmap: summary failed", e);
      new import_obsidian3.Notice(
        `Heatmap: summary failed - ${e instanceof Error ? e.message : String(e)}`
      );
      return "failed";
    } finally {
      this.aiRunning = false;
    }
  }
  async collectPeriodMaterial(startKey, endKey) {
    const perFile = /* @__PURE__ */ new Map();
    let totalEdits = 0;
    let activeDays = 0;
    for (const [key, day] of Object.entries(this.plugin.activity.days)) {
      if (key < startKey || key > endKey) continue;
      let dayEdits = 0;
      for (const [path, n] of Object.entries(day.files)) {
        perFile.set(path, (perFile.get(path) ?? 0) + n);
        dayEdits += n;
      }
      if (dayEdits > 0) activeDays += 1;
      totalEdits += dayEdits;
    }
    const ranked = [...perFile.entries()].sort((a, b) => b[1] - a[1]);
    const excerpts = [];
    let budget = 6e4;
    for (const [path, edits] of ranked.slice(0, 30)) {
      if (budget <= 0) break;
      const f = this.plugin.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof import_obsidian3.TFile)) continue;
      let text;
      try {
        text = await this.plugin.app.vault.cachedRead(f);
      } catch {
        continue;
      }
      const excerpt = text.slice(0, Math.min(3e3, budget));
      budget -= excerpt.length;
      excerpts.push(`--- ${path} (${edits} edits) ---
${excerpt}`);
    }
    return { fileCount: perFile.size, totalEdits, activeDays, excerpts };
  }
  async callModel(prompt) {
    const s = this.plugin.settings;
    const apiKey = this.plugin.getAiApiKey();
    if (s.aiProvider === "anthropic") {
      const base2 = (s.aiBaseUrl.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
      const res2 = await (0, import_obsidian3.requestUrl)({
        url: versionedApiUrl(base2, "messages"),
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: s.aiModel.trim() || "claude-sonnet-5",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }]
        }),
        throw: false
      });
      if (res2.status >= 300) {
        throw new Error(`API error ${res2.status}: ${res2.text.slice(0, 200)}`);
      }
      const text2 = parseAnthropicResponse(res2.json);
      if (!text2.trim()) throw new Error("the model returned an empty response");
      return text2;
    }
    const base = (s.aiBaseUrl.trim() || "https://api.openai.com").replace(/\/+$/, "");
    const res = await (0, import_obsidian3.requestUrl)({
      url: versionedApiUrl(base, "chat/completions"),
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: s.aiModel.trim() || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      }),
      throw: false
    });
    if (res.status >= 300) {
      throw new Error(`API error ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const text = parseOpenAiResponse(res.json);
    if (!text.trim()) throw new Error("the model returned an empty response");
    return text;
  }
  async writeSummaryNote(noteName, label, startKey, endKey, summary, m) {
    const folder = (this.plugin.settings.aiSummaryFolder.trim() || "AI summaries").replace(
      /^\/+|\/+$/g,
      ""
    );
    await this.plugin.dailyNotes.ensureFolder(folder);
    const path = `${folder}/${noteName}.md`;
    const content = `# ${label} summary - ${startKey} -> ${endKey}

${summary.trim()}

---
*${m.fileCount} notes | ${m.totalEdits} edits | ${m.activeDays} active days | generated ${(/* @__PURE__ */ new Date()).toLocaleString()}*
`;
    const existing = this.plugin.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian3.TFile) {
      await this.plugin.app.vault.modify(existing, content);
    } else {
      await this.plugin.app.vault.create(path, content);
    }
    return path;
  }
};

// src/services/daily-notes.ts
var import_obsidian4 = require("obsidian");

// src/utils/markdown.ts
function normalizeHeadingText(text) {
  return text.replace(/\s+#+\s*$/, "").trim().toLowerCase();
}
function nonHeadingLines(lines) {
  const ignored = new Array(lines.length).fill(false);
  let start = 0;
  if (lines[0]?.trim() === "---") {
    let close = -1;
    for (let j = 1; j < lines.length; j++) {
      const t = lines[j]?.trim() ?? "";
      if (t === "---" || t === "...") {
        close = j;
        break;
      }
    }
    if (close !== -1) {
      for (let j = 0; j <= close; j++) ignored[j] = true;
      start = close + 1;
    }
  }
  let fenceChar = "";
  let fenceLen = 0;
  for (let i = start; i < lines.length; i++) {
    const t = lines[i]?.trimStart() ?? "";
    if (fenceChar) {
      ignored[i] = true;
      const m = t.match(/^(`{3,}|~{3,})\s*$/);
      const fence = m?.[1];
      if (fence?.[0] === fenceChar && fence.length >= fenceLen) fenceChar = "";
    } else {
      const m = t.match(/^(`{3,}|~{3,})/);
      const fence = m?.[1];
      if (fence?.[0]) {
        fenceChar = fence[0];
        fenceLen = fence.length;
        ignored[i] = true;
      }
    }
  }
  return ignored;
}
function insertUnderHeading(content, heading, line) {
  const h = heading.trim();
  if (!h) {
    const trimmed = content.replace(/\s+$/, "");
    return (trimmed ? trimmed + "\n" : "") + line + "\n";
  }
  const headingText = normalizeHeadingText(h.replace(/^#+\s*/, ""));
  const headingLine = h.startsWith("#") ? h : "## " + h;
  const lines = content.split("\n");
  const skip = nonHeadingLines(lines);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (skip[i]) continue;
    const m = lines[i]?.match(/^#{1,6}\s+(.*)$/);
    const text = m?.[1];
    if (text !== void 0 && normalizeHeadingText(text) === headingText) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    const trimmed = content.replace(/\s+$/, "");
    return (trimmed ? trimmed + "\n\n" : "") + headingLine + "\n" + line + "\n";
  }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (skip[i]) continue;
    if (/^#{1,6}\s/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > idx + 1 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--;
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

// src/services/daily-notes.ts
var DailyNotesService = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  dailyNotePath(dateKey) {
    const fmt = this.plugin.settings.dailyNoteFormat.trim() || "YYYY-MM-DD";
    const name = momentFn(dateKey, "YYYY-MM-DD").format(fmt);
    const folder = this.plugin.settings.reflectionFolder.trim().replace(/^\/+|\/+$/g, "");
    return (folder ? folder + "/" : "") + name + ".md";
  }
  async ensureFolder(folderPath) {
    if (!folderPath) return;
    const parts = folderPath.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? current + "/" + part : part;
      if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
        try {
          await this.plugin.app.vault.createFolder(current);
        } catch {
        }
      }
    }
  }
  headingLine() {
    const h = this.plugin.settings.taskHeading.trim();
    if (!h) return "";
    return h.startsWith("#") ? h : "## " + h;
  }
  /** Get the reflection note for a date, creating folder + note if needed. */
  async getOrCreateDailyNote(dateKey) {
    const path = this.dailyNotePath(dateKey);
    const existing = this.plugin.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian4.TFile) return { file: existing, created: false };
    if (existing) {
      new import_obsidian4.Notice(`Heatmap: "${path}" exists but is not a note.`);
      return null;
    }
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    await this.ensureFolder(dir);
    const heading = this.headingLine();
    try {
      const file = await this.plugin.app.vault.create(
        path,
        heading ? heading + "\n" : ""
      );
      return { file, created: true };
    } catch (e) {
      new import_obsidian4.Notice(`Heatmap: could not create "${path}".`);
      console.error("vault-activity-heatmap: create failed", e);
      return null;
    }
  }
  async addTaskToDailyReflection(dateKey, taskText) {
    const result = await this.getOrCreateDailyNote(dateKey);
    if (!result) return;
    const { file, created } = result;
    const taskLine = `- [ ] ${taskText}`;
    this.plugin.activityService.beginLocalMutation(file);
    const content = await this.plugin.app.vault.process(
      file,
      (content2) => insertUnderHeading(content2, this.plugin.settings.taskHeading, taskLine)
    );
    this.plugin.activityService.recordLocalMutation(file, created, content);
    new import_obsidian4.Notice(`Task added to ${file.path}`);
  }
  async openDailyReflection(dateKey) {
    const result = await this.getOrCreateDailyNote(dateKey);
    if (!result) return;
    const { file, created } = result;
    if (created) {
      const content = await this.plugin.app.vault.cachedRead(file);
      this.plugin.activityService.recordLocalMutation(file, true, content);
    }
    await this.plugin.app.workspace.getLeaf(false).openFile(file);
  }
  /** Parse the checkbox tasks of a day's reflection note. */
  async readDailyTasks(dateKey) {
    const path = this.dailyNotePath(dateKey);
    const af = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(af instanceof import_obsidian4.TFile)) return { file: null, tasks: [] };
    const content = await this.plugin.app.vault.cachedRead(af);
    const lines = content.split("\n");
    const skip = nonHeadingLines(lines);
    const tasks = [];
    for (let i = 0; i < lines.length; i++) {
      if (skip[i]) continue;
      const line = lines[i];
      if (line === void 0) continue;
      const m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
      const marker = m?.[1];
      const text = m?.[2];
      if (marker !== void 0 && text !== void 0) {
        tasks.push({ line: i, raw: line, text, done: marker !== " " });
      }
    }
    return { file: af, tasks };
  }
  /** Check or uncheck a task line in a reflection note. */
  async toggleTask(file, task, done) {
    let changed = false;
    this.plugin.activityService.beginLocalMutation(file);
    const content = await this.plugin.app.vault.process(file, (content2) => {
      const lines = content2.split("\n");
      const i = lines[task.line] === task.raw ? task.line : lines.indexOf(task.raw);
      if (i === -1) return content2;
      const line = lines[i];
      if (line === void 0) return content2;
      const next = done ? line.replace(/^(\s*[-*]\s+)\[ \]/, "$1[x]") : line.replace(/^(\s*[-*]\s+)\[[xX]\]/, "$1[ ]");
      changed = next !== line;
      lines[i] = next;
      return lines.join("\n");
    });
    if (changed) this.plugin.activityService.recordLocalMutation(file, false, content);
  }
};

// src/services/notifications.ts
var import_obsidian5 = require("obsidian");
var NotificationService = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  async notifyAll(title, body) {
    if (this.plugin.settings.notifyDesktop) {
      if (import_obsidian5.Platform.isDesktopApp && typeof Notification !== "undefined") {
        try {
          new Notification(title, { body: body.slice(0, 180) });
        } catch (e) {
          console.error("vault-activity-heatmap: desktop notification failed", e);
        }
      } else if (import_obsidian5.Platform.isMobileApp) {
        new import_obsidian5.Notice(`${title}: ${body.slice(0, 180)}`);
      }
    }
    const hook = this.plugin.getNotificationWebhook().trim();
    if (hook) {
      try {
        if (import_obsidian5.Platform.isMobileApp && !/^https:\/\//i.test(hook)) {
          throw new Error("mobile webhook URLs must use HTTPS");
        }
        const response = await (0, import_obsidian5.requestUrl)({
          url: hook,
          method: "POST",
          body: `${title}
${body.slice(0, 800)}`,
          throw: false
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`webhook returned HTTP ${response.status}`);
        }
      } catch (e) {
        console.error("vault-activity-heatmap: webhook notification failed", e);
      }
    }
  }
};

// src/services/sync.ts
var import_obsidian6 = require("obsidian");

// src/services/sync-state.ts
var LEGACY_DEVICE_ID = "legacy-v1";
var LEGACY_EPOCH = "legacy-epoch";
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cloneSession(session) {
  const clone = {
    f: session.f,
    s: session.s,
    e: session.e,
    n: session.n,
    d: session.d
  };
  if (session.k) clone.k = session.k;
  if (session.v) clone.v = session.v;
  return clone;
}
function cloneDay(day) {
  const clone = {
    edits: day.edits,
    files: { ...day.files }
  };
  if (day.sessions) clone.sessions = day.sessions.map(cloneSession);
  return clone;
}
function cloneActivityShard(shard) {
  return { ...shard, days: cloneDays(shard.days) };
}
function cloneDays(days) {
  const clone = {};
  for (const [key, day] of Object.entries(days)) clone[key] = cloneDay(day);
  return clone;
}
function cloneVersioned(value, cloneValue) {
  return {
    value: cloneValue(value.value),
    stamp: { ...value.stamp }
  };
}
function sharedSettingsFrom(settings) {
  return {
    baseColor: settings.baseColor,
    emptyColor: settings.emptyColor,
    metric: settings.metric,
    thresholds: [...settings.thresholds],
    weeksToShow: settings.weeksToShow,
    excludeFolders: [...settings.excludeFolders],
    firstDayOfWeek: settings.firstDayOfWeek,
    reflectionFolder: settings.reflectionFolder,
    dailyNoteFormat: settings.dailyNoteFormat,
    taskHeading: settings.taskHeading,
    sessionGapMinutes: settings.sessionGapMinutes,
    showTasks: settings.showTasks,
    showTimeline: settings.showTimeline,
    notesPathDisplay: settings.notesPathDisplay,
    backdropPath: settings.backdropPath,
    backdropDim: settings.backdropDim,
    backdropBlur: settings.backdropBlur,
    panelTextColor: settings.panelTextColor,
    panelBgColor: settings.panelBgColor,
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    aiBaseUrl: settings.aiBaseUrl,
    aiSummaryFolder: settings.aiSummaryFolder,
    aiAutoWeekly: settings.aiAutoWeekly,
    aiAutoMonthly: settings.aiAutoMonthly,
    aiLastWeekly: settings.aiLastWeekly,
    aiLastMonthly: settings.aiLastMonthly
  };
}
function runtimeSettingsFrom(shared, local) {
  return {
    ...DEFAULT_SETTINGS,
    ...shared,
    thresholds: Array.isArray(shared.thresholds) ? [...shared.thresholds] : [...DEFAULT_SETTINGS.thresholds],
    excludeFolders: Array.isArray(shared.excludeFolders) ? [...shared.excludeFolders] : [...DEFAULT_SETTINGS.excludeFolders],
    lastFolderFilter: local.lastFolderFilter,
    notifyDesktop: local.notifyDesktop,
    aiSecretId: local.aiSecretId,
    notifySecretId: local.notifySecretId
  };
}
function stamp(clock, deviceId, updatedAt) {
  return { clock, deviceId, updatedAt };
}
function versioned(value, clock, deviceId, updatedAt) {
  return { value, stamp: stamp(clock, deviceId, updatedAt) };
}
function createInitialState(settings, deviceId, deviceName, selectedDay, now) {
  const epoch = `epoch-${deviceId}-${now}`;
  return {
    schemaVersion: 2,
    settings: versioned(sharedSettingsFrom(settings), 1, deviceId, now),
    activityEpoch: versioned(epoch, 1, deviceId, now),
    activityShards: {
      [deviceId]: {
        deviceId,
        deviceName,
        epoch,
        revision: 0,
        updatedAt: now,
        days: {}
      }
    },
    pathAliases: {},
    selectedDay: versioned(selectedDay, 1, deviceId, now),
    automationDeviceId: versioned("", 1, deviceId, now)
  };
}
function sanitizeSharedSettings(value) {
  const candidate = isRecord2(value) ? value : {};
  const stringValue = (key) => typeof candidate[key] === "string" ? candidate[key] : String(DEFAULT_SETTINGS[key]);
  const numberValue = (key) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]) ? candidate[key] : Number(DEFAULT_SETTINGS[key]);
  const booleanValue = (key) => typeof candidate[key] === "boolean" ? candidate[key] : Boolean(DEFAULT_SETTINGS[key]);
  const colorValue = (key) => {
    const value2 = stringValue(key).trim();
    if (value2 === "" && key !== "baseColor") return "";
    return /^#[0-9a-f]{6}$/i.test(value2) ? value2 : DEFAULT_SETTINGS[key];
  };
  const rawThresholds = Array.isArray(candidate.thresholds) ? candidate.thresholds.filter(
    (item) => typeof item === "number" && Number.isFinite(item) && item >= 0
  ) : [];
  const thresholds = rawThresholds.length === 4 && rawThresholds.every(
    (item, index) => index === 0 || item >= (rawThresholds[index - 1] ?? item)
  ) ? rawThresholds : [...DEFAULT_SETTINGS.thresholds];
  const runtime = {
    ...DEFAULT_SETTINGS,
    baseColor: colorValue("baseColor"),
    emptyColor: colorValue("emptyColor"),
    metric: candidate.metric === "edits" ? "edits" : "files",
    thresholds,
    weeksToShow: Math.max(4, Math.min(53, Math.round(numberValue("weeksToShow")))),
    excludeFolders: Array.isArray(candidate.excludeFolders) ? candidate.excludeFolders.filter((item) => typeof item === "string") : [...DEFAULT_SETTINGS.excludeFolders],
    firstDayOfWeek: numberValue("firstDayOfWeek") === 0 ? 0 : 1,
    reflectionFolder: stringValue("reflectionFolder"),
    dailyNoteFormat: stringValue("dailyNoteFormat"),
    taskHeading: stringValue("taskHeading"),
    sessionGapMinutes: Math.max(1, numberValue("sessionGapMinutes")),
    showTasks: booleanValue("showTasks"),
    showTimeline: booleanValue("showTimeline"),
    notesPathDisplay: candidate.notesPathDisplay === "full" ? "full" : "name",
    backdropPath: stringValue("backdropPath"),
    backdropDim: Math.max(0, Math.min(0.9, numberValue("backdropDim"))),
    backdropBlur: Math.max(0, Math.min(20, numberValue("backdropBlur"))),
    panelTextColor: colorValue("panelTextColor"),
    panelBgColor: colorValue("panelBgColor"),
    aiProvider: candidate.aiProvider === "openai" ? "openai" : "anthropic",
    aiModel: stringValue("aiModel"),
    aiBaseUrl: stringValue("aiBaseUrl"),
    aiSummaryFolder: stringValue("aiSummaryFolder"),
    aiAutoWeekly: booleanValue("aiAutoWeekly"),
    aiAutoMonthly: booleanValue("aiAutoMonthly"),
    aiLastWeekly: stringValue("aiLastWeekly"),
    aiLastMonthly: stringValue("aiLastMonthly")
  };
  return sharedSettingsFrom(runtime);
}
function sanitizeStamp(value, fallbackDeviceId) {
  if (!isRecord2(value)) return stamp(0, fallbackDeviceId, 0);
  return {
    clock: typeof value.clock === "number" && Number.isFinite(value.clock) ? Math.max(0, Math.floor(value.clock)) : 0,
    deviceId: typeof value.deviceId === "string" ? value.deviceId : fallbackDeviceId,
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0
  };
}
function sanitizeVersionedString(value, fallback, fallbackDeviceId) {
  if (!isRecord2(value)) return versioned(fallback, 0, fallbackDeviceId, 0);
  return {
    value: typeof value.value === "string" ? value.value : fallback,
    stamp: sanitizeStamp(value.stamp, fallbackDeviceId)
  };
}
function sanitizeDays(value) {
  if (!isRecord2(value)) return {};
  const days = {};
  for (const [key, rawDay] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isRecord2(rawDay) || !isRecord2(rawDay.files)) {
      continue;
    }
    const files = {};
    for (const [path, count] of Object.entries(rawDay.files)) {
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
        files[path] = count;
      }
    }
    const day = {
      edits: typeof rawDay.edits === "number" && Number.isFinite(rawDay.edits) && rawDay.edits >= 0 ? rawDay.edits : Object.values(files).reduce((sum, count) => sum + count, 0),
      files
    };
    if (Array.isArray(rawDay.sessions)) {
      day.sessions = rawDay.sessions.slice(0, 300).filter(isRecord2).filter(
        (session) => typeof session.f === "string" && typeof session.s === "number" && Number.isFinite(session.s) && typeof session.e === "number" && Number.isFinite(session.e) && typeof session.n === "number" && Number.isFinite(session.n) && session.n >= 1 && typeof session.d === "number" && Number.isFinite(session.d)
      ).map((session) => {
        const parsed = {
          f: session.f,
          s: session.s,
          e: session.e,
          n: session.n,
          d: session.d
        };
        if (session.k === "create") parsed.k = "create";
        return parsed;
      });
    }
    days[key] = day;
  }
  return days;
}
function sanitizeActivityShard(value, key, fallbackEpoch) {
  if (!isRecord2(value)) return null;
  const deviceId = typeof value.deviceId === "string" ? value.deviceId : key;
  if (deviceId !== key) return null;
  return {
    deviceId,
    deviceName: typeof value.deviceName === "string" ? value.deviceName : deviceId,
    epoch: typeof value.epoch === "string" ? value.epoch : fallbackEpoch,
    revision: typeof value.revision === "number" && Number.isFinite(value.revision) ? Math.max(0, Math.floor(value.revision)) : 0,
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    days: sanitizeDays(value.days)
  };
}
function sanitizeV2(raw, fallback) {
  const rawSettings = isRecord2(raw.settings) ? raw.settings : {};
  const settings = {
    value: sanitizeSharedSettings(rawSettings.value),
    stamp: sanitizeStamp(rawSettings.stamp, fallback.settings.stamp.deviceId)
  };
  const epoch = sanitizeVersionedString(
    raw.activityEpoch,
    fallback.activityEpoch.value,
    fallback.activityEpoch.stamp.deviceId
  );
  const activityShards = {};
  if (isRecord2(raw.activityShards)) {
    for (const [key, value] of Object.entries(raw.activityShards)) {
      const shard = sanitizeActivityShard(value, key, epoch.value);
      if (shard) activityShards[key] = shard;
    }
  }
  const pathAliases = {};
  if (isRecord2(raw.pathAliases)) {
    for (const [path, value] of Object.entries(raw.pathAliases)) {
      pathAliases[path] = sanitizeVersionedString(value, "", fallback.settings.stamp.deviceId);
    }
  }
  return {
    schemaVersion: 2,
    settings,
    activityEpoch: epoch,
    activityShards,
    pathAliases,
    selectedDay: sanitizeVersionedString(
      raw.selectedDay,
      fallback.selectedDay.value,
      fallback.selectedDay.stamp.deviceId
    ),
    automationDeviceId: sanitizeVersionedString(
      raw.automationDeviceId,
      "",
      fallback.automationDeviceId.stamp.deviceId
    )
  };
}
function migratePersistedData(raw, deviceId, deviceName, selectedDay, now) {
  const fallback = createInitialState(DEFAULT_SETTINGS, deviceId, deviceName, selectedDay, now);
  if (isRecord2(raw) && raw.schemaVersion === 2) {
    return {
      state: sanitizeV2(raw, fallback),
      legacySecrets: { aiApiKey: "", notifyWebhook: "" },
      legacyLocal: {},
      migrated: false
    };
  }
  const legacy = isRecord2(raw) ? raw : {};
  const legacySettings = isRecord2(legacy.settings) ? legacy.settings : {};
  const {
    aiApiKey: _legacyAiKey,
    notifyWebhook: _legacyWebhook,
    ...legacyWithoutSecrets
  } = legacySettings;
  const legacyLocal = {
    deviceId,
    deviceName,
    lastFolderFilter: typeof legacySettings.lastFolderFilter === "string" ? legacySettings.lastFolderFilter : "",
    notifyDesktop: typeof legacySettings.notifyDesktop === "boolean" ? legacySettings.notifyDesktop : DEFAULT_SETTINGS.notifyDesktop,
    aiSecretId: DEFAULT_SETTINGS.aiSecretId,
    notifySecretId: DEFAULT_SETTINGS.notifySecretId
  };
  const runtime = runtimeSettingsFrom(
    sanitizeSharedSettings({
      ...legacyWithoutSecrets
    }),
    legacyLocal
  );
  const state = createInitialState(runtime, deviceId, deviceName, selectedDay, now);
  state.settings = versioned(sharedSettingsFrom(runtime), 1, LEGACY_DEVICE_ID, 0);
  state.activityEpoch = versioned(LEGACY_EPOCH, 1, LEGACY_DEVICE_ID, 0);
  state.activityShards = {};
  const legacyDays = sanitizeDays(legacy.activity?.days);
  if (Object.keys(legacyDays).length > 0) {
    state.activityShards[LEGACY_DEVICE_ID] = {
      deviceId: LEGACY_DEVICE_ID,
      deviceName: "Imported history",
      epoch: LEGACY_EPOCH,
      revision: 1,
      updatedAt: 0,
      days: legacyDays
    };
  }
  state.activityShards[deviceId] = {
    deviceId,
    deviceName,
    epoch: LEGACY_EPOCH,
    revision: 0,
    updatedAt: now,
    days: {}
  };
  if (runtime.aiAutoWeekly || runtime.aiAutoMonthly) {
    state.automationDeviceId = versioned(deviceId, 2, deviceId, now);
  }
  return {
    state,
    legacySecrets: {
      aiApiKey: typeof legacySettings.aiApiKey === "string" ? legacySettings.aiApiKey : "",
      notifyWebhook: typeof legacySettings.notifyWebhook === "string" ? legacySettings.notifyWebhook : ""
    },
    legacyLocal: {
      lastFolderFilter: legacyLocal.lastFolderFilter,
      notifyDesktop: legacyLocal.notifyDesktop,
      aiSecretId: legacyLocal.aiSecretId,
      notifySecretId: legacyLocal.notifySecretId
    },
    migrated: true
  };
}
function compareStamps(a, b) {
  if (a.clock !== b.clock) return a.clock - b.clock;
  return a.deviceId.localeCompare(b.deviceId);
}
function chooseVersioned(a, b, cloneValue) {
  const comparison = compareStamps(a.stamp, b.stamp);
  if (comparison !== 0) return cloneVersioned(comparison > 0 ? a : b, cloneValue);
  const left = JSON.stringify(canonicalize(a.value));
  const right = JSON.stringify(canonicalize(b.value));
  return cloneVersioned(left.localeCompare(right) >= 0 ? a : b, cloneValue);
}
function chooseActivityShard(a, b) {
  let chosen = a;
  if (b.revision > a.revision) chosen = b;
  else if (b.revision === a.revision && JSON.stringify(canonicalize(b)).localeCompare(JSON.stringify(canonicalize(a))) > 0) {
    chosen = b;
  }
  return cloneActivityShard(chosen);
}
function mergeStates(a, b) {
  const activityEpoch = chooseVersioned(a.activityEpoch, b.activityEpoch, String);
  const activityShards = {};
  const shardIds = /* @__PURE__ */ new Set([
    ...Object.keys(a.activityShards),
    ...Object.keys(b.activityShards)
  ]);
  for (const id of [...shardIds].sort()) {
    const leftCandidate = a.activityShards[id];
    const rightCandidate = b.activityShards[id];
    const left = leftCandidate?.epoch === activityEpoch.value ? leftCandidate : void 0;
    const right = rightCandidate?.epoch === activityEpoch.value ? rightCandidate : void 0;
    if (left && right) activityShards[id] = chooseActivityShard(left, right);
    else if (left) activityShards[id] = cloneActivityShard(left);
    else if (right) activityShards[id] = cloneActivityShard(right);
  }
  const pathAliases = {};
  const aliasPaths = /* @__PURE__ */ new Set([...Object.keys(a.pathAliases), ...Object.keys(b.pathAliases)]);
  for (const path of [...aliasPaths].sort()) {
    const left = a.pathAliases[path];
    const right = b.pathAliases[path];
    if (left && right) pathAliases[path] = chooseVersioned(left, right, String);
    else if (left) pathAliases[path] = cloneVersioned(left, String);
    else if (right) pathAliases[path] = cloneVersioned(right, String);
  }
  return {
    schemaVersion: 2,
    settings: chooseVersioned(a.settings, b.settings, (settings) => ({
      ...settings,
      thresholds: [...settings.thresholds],
      excludeFolders: [...settings.excludeFolders]
    })),
    activityEpoch,
    activityShards,
    pathAliases,
    selectedDay: chooseVersioned(a.selectedDay, b.selectedDay, String),
    automationDeviceId: chooseVersioned(
      a.automationDeviceId,
      b.automationDeviceId,
      String
    )
  };
}
function maxLamportClock(state) {
  let max = Math.max(
    state.settings.stamp.clock,
    state.activityEpoch.stamp.clock,
    state.selectedDay.stamp.clock,
    state.automationDeviceId.stamp.clock
  );
  for (const alias of Object.values(state.pathAliases)) {
    max = Math.max(max, alias.stamp.clock);
  }
  return max;
}
function nextVersioned(state, value, deviceId, now) {
  return versioned(value, maxLamportClock(state) + 1, deviceId, now);
}
function resolvePath(path, aliases) {
  let current = path;
  const seen = /* @__PURE__ */ new Map();
  const order = [];
  for (let i = 0; i < 256; i++) {
    const cycleStart = seen.get(current);
    if (cycleStart !== void 0) {
      return [...order.slice(cycleStart)].sort((a, b) => a.localeCompare(b))[0] ?? current;
    }
    seen.set(current, order.length);
    order.push(current);
    let next = aliases[current]?.value;
    if (!next) {
      const prefix = Object.keys(aliases).filter((candidate) => candidate.endsWith("/") && current.startsWith(candidate)).sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
      if (prefix) {
        const alias = aliases[prefix];
        if (alias) next = alias.value + current.slice(prefix.length);
      }
    }
    if (!next || next === current) return current;
    current = next;
  }
  return [...order, current].sort((a, b) => a.localeCompare(b))[0] ?? current;
}
function aggregateActivity(state) {
  const days = {};
  for (const shard of Object.values(state.activityShards)) {
    if (shard.epoch !== state.activityEpoch.value) continue;
    for (const [key, source] of Object.entries(shard.days)) {
      const target = days[key] ?? (days[key] = { edits: 0, files: {}, sessions: [] });
      target.edits += source.edits;
      for (const [path, count] of Object.entries(source.files)) {
        const resolved = resolvePath(path, state.pathAliases);
        target.files[resolved] = (target.files[resolved] ?? 0) + count;
      }
      for (const session of source.sessions ?? []) {
        (target.sessions ?? (target.sessions = [])).push({
          ...cloneSession(session),
          f: resolvePath(session.f, state.pathAliases),
          v: shard.deviceName
        });
      }
    }
  }
  for (const day of Object.values(days)) {
    if (day.sessions?.length === 0) delete day.sessions;
    else day.sessions?.sort((a, b) => a.s - b.s || a.f.localeCompare(b.f));
  }
  return { days };
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord2(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
  return result;
}
function stateFingerprint(state) {
  return JSON.stringify(canonicalize(state));
}

// src/services/sync.ts
var IDLE_SAVE_MS = 750;
var MAX_SAVE_MS = 3e3;
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function createDeviceId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
function defaultDeviceName() {
  if (import_obsidian6.Platform.isIosApp) return import_obsidian6.Platform.isTablet ? "iPad" : "iPhone";
  if (import_obsidian6.Platform.isAndroidApp) return import_obsidian6.Platform.isTablet ? "Android tablet" : "Android phone";
  if (import_obsidian6.Platform.isWin) return "Windows";
  if (import_obsidian6.Platform.isMacOS) return "Mac";
  if (import_obsidian6.Platform.isLinux) return "Linux";
  return "Obsidian device";
}
var SyncService = class {
  constructor(plugin, transport) {
    this.plugin = plugin;
    this.transport = transport;
    this.idleTimer = null;
    this.maxTimer = null;
    this.writeQueue = Promise.resolve();
    this.started = false;
    this.stopping = false;
    this.hasStoredLocalState = false;
    this.restoredLocalShard = false;
  }
  async start() {
    this.loadLocalState();
    await this.transport.start((raw) => this.receiveRemote(raw));
    this.started = true;
  }
  loadLocalState() {
    const stored = this.plugin.app.loadLocalStorage(LOCAL_STATE_KEY);
    this.hasStoredLocalState = isRecord3(stored);
    this.local = {
      deviceId: isRecord3(stored) && typeof stored.deviceId === "string" ? stored.deviceId : createDeviceId(),
      deviceName: isRecord3(stored) && typeof stored.deviceName === "string" ? stored.deviceName : defaultDeviceName(),
      lastFolderFilter: isRecord3(stored) && typeof stored.lastFolderFilter === "string" ? stored.lastFolderFilter : "",
      notifyDesktop: isRecord3(stored) && typeof stored.notifyDesktop === "boolean" ? stored.notifyDesktop : DEFAULT_SETTINGS.notifyDesktop,
      aiSecretId: isRecord3(stored) && typeof stored.aiSecretId === "string" && /^[a-z0-9-]+$/.test(stored.aiSecretId) ? stored.aiSecretId : DEFAULT_SETTINGS.aiSecretId,
      notifySecretId: isRecord3(stored) && typeof stored.notifySecretId === "string" && /^[a-z0-9-]+$/.test(stored.notifySecretId) ? stored.notifySecretId : DEFAULT_SETTINGS.notifySecretId
    };
    this.saveLocalState();
  }
  saveLocalState() {
    this.plugin.app.saveLocalStorage(LOCAL_STATE_KEY, this.local);
  }
  localShardKey() {
    return `${LOCAL_SHARD_KEY_PREFIX}${this.local.deviceId}`;
  }
  restoreLocalShardBackup() {
    if (this.restoredLocalShard) return false;
    this.restoredLocalShard = true;
    const raw = this.plugin.app.loadLocalStorage(this.localShardKey());
    if (!isRecord3(raw)) return false;
    const isEnvelope = raw.schemaVersion === 1 && isRecord3(raw.shard);
    const candidate = migratePersistedData(
      {
        ...this.state,
        activityEpoch: isEnvelope ? raw.activityEpoch : this.state.activityEpoch,
        activityShards: {
          [this.local.deviceId]: isEnvelope ? raw.shard : raw
        }
      },
      this.local.deviceId,
      this.local.deviceName,
      this.plugin.selectedDay,
      Date.now()
    ).state;
    const before = stateFingerprint(this.state);
    this.state = mergeStates(this.state, candidate);
    return stateFingerprint(this.state) !== before;
  }
  saveLocalShardBackup() {
    const shard = this.state?.activityShards[this.local.deviceId];
    if (!shard) return;
    try {
      const backup = {
        schemaVersion: 1,
        activityEpoch: {
          value: this.state.activityEpoch.value,
          stamp: { ...this.state.activityEpoch.stamp }
        },
        shard: cloneActivityShard(shard)
      };
      this.plugin.app.saveLocalStorage(this.localShardKey(), backup);
    } catch (error) {
      console.error("vault-activity-heatmap: failed to back up local activity shard", error);
    }
  }
  receiveRemote(raw) {
    this.writeQueue = this.writeQueue.catch(() => void 0).then(() => this.reconcileRemote(raw));
    return this.writeQueue;
  }
  async reconcileRemote(raw) {
    const migration = migratePersistedData(
      raw,
      this.local.deviceId,
      this.local.deviceName,
      this.plugin.selectedDay,
      Date.now()
    );
    if (!this.hasStoredLocalState && migration.migrated) {
      this.local = { ...this.local, ...migration.legacyLocal };
      this.saveLocalState();
    }
    this.migrateSecrets(migration.legacySecrets.aiApiKey, migration.legacySecrets.notifyWebhook);
    const incoming = migration.state;
    const merged = this.state ? mergeStates(this.state, incoming) : incoming;
    const incomingFingerprint = stateFingerprint(incoming);
    this.state = merged;
    const changedForRemote = stateFingerprint(merged) !== incomingFingerprint;
    const restoredShard = this.restoreLocalShardBackup();
    const createdShard = this.ensureOwnShard();
    this.saveLocalShardBackup();
    this.applyRuntimeState();
    if (migration.migrated || changedForRemote || restoredShard || createdShard) {
      this.schedulePersist();
    }
  }
  migrateSecrets(aiApiKey, notifyWebhook) {
    if (aiApiKey && !this.plugin.app.secretStorage.getSecret(DEFAULT_AI_SECRET_ID)) {
      this.plugin.app.secretStorage.setSecret(DEFAULT_AI_SECRET_ID, aiApiKey);
    }
    if (notifyWebhook && !this.plugin.app.secretStorage.getSecret(DEFAULT_NOTIFY_SECRET_ID)) {
      this.plugin.app.secretStorage.setSecret(DEFAULT_NOTIFY_SECRET_ID, notifyWebhook);
    }
  }
  ensureOwnShard() {
    const existing = this.state.activityShards[this.local.deviceId];
    if (existing?.epoch === this.state.activityEpoch.value) {
      if (existing.deviceName !== this.local.deviceName) {
        existing.deviceName = this.local.deviceName;
        existing.revision += 1;
        existing.updatedAt = Date.now();
        return true;
      }
      return false;
    }
    this.state.activityShards[this.local.deviceId] = {
      deviceId: this.local.deviceId,
      deviceName: this.local.deviceName,
      epoch: this.state.activityEpoch.value,
      revision: (existing?.revision ?? 0) + 1,
      updatedAt: Date.now(),
      days: {}
    };
    return true;
  }
  applyRuntimeState(render = true) {
    this.plugin.settings = runtimeSettingsFrom(this.state.settings.value, this.local);
    this.plugin.activity = aggregateActivity(this.state);
    this.plugin.selectedDay = this.state.selectedDay.value;
    if (render) this.plugin.renderAllViews();
  }
  get deviceId() {
    return this.local.deviceId;
  }
  get deviceName() {
    return this.local.deviceName;
  }
  get automationDeviceId() {
    return this.state.automationDeviceId.value;
  }
  getLocalShard() {
    this.ensureOwnShard();
    const shard = this.state.activityShards[this.local.deviceId];
    if (!shard) throw new Error("Local activity shard invariant failed");
    return shard;
  }
  touchActivity() {
    const shard = this.getLocalShard();
    shard.revision += 1;
    shard.updatedAt = Date.now();
    this.saveLocalShardBackup();
    this.applyRuntimeState(false);
    this.schedulePersist();
  }
  updateSharedSettings(settings) {
    this.state.settings = nextVersioned(
      this.state,
      sharedSettingsFrom(settings),
      this.local.deviceId,
      Date.now()
    );
    this.applyRuntimeState();
    this.schedulePersist();
  }
  updateLocalSettings(patch) {
    this.local = { ...this.local, ...patch };
    this.saveLocalState();
    let shardChanged = false;
    if (patch.deviceName !== void 0) {
      shardChanged = this.ensureOwnShard();
      this.saveLocalShardBackup();
    }
    this.applyRuntimeState();
    if (shardChanged) this.schedulePersist();
  }
  setSelectedDay(dateKey) {
    if (!dateKey || dateKey === this.state.selectedDay.value) return;
    this.state.selectedDay = nextVersioned(
      this.state,
      dateKey,
      this.local.deviceId,
      Date.now()
    );
    this.applyRuntimeState();
    this.schedulePersist();
  }
  setAutomationDevice(deviceId) {
    if (deviceId === this.state.automationDeviceId.value) return;
    this.state.automationDeviceId = nextVersioned(
      this.state,
      deviceId,
      this.local.deviceId,
      Date.now()
    );
    this.applyRuntimeState();
    this.schedulePersist();
  }
  setPathAlias(oldPath, newPath) {
    if (!oldPath || oldPath === newPath) return;
    this.state.pathAliases[oldPath] = nextVersioned(
      this.state,
      newPath,
      this.local.deviceId,
      Date.now()
    );
    this.applyRuntimeState();
    this.schedulePersist();
  }
  clearActivity() {
    const now = Date.now();
    const epoch = `epoch-${this.local.deviceId}-${now}`;
    this.state.activityEpoch = nextVersioned(
      this.state,
      epoch,
      this.local.deviceId,
      now
    );
    const previous = this.state.activityShards[this.local.deviceId];
    this.state.activityShards[this.local.deviceId] = {
      deviceId: this.local.deviceId,
      deviceName: this.local.deviceName,
      epoch,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: now,
      days: {}
    };
    this.saveLocalShardBackup();
    this.applyRuntimeState();
    this.schedulePersist();
  }
  clearTimers() {
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    if (this.maxTimer !== null) window.clearTimeout(this.maxTimer);
    this.idleTimer = null;
    this.maxTimer = null;
  }
  schedulePersist() {
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => void this.flush(), IDLE_SAVE_MS);
    if (this.maxTimer === null) {
      this.maxTimer = window.setTimeout(() => void this.flush(), MAX_SAVE_MS);
    }
  }
  async flush() {
    if (!this.state) return;
    this.clearTimers();
    this.writeQueue = this.writeQueue.catch(() => void 0).then(async () => {
      const diskMigration = migratePersistedData(
        await this.transport.read(),
        this.local.deviceId,
        this.local.deviceName,
        this.plugin.selectedDay,
        Date.now()
      );
      this.migrateSecrets(
        diskMigration.legacySecrets.aiApiKey,
        diskMigration.legacySecrets.notifyWebhook
      );
      const disk = diskMigration.state;
      const diskFingerprint = stateFingerprint(disk);
      this.state = mergeStates(this.state, disk);
      this.ensureOwnShard();
      this.saveLocalShardBackup();
      this.applyRuntimeState();
      const fingerprint = stateFingerprint(this.state);
      if (!diskMigration.migrated && fingerprint === diskFingerprint) return;
      await this.transport.publish(this.state);
    });
    try {
      await this.writeQueue;
    } catch (error) {
      console.error("vault-activity-heatmap: failed to persist synchronized state", error);
      if (!this.stopping) this.schedulePersist();
    }
  }
  async refreshFromDisk() {
    if (!this.started) return;
    await this.transport.refresh();
  }
  async stop() {
    this.stopping = true;
    await this.flush();
    await this.transport.stop();
  }
};

// src/services/sync-transport.ts
var VaultSyncTransport = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.onRemoteState = null;
  }
  async start(onRemoteState) {
    this.onRemoteState = onRemoteState;
    await this.refresh();
  }
  async read() {
    const data = await this.plugin.loadData();
    return data;
  }
  async publish(state) {
    await this.plugin.saveData(state);
  }
  async refresh() {
    const handler = this.onRemoteState;
    if (!handler) return;
    await handler(await this.read());
  }
  async stop() {
    this.onRemoteState = null;
  }
};

// src/ui/add-task-modal.ts
var import_obsidian7 = require("obsidian");
var AddTaskModal = class extends import_obsidian7.Modal {
  constructor(app, dateKey, onSubmit) {
    super(app);
    this.dateKey = dateKey;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    this.titleEl.setText(`Add task - ${this.dateKey}`);
    let value = "";
    const submit = () => {
      const text = value.trim();
      if (!text) return;
      this.close();
      this.onSubmit(text);
    };
    new import_obsidian7.Setting(this.contentEl).setName("Task").addText((text) => {
      text.setPlaceholder("What needs doing?");
      text.onChange((v) => value = v);
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          if (e.isComposing) return;
          e.preventDefault();
          submit();
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    new import_obsidian7.Setting(this.contentEl).addButton(
      (btn) => btn.setButtonText("Add task").setCta().onClick(submit)
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/heatmap-view.ts
var import_obsidian8 = require("obsidian");

// src/utils/color.ts
function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (isNaN(n) || h.length !== 6) return [64, 196, 99];
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function hexToRgbString(hex) {
  const [r, g, b] = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}
function parseColorInput(input) {
  const s = input.trim();
  if (!s) return null;
  const hexMatch = s.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i) ?? s.match(/^([0-9a-f]{6})$/i);
  if (hexMatch) {
    const match = hexMatch[1];
    if (!match) return null;
    let h = match.toLowerCase();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return "#" + h;
  }
  const parts = s.split(/[,\s]+/).filter(Boolean).map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  return null;
}
function levelColor(baseColor, level) {
  const [r, g, b] = hexToRgb(baseColor);
  const alpha = [0.3, 0.55, 0.8, 1][Math.max(0, Math.min(3, level - 1))] ?? 1;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// src/ui/heatmap-view.ts
var HeatmapView = class extends import_obsidian8.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.detailEl = null;
    this.lastDetailKey = null;
    this.completedOpen = false;
    this.detailToken = 0;
    this.pendingRender = false;
    this.sheetOpen = false;
    this.focusSheetOnLoad = false;
    this.restoreCellFocusKey = null;
    this.suppressCellClickUntil = 0;
    this.backdropVideo = null;
    this.backdropObserver = null;
    this.motionQuery = null;
    this.motionListener = null;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_HEATMAP;
  }
  getDisplayText() {
    return "Activity heatmap";
  }
  getIcon() {
    return "calendar-check";
  }
  async onOpen() {
    this.registerDomEvent(activeDocument, "visibilitychange", () => {
      if (activeDocument.visibilityState === "hidden") this.pauseBackdrop();
      else this.resumeBackdrop();
    });
    this.render();
  }
  async onClose() {
    this.destroyBackdrop();
  }
  render() {
    const active = activeDocument.activeElement;
    if (active instanceof HTMLInputElement && this.contentEl.contains(active)) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    this.destroyBackdrop();
    const plugin = this.plugin;
    const settings = plugin.settings;
    const folderPaths = plugin.allFolderPaths();
    let folder = settings.lastFolderFilter;
    if (folder && !folderPaths.includes(folder)) {
      plugin.setLocalFolderFilter("");
      return;
    }
    const root = this.contentEl;
    root.empty();
    const shell = root.createDiv({ cls: "vah-container" });
    if (import_obsidian8.Platform.isPhone) shell.addClass("vah-phone");
    this.applyPanelTheme(shell);
    const container = shell.createDiv({ cls: "vah-content" });
    const allNotes = plugin.app.vault.getMarkdownFiles().filter((f) => isUnderFolder(f.path, folder)).length;
    const activeDays = Object.keys(plugin.activity.days).filter(
      (key) => plugin.countForDay(key, folder) > 0
    ).length;
    const streak = this.currentStreak(folder);
    const stats = container.createDiv({ cls: "vah-stats" });
    this.statBlock(stats, String(allNotes), "Notes");
    this.statBlock(stats, String(activeDays), "Days");
    this.statBlock(stats, String(streak), "Streak");
    const controls = container.createDiv({ cls: "vah-controls" });
    const dropdown = new import_obsidian8.DropdownComponent(controls);
    dropdown.addOption("", "Whole vault");
    for (const path of folderPaths) {
      dropdown.addOption(path, path);
    }
    dropdown.setValue(folder);
    dropdown.onChange((value) => {
      plugin.setLocalFolderFilter(value);
    });
    if (Object.keys(plugin.activity.days).length === 0) {
      const hint = container.createDiv({ cls: "vah-hint" });
      hint.setText(
        "No activity recorded yet. Start writing, or seed the graph from your existing notes:"
      );
      const btn = hint.createEl("button", { text: "Backfill from file dates" });
      btn.addEventListener("click", () => plugin.backfillFromFileStats());
    }
    const today = startOfToday();
    const todayKey = toDateKey(today);
    const firstDow = settings.firstDayOfWeek;
    const todayIndexInWeek = (today.getDay() - firstDow + 7) % 7;
    const weeks = Math.max(4, Math.min(53, settings.weeksToShow));
    const totalDays = (weeks - 1) * 7 + todayIndexInWeek + 1;
    const start = new Date(today);
    start.setDate(today.getDate() - totalDays + 1);
    const scroll = container.createDiv({ cls: "vah-scroll" });
    const monthsRow = scroll.createDiv({ cls: "vah-months" });
    const body = scroll.createDiv({ cls: "vah-body" });
    const weekdays = body.createDiv({ cls: "vah-weekdays" });
    for (let row = 0; row < 7; row++) {
      const label = weekdays.createDiv({ cls: "vah-weekday" });
      if (row % 2 === 1) label.setText(DAY_NAMES[(firstDow + row) % 7] ?? "");
    }
    const grid = body.createDiv({
      cls: "vah-grid",
      attr: { role: "grid", "aria-label": "Activity by day" }
    });
    const cellsByDate = /* @__PURE__ */ new Map();
    const cursor = new Date(start);
    let prevMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const monthSlot = monthsRow.createDiv({ cls: "vah-month-slot" });
      const columnMonth = cursor.getMonth();
      if (columnMonth !== prevMonth) {
        monthSlot.setText(MONTH_NAMES[columnMonth] ?? "");
        prevMonth = columnMonth;
      }
      const weekEl = grid.createDiv({ cls: "vah-week", attr: { role: "row" } });
      for (let row = 0; row < 7; row++) {
        const key = toDateKey(cursor);
        const isFuture = cursor.getTime() > today.getTime();
        const cell = weekEl.createEl("button", {
          cls: "vah-cell",
          attr: {
            type: "button",
            role: "gridcell",
            "data-date": key,
            "aria-selected": String(key === plugin.selectedDay)
          }
        });
        cellsByDate.set(key, cell);
        if (settings.emptyColor) {
          cell.setCssStyles({ backgroundColor: settings.emptyColor });
        }
        const count = isFuture ? 0 : plugin.countForDay(key, folder);
        const level = isFuture ? 0 : plugin.intensityLevel(count);
        if (!isFuture && level > 0) {
          cell.setCssStyles({
            backgroundColor: levelColor(settings.baseColor, level)
          });
        }
        if (isFuture) cell.addClass("vah-future");
        if (key === todayKey) {
          cell.addClass("vah-today");
          cell.setAttr("aria-current", "date");
        }
        if (key === plugin.selectedDay) cell.addClass("vah-selected");
        const noun = settings.metric === "edits" ? "edits" : "notes";
        const label = isFuture ? `${key} - upcoming` : `${key} - ${count} ${noun}`;
        cell.setAttr("title", label);
        cell.setAttr("aria-label", label);
        cell.tabIndex = key === plugin.selectedDay || key === todayKey ? 0 : -1;
        cell.addEventListener("click", () => {
          if (Date.now() < this.suppressCellClickUntil) return;
          this.selectDay(key);
        });
        cell.addEventListener("keydown", (event) => {
          const delta = event.key === "ArrowLeft" ? -7 : event.key === "ArrowRight" ? 7 : event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (!delta) return;
          event.preventDefault();
          const targetDate = /* @__PURE__ */ new Date(`${key}T00:00:00`);
          targetDate.setDate(targetDate.getDate() + delta);
          const target = cellsByDate.get(toDateKey(targetDate));
          if (!target) return;
          for (const candidate of cellsByDate.values()) candidate.tabIndex = -1;
          target.tabIndex = 0;
          target.focus();
        });
        this.attachCellMenu(cell, key);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    for (const cell of cellsByDate.values()) cell.tabIndex = -1;
    (cellsByDate.get(plugin.selectedDay) ?? cellsByDate.get(todayKey))?.setAttr(
      "tabindex",
      "0"
    );
    const legend = container.createDiv({ cls: "vah-legend" });
    legend.createSpan({ text: "Less" });
    for (let level = 0; level <= 4; level++) {
      const swatch = legend.createDiv({ cls: "vah-cell vah-legend-swatch" });
      if (level === 0 && settings.emptyColor) {
        swatch.setCssStyles({ backgroundColor: settings.emptyColor });
      }
      if (level > 0) {
        swatch.setCssStyles({
          backgroundColor: levelColor(settings.baseColor, level)
        });
      }
    }
    legend.createSpan({ text: "More" });
    let scrim = null;
    if (import_obsidian8.Platform.isPhone) {
      scrim = container.createDiv({
        cls: "vah-sheet-scrim",
        attr: { "aria-hidden": "true" }
      });
      if (this.sheetOpen) scrim.addClass("is-open");
      scrim.addEventListener("click", () => this.closeDetailSheet());
    }
    this.detailEl = container.createDiv({
      cls: import_obsidian8.Platform.isPhone ? "vah-detail vah-detail-sheet" : "vah-detail"
    });
    if (import_obsidian8.Platform.isPhone) {
      this.detailEl.setAttrs({
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Day details",
        "aria-hidden": String(!this.sheetOpen)
      });
      this.detailEl.tabIndex = -1;
      this.detailEl.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeDetailSheet();
        } else if (event.key === "Tab") {
          this.trapSheetFocus(event);
        }
      });
      if (this.sheetOpen) {
        this.detailEl.addClass("is-open");
        for (const child of Array.from(container.children)) {
          if (child !== this.detailEl && child !== scrim) {
            child.setAttr("inert", "");
          }
        }
      }
    }
    this.lastDetailKey = plugin.selectedDay || todayKey;
    if (!import_obsidian8.Platform.isPhone || this.sheetOpen) {
      void this.showDetail(this.lastDetailKey, folder);
    }
    window.requestAnimationFrame(() => {
      scroll.scrollLeft = scroll.scrollWidth;
      if (this.restoreCellFocusKey) {
        const key = this.restoreCellFocusKey;
        this.restoreCellFocusKey = null;
        root.querySelector(`button[data-date="${key}"]`)?.focus();
      }
    });
  }
  selectDay(key) {
    this.lastDetailKey = key;
    if (import_obsidian8.Platform.isPhone) {
      this.sheetOpen = true;
      this.focusSheetOnLoad = true;
    }
    if (key === this.plugin.selectedDay) this.render();
    else this.plugin.setSelectedDay(key);
  }
  closeDetailSheet() {
    this.detailToken += 1;
    this.sheetOpen = false;
    this.focusSheetOnLoad = false;
    this.restoreCellFocusKey = this.lastDetailKey;
    this.render();
  }
  trapSheetFocus(event) {
    const detail = this.detailEl;
    if (!detail) return;
    const focusable = Array.from(
      detail.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      detail.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && detail.ownerDocument.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && detail.ownerDocument.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  /**
   * Panel-scoped theming: custom text/background colors and an image or
   * looping video backdrop, without touching the rest of the Obsidian theme.
   */
  applyPanelTheme(shell) {
    const s = this.plugin.settings;
    if (s.panelBgColor) shell.setCssStyles({ backgroundColor: s.panelBgColor });
    if (s.panelTextColor) {
      const [r, g, b] = hexToRgb(s.panelTextColor);
      shell.setCssStyles({ color: `rgb(${r}, ${g}, ${b})` });
      shell.setCssProps({
        "--text-normal": `rgb(${r}, ${g}, ${b})`,
        "--text-muted": `rgba(${r}, ${g}, ${b}, 0.75)`,
        "--text-faint": `rgba(${r}, ${g}, ${b}, 0.55)`
      });
    }
    const url = this.plugin.resolveBackdropUrl(s.backdropPath);
    if (!url) return;
    shell.addClass("vah-themed");
    const backdrop = shell.createDiv({ cls: "vah-backdrop" });
    const isVideo = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(s.backdropPath.trim());
    let media;
    if (isVideo) {
      const video = backdrop.createEl("video");
      video.src = url;
      const reducedMotion = shell.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
      video.autoplay = !reducedMotion;
      video.loop = true;
      video.muted = true;
      video.setAttr("playsinline", "");
      this.backdropVideo = video;
      this.motionQuery = video.win.matchMedia("(prefers-reduced-motion: reduce)");
      this.motionListener = () => {
        if (this.motionQuery?.matches) this.pauseBackdrop();
        else this.resumeBackdrop();
      };
      this.motionQuery.addEventListener("change", this.motionListener);
      if (reducedMotion) {
        video.addEventListener("loadeddata", () => video.pause(), { once: true });
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) this.resumeBackdrop();
        else this.pauseBackdrop();
      });
      this.backdropObserver = observer;
      observer.observe(video);
      media = video;
    } else {
      media = backdrop.createEl("img", { attr: { src: url } });
    }
    if (s.backdropBlur > 0) {
      media.setCssStyles({
        filter: `blur(${s.backdropBlur}px)`,
        // Oversize slightly so blurred edges do not show the background.
        transform: "scale(1.06)"
      });
    }
    const dim = backdrop.createDiv({ cls: "vah-backdrop-dim" });
    dim.setCssStyles({
      backgroundColor: `rgba(0, 0, 0, ${s.backdropDim})`
    });
  }
  pauseBackdrop() {
    this.backdropVideo?.pause();
  }
  destroyBackdrop() {
    this.backdropObserver?.disconnect();
    this.backdropObserver = null;
    if (this.motionQuery && this.motionListener) {
      this.motionQuery.removeEventListener("change", this.motionListener);
    }
    this.motionQuery = null;
    this.motionListener = null;
    const video = this.backdropVideo;
    this.backdropVideo = null;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  resumeBackdrop() {
    const video = this.backdropVideo;
    if (!video || video.ownerDocument.visibilityState === "hidden") return;
    if (video.win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void video.play().catch(() => void 0);
  }
  createCellMenu(dateKey) {
    const menu = new import_obsidian8.Menu();
    menu.addItem(
      (item) => item.setTitle("Add task to daily reflection...").setIcon("check-square").onClick(() => {
        new AddTaskModal(this.plugin.app, dateKey, (text) => {
          void this.plugin.addTaskToDailyReflection(dateKey, text);
        }).open();
      })
    );
    menu.addItem(
      (item) => item.setTitle("Open daily reflection note").setIcon("file-text").onClick(() => void this.plugin.openDailyReflection(dateKey))
    );
    return menu;
  }
  /** Right-click and long-press menu for reflection actions. */
  attachCellMenu(cell, dateKey) {
    let suppressContextMenuUntil = 0;
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (Date.now() < suppressContextMenuUntil) return;
      if (e.clientX === 0 && e.clientY === 0) {
        const rect = cell.getBoundingClientRect();
        this.createCellMenu(dateKey).showAtPosition(
          { x: rect.left, y: rect.bottom },
          cell.ownerDocument
        );
      } else {
        this.createCellMenu(dateKey).showAtMouseEvent(e);
      }
    });
    cell.addEventListener("keydown", (event) => {
      if (event.key !== "F10" || !event.shiftKey) return;
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      this.createCellMenu(dateKey).showAtPosition(
        { x: rect.left, y: rect.bottom },
        cell.ownerDocument
      );
    });
    if (!import_obsidian8.Platform.isMobile) return;
    let timer = null;
    let startX = 0;
    let startY = 0;
    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    cell.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        this.suppressCellClickUntil = Date.now() + 700;
        suppressContextMenuUntil = Date.now() + 700;
        this.createCellMenu(dateKey).showAtPosition(
          { x: startX, y: startY },
          cell.ownerDocument
        );
      }, 500);
    });
    cell.addEventListener("pointermove", (event) => {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
    });
    cell.addEventListener("pointerup", cancel);
    cell.addEventListener("pointercancel", cancel);
    cell.addEventListener("pointerleave", cancel);
    cell.addEventListener("lostpointercapture", cancel);
  }
  statBlock(parent, value, label) {
    const el = parent.createDiv({ cls: "vah-stat" });
    el.createDiv({ cls: "vah-stat-num", text: value });
    el.createDiv({ cls: "vah-stat-label", text: label });
  }
  currentStreak(folder) {
    const plugin = this.plugin;
    let streak = 0;
    const d = startOfToday();
    if (plugin.countForDay(toDateKey(d), folder) === 0) {
      d.setDate(d.getDate() - 1);
    }
    while (plugin.countForDay(toDateKey(d), folder) > 0) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }
  async showDetail(key, folder, focusAddInput = false) {
    if (!this.detailEl) return;
    const token = ++this.detailToken;
    this.lastDetailKey = key;
    const daily = this.plugin.settings.showTasks ? await this.plugin.readDailyTasks(key) : null;
    if (token !== this.detailToken || !this.detailEl) return;
    const detail = this.detailEl;
    detail.empty();
    const files = this.plugin.filesForDay(key, folder);
    const detailHeader = detail.createDiv({ cls: "vah-detail-header" });
    detailHeader.createEl("h6", {
      text: `${key} - ${files.length} note${files.length === 1 ? "" : "s"}`
    });
    if (import_obsidian8.Platform.isPhone) {
      const actions = detailHeader.createDiv({ cls: "vah-detail-actions" });
      const addTask = actions.createEl("button", {
        cls: "clickable-icon",
        attr: { type: "button", "aria-label": "Add task" }
      });
      (0, import_obsidian8.setIcon)(addTask, "plus");
      addTask.setAttr("title", "Add task");
      addTask.addEventListener("click", () => {
        new AddTaskModal(this.plugin.app, key, (text) => {
          void this.plugin.addTaskToDailyReflection(key, text).then(() => this.showDetail(key, folder));
        }).open();
      });
      const openNote = actions.createEl("button", {
        cls: "clickable-icon",
        attr: { type: "button", "aria-label": "Open daily reflection note" }
      });
      (0, import_obsidian8.setIcon)(openNote, "file-text");
      openNote.setAttr("title", "Open daily reflection note");
      openNote.addEventListener("click", () => void this.plugin.openDailyReflection(key));
      const close = actions.createEl("button", {
        cls: "clickable-icon",
        attr: { type: "button", "aria-label": "Close day details" }
      });
      (0, import_obsidian8.setIcon)(close, "x");
      close.setAttr("title", "Close day details");
      close.addEventListener("click", () => this.closeDetailSheet());
    }
    if (daily) this.renderTasks(detail, key, folder, daily, focusAddInput);
    if (files.length > 0) {
      const section = detail.createDiv({ cls: "vah-section" });
      const titleRow = section.createDiv({
        cls: "vah-section-title vah-section-title-row"
      });
      titleRow.createSpan({ text: "Notes edited" });
      const showingFull = this.plugin.settings.notesPathDisplay === "full";
      const toggle = titleRow.createEl("button", {
        cls: "vah-path-toggle",
        text: showingFull ? "Hide paths" : "Show paths"
      });
      toggle.setAttr(
        "title",
        showingFull ? "Show file names only" : "Show the full folder path of each note"
      );
      toggle.addEventListener("click", () => {
        this.plugin.settings.notesPathDisplay = showingFull ? "name" : "full";
        this.plugin.saveSettings();
      });
      const labels = notePathLabels(
        files.map(([path]) => path),
        this.plugin.settings.notesPathDisplay
      );
      const list = section.createDiv({ cls: "vah-detail-list" });
      files.forEach(([path, edits], i) => {
        const row = list.createDiv({ cls: "vah-detail-row" });
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        const link = file instanceof import_obsidian8.TFile ? row.createEl("button", {
          cls: "vah-detail-link vah-detail-link-live",
          attr: { type: "button" }
        }) : row.createSpan({ cls: "vah-detail-link" });
        const label = labels[i] ?? path.replace(/\.md$/, "");
        const slash = label.lastIndexOf("/");
        if (slash >= 0) {
          link.createSpan({
            cls: "vah-link-dir",
            text: label.slice(0, slash + 1)
          });
        }
        link.createSpan({ cls: "vah-link-name", text: label.slice(slash + 1) });
        link.setAttr("title", path.replace(/\.md$/, ""));
        if (file instanceof import_obsidian8.TFile) {
          link.addEventListener("click", () => {
            void this.plugin.app.workspace.getLeaf(false).openFile(file);
          });
        }
        row.createSpan({ cls: "vah-detail-edits", text: `x${edits}` });
      });
    } else if (!daily) {
      detail.createDiv({ cls: "vah-detail-empty", text: "No activity." });
    }
    if (this.plugin.settings.showTimeline) {
      this.renderTimeline(detail, key, folder);
    }
    if (import_obsidian8.Platform.isPhone && this.sheetOpen && this.focusSheetOnLoad) {
      this.focusSheetOnLoad = false;
      detail.focus();
    }
  }
  /** Microsoft To Do-style task list backed by the day's reflection note. */
  renderTasks(detail, key, folder, daily, focusAddInput) {
    const plugin = this.plugin;
    const section = detail.createDiv({ cls: "vah-section" });
    section.createDiv({ cls: "vah-section-title", text: "Tasks" });
    const addRow = section.createDiv({ cls: "vah-task-add" });
    addRow.createSpan({ cls: "vah-task-circle vah-task-add-circle", text: "+" });
    const input = addRow.createEl("input", {
      cls: "vah-task-input",
      type: "text",
      placeholder: "Add a task"
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      void plugin.addTaskToDailyReflection(key, text).then(() => this.showDetail(key, folder, true));
    });
    input.addEventListener("blur", () => {
      if (this.pendingRender) this.render();
    });
    if (focusAddInput) window.setTimeout(() => input.focus(), 0);
    const renderRow = (parent, task) => {
      const row = parent.createDiv({
        cls: "vah-task-row" + (task.done ? " vah-task-done" : "")
      });
      const circle = row.createEl("button", {
        cls: "vah-task-circle" + (task.done ? " vah-task-circle-done" : ""),
        attr: { type: "button" }
      });
      circle.setText(task.done ? "x" : "");
      circle.setAttr("title", task.done ? "Mark as not done" : "Mark as done");
      circle.setAttr("aria-label", task.done ? "Mark as not done" : "Mark as done");
      circle.addEventListener("click", () => {
        const file = daily.file;
        if (!file) return;
        void plugin.toggleTask(file, task, !task.done).then(() => this.showDetail(key, folder));
      });
      row.createSpan({ cls: "vah-task-text", text: task.text });
    };
    const open = daily.tasks.filter((t) => !t.done);
    const done = daily.tasks.filter((t) => t.done);
    if (open.length > 0) {
      const list = section.createDiv({ cls: "vah-task-list" });
      for (const t of open) renderRow(list, t);
    } else if (daily.tasks.length === 0) {
      section.createDiv({
        cls: "vah-detail-empty",
        text: daily.file ? "No tasks in this day's reflection note." : "No reflection note yet - add a task to create one."
      });
    }
    if (done.length > 0) {
      const header = section.createEl("button", {
        cls: "vah-task-done-header",
        attr: { type: "button", "aria-expanded": String(this.completedOpen) }
      });
      header.setText(`${this.completedOpen ? "v" : ">"} Completed ${done.length}`);
      header.addEventListener("click", () => {
        this.completedOpen = !this.completedOpen;
        void this.showDetail(key, folder);
      });
      if (this.completedOpen) {
        const list = section.createDiv({ cls: "vah-task-list" });
        for (const t of done) renderRow(list, t);
      }
    }
  }
  /** Chronological trail of the day's editing sessions. */
  renderTimeline(detail, key, folder) {
    const sessions = (this.plugin.activity.days[key]?.sessions ?? []).filter((s) => isUnderFolder(s.f, folder)).sort((a, b) => a.s - b.s);
    if (sessions.length === 0) return;
    const showDevices = new Set(sessions.map((session) => session.v).filter(Boolean)).size > 1;
    const section = detail.createDiv({ cls: "vah-section" });
    section.createDiv({ cls: "vah-section-title", text: "Timeline" });
    const list = section.createDiv({ cls: "vah-timeline" });
    for (const s of sessions) {
      const item = list.createDiv({ cls: "vah-tl-item" });
      item.createDiv({ cls: "vah-tl-dot" });
      const name = (s.f.split("/").pop() ?? s.f).replace(/\.md$/, "");
      const target = this.plugin.app.vault.getAbstractFileByPath(s.f);
      const title = target instanceof import_obsidian8.TFile ? item.createEl("button", {
        cls: "vah-tl-title vah-detail-link-live",
        attr: { type: "button" }
      }) : item.createDiv({ cls: "vah-tl-title" });
      title.setText(s.k === "create" ? `${name} - created` : name);
      if (target instanceof import_obsidian8.TFile) {
        title.addEventListener("click", () => {
          void this.plugin.app.workspace.getLeaf(false).openFile(target);
        });
      }
      const parts = [
        s.e - s.s >= 6e4 ? `${formatClockTime(s.s)}-${formatClockTime(s.e)}` : formatClockTime(s.s)
      ];
      if (s.d !== 0) parts.push(formatByteDelta(s.d));
      if (s.n > 1) parts.push(`${s.n} changes`);
      if (showDevices && s.v) parts.push(s.v);
      item.createDiv({ cls: "vah-tl-meta", text: parts.join(" | ") });
    }
  }
};

// src/ui/settings-tab.ts
var import_obsidian10 = require("obsidian");

// src/ui/confirm-clear-history-modal.ts
var import_obsidian9 = require("obsidian");
var ConfirmClearHistoryModal = class extends import_obsidian9.Modal {
  constructor(app, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
  }
  onOpen() {
    this.titleEl.setText("Clear heatmap history?");
    this.contentEl.createEl("p", {
      text: "This deletes every recorded activity day for Vault Activity Heatmap. Your notes are not changed, but this history cannot be restored from inside the plugin."
    });
    new import_obsidian9.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("Cancel").onClick(() => this.close())
    ).addButton(
      (button) => button.setButtonText("Clear history").setDestructive().onClick(() => {
        this.close();
        this.onConfirm();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/settings-tab.ts
var HeatmapSettingTab = class extends import_obsidian10.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("vah-settings");
    const save = async () => {
      this.plugin.saveSettings();
    };
    new import_obsidian10.Setting(containerEl).setName("Appearance").setHeading();
    let baseColorPicker = null;
    let baseColorText = null;
    let syncingBaseColor = false;
    new import_obsidian10.Setting(containerEl).setName("Square color").setDesc(
      "Base color of the heatmap squares. Pick it, or type an RGB value like 64, 196, 99 (or a hex code like #40c463)."
    ).addColorPicker((picker) => {
      baseColorPicker = picker;
      picker.setValue(this.plugin.settings.baseColor).onChange(async (value) => {
        if (syncingBaseColor || value === this.plugin.settings.baseColor)
          return;
        this.plugin.settings.baseColor = value;
        baseColorText?.setValue(hexToRgbString(value));
        await save();
      });
    }).addText((text) => {
      baseColorText = text;
      text.setPlaceholder("64, 196, 99").setValue(hexToRgbString(this.plugin.settings.baseColor)).onChange(async (value) => {
        const hex = parseColorInput(value);
        if (!hex || hex === this.plugin.settings.baseColor) return;
        this.plugin.settings.baseColor = hex;
        syncingBaseColor = true;
        baseColorPicker?.setValue(hex);
        syncingBaseColor = false;
        await save();
      });
      text.inputEl.addClass("vah-rgb-input");
    });
    new import_obsidian10.Setting(containerEl).setName("Empty square color").setDesc(
      "Color for days without activity, as RGB or hex. Leave blank to use the theme default."
    ).addText((text) => {
      text.setPlaceholder("theme default").setValue(
        this.plugin.settings.emptyColor ? hexToRgbString(this.plugin.settings.emptyColor) : ""
      ).onChange(async (value) => {
        if (!value.trim()) {
          this.plugin.settings.emptyColor = "";
          await save();
          return;
        }
        const hex = parseColorInput(value);
        if (!hex) return;
        this.plugin.settings.emptyColor = hex;
        await save();
      });
      text.inputEl.addClass("vah-rgb-input");
    });
    new import_obsidian10.Setting(containerEl).setName("Metric").setDesc(
      "What a day's intensity is based on: how many distinct notes you touched, or the total number of edits."
    ).addDropdown(
      (dd) => dd.addOption("files", "Unique notes per day").addOption("edits", "Total edits per day").setValue(this.plugin.settings.metric).onChange(async (value) => {
        this.plugin.settings.metric = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Intensity thresholds").setDesc(
      "Four ascending numbers, comma separated. Example with '1, 3, 6, 10': 1-2 -> lightest, 3-5 -> light, 6-9 -> dark, 10+ -> darkest."
    ).addText(
      (text) => text.setPlaceholder("1, 3, 6, 10").setValue(this.plugin.settings.thresholds.join(", ")).onChange(async (value) => {
        const parts = value.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n > 0);
        if (parts.length === 4) {
          this.plugin.settings.thresholds = parts.sort((a, b) => a - b);
          await save();
        }
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Weeks to show").setDesc("Width of the heatmap in weeks (26 = half a year, 53 = a full year).").addSlider(
      (slider) => slider.setLimits(8, 53, 1).setValue(this.plugin.settings.weeksToShow).onChange(async (value) => {
        this.plugin.settings.weeksToShow = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Week starts on").addDropdown(
      (dd) => dd.addOption("1", "Monday").addOption("0", "Sunday").setValue(String(this.plugin.settings.firstDayOfWeek)).onChange(async (value) => {
        this.plugin.settings.firstDayOfWeek = parseInt(value, 10);
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Panel theme").setHeading();
    new import_obsidian10.Setting(containerEl).setName("Backdrop image or video").setDesc(
      "Vault path (e.g. assets/wall.png or clips/loop.mp4) or an https:// URL. Images (PNG/JPG/GIF/WebP) and auto-looping muted videos (MP4/WebM) are supported. Leave blank for none."
    ).addText(
      (text) => text.setPlaceholder("assets/backdrop.mp4").setValue(this.plugin.settings.backdropPath).onChange(async (value) => {
        this.plugin.settings.backdropPath = value.trim();
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Backdrop dim").setDesc("Darkens the backdrop so the heatmap stays readable.").addSlider(
      (slider) => slider.setLimits(0, 90, 5).setValue(Math.round(this.plugin.settings.backdropDim * 100)).onChange(async (value) => {
        this.plugin.settings.backdropDim = value / 100;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Backdrop blur").setDesc("Blur radius in pixels applied to the backdrop.").addSlider(
      (slider) => slider.setLimits(0, 20, 1).setValue(this.plugin.settings.backdropBlur).onChange(async (value) => {
        this.plugin.settings.backdropBlur = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Panel text color").setDesc(
      "Overrides the panel's text color only (RGB or hex). Leave blank for the theme default."
    ).addText((text) => {
      text.setPlaceholder("theme default").setValue(
        this.plugin.settings.panelTextColor ? hexToRgbString(this.plugin.settings.panelTextColor) : ""
      ).onChange(async (value) => {
        if (!value.trim()) {
          this.plugin.settings.panelTextColor = "";
          await save();
          return;
        }
        const hex = parseColorInput(value);
        if (!hex) return;
        this.plugin.settings.panelTextColor = hex;
        await save();
      });
      text.inputEl.addClass("vah-rgb-input");
    });
    new import_obsidian10.Setting(containerEl).setName("Panel background color").setDesc(
      "Overrides the panel's background only (RGB or hex). Leave blank for the theme default."
    ).addText((text) => {
      text.setPlaceholder("theme default").setValue(
        this.plugin.settings.panelBgColor ? hexToRgbString(this.plugin.settings.panelBgColor) : ""
      ).onChange(async (value) => {
        if (!value.trim()) {
          this.plugin.settings.panelBgColor = "";
          await save();
          return;
        }
        const hex = parseColorInput(value);
        if (!hex) return;
        this.plugin.settings.panelBgColor = hex;
        await save();
      });
      text.inputEl.addClass("vah-rgb-input");
    });
    new import_obsidian10.Setting(containerEl).setName("Tracking").setHeading();
    new import_obsidian10.Setting(containerEl).setName("Excluded folders").setDesc(
      "Folders that should never count as activity (e.g. templates). One folder path per line."
    ).addTextArea(
      (text) => text.setPlaceholder("templates\narchive/old").setValue(this.plugin.settings.excludeFolders.join("\n")).onChange(async (value) => {
        this.plugin.settings.excludeFolders = value.split("\n").map((s) => s.trim().replace(/^\/+|\/+$/g, "")).filter((s) => s.length > 0);
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Daily reflection notes").setHeading();
    new import_obsidian10.Setting(containerEl).setName("Reflection folder").setDesc(
      "Folder where daily reflection notes are created when you right-click a square. Leave blank for the vault root."
    ).addText(
      (text) => text.setPlaceholder("Daily reflection").setValue(this.plugin.settings.reflectionFolder).onChange(async (value) => {
        this.plugin.settings.reflectionFolder = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Note name format").setDesc(
      `Date format for the note file name (moment.js syntax). "YYYY-MM-DD" -> ${momentFn().format(
        "YYYY-MM-DD"
      )}.md`
    ).addText(
      (text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.dailyNoteFormat).onChange(async (value) => {
        this.plugin.settings.dailyNoteFormat = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Tasks heading").setDesc(
      'Heading the task is inserted under, e.g. "## Tasks". Created if missing. Leave blank to append tasks at the end of the note.'
    ).addText(
      (text) => text.setPlaceholder("## Tasks").setValue(this.plugin.settings.taskHeading).onChange(async (value) => {
        this.plugin.settings.taskHeading = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Day detail").setHeading();
    new import_obsidian10.Setting(containerEl).setName("Show tasks").setDesc(
      "To Do-style task list for the selected day, backed by its daily reflection note."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showTasks).onChange(async (value) => {
        this.plugin.settings.showTasks = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Notes edited: path display").setDesc(
      "Show just the file name (cleaner) or the full folder path in the 'Notes edited' list. You can also flip this with the button on the list itself."
    ).addDropdown(
      (dd) => dd.addOption("name", "File name only").addOption("full", "Full folder path").setValue(this.plugin.settings.notesPathDisplay).onChange(async (value) => {
        this.plugin.settings.notesPathDisplay = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Show edit timeline").setDesc(
      "Chronological trail of when each note was edited that day and by how much."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showTimeline).onChange(async (value) => {
        this.plugin.settings.showTimeline = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Timeline session gap").setDesc(
      "Saves of the same note within this many minutes merge into one timeline entry."
    ).addSlider(
      (slider) => slider.setLimits(5, 60, 5).setValue(this.plugin.settings.sessionGapMinutes).onChange(async (value) => {
        this.plugin.settings.sessionGapMinutes = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("AI summaries & notifications").setHeading();
    new import_obsidian10.Setting(containerEl).setName("Device name").setDesc("A local label used to identify this device in synchronized timelines.").addText(
      (text) => text.setPlaceholder("Obsidian device").setValue(this.plugin.sync.deviceName).onChange((value) => this.plugin.setDeviceName(value))
    );
    new import_obsidian10.Setting(containerEl).setName("Automation device").setDesc(
      "Only one device runs automatic summaries, preventing duplicate API requests."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.isAutomationDevice()).onChange((value) => {
        this.plugin.setAutomationDevice(value ? this.plugin.sync.deviceId : "");
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Provider").setDesc("Which API the weekly/monthly writing summaries are generated with.").addDropdown(
      (dd) => dd.addOption("anthropic", "Anthropic (Claude)").addOption("openai", "OpenAI-compatible").setValue(this.plugin.settings.aiProvider).onChange(async (value) => {
        this.plugin.settings.aiProvider = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("API key").setDesc(
      "Stored securely on this device. Select an existing secret or create one."
    ).addComponent(
      (el) => new import_obsidian10.SecretComponent(this.app, el).setValue(this.plugin.settings.aiSecretId).onChange((value) => this.plugin.setAiSecretId(value))
    );
    new import_obsidian10.Setting(containerEl).setName("Model").setDesc("Blank uses the provider default (claude-sonnet-5 / gpt-4o-mini).").addText(
      (text) => text.setPlaceholder("claude-sonnet-5").setValue(this.plugin.settings.aiModel).onChange(async (value) => {
        this.plugin.settings.aiModel = value.trim();
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("API base URL").setDesc("Optional override for proxies or self-hosted gateways.").addText(
      (text) => text.setPlaceholder("https://api.anthropic.com").setValue(this.plugin.settings.aiBaseUrl).onChange(async (value) => {
        this.plugin.settings.aiBaseUrl = value.trim();
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Summary folder").setDesc("Where generated summary notes are saved.").addText(
      (text) => text.setPlaceholder("AI summaries").setValue(this.plugin.settings.aiSummaryFolder).onChange(async (value) => {
        this.plugin.settings.aiSummaryFolder = value;
        await save();
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Auto-summarize each week").setDesc("When a new week starts, the completed week is summarized automatically.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.aiAutoWeekly).onChange(async (value) => {
        this.plugin.settings.aiAutoWeekly = value;
        await save();
        if (value) this.plugin.setAutomationDevice(this.plugin.sync.deviceId);
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Auto-summarize each month").setDesc("When a new month starts, the completed month is summarized automatically.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.aiAutoMonthly).onChange(async (value) => {
        this.plugin.settings.aiAutoMonthly = value;
        await save();
        if (value) this.plugin.setAutomationDevice(this.plugin.sync.deviceId);
      })
    );
    new import_obsidian10.Setting(containerEl).setName("System notification").setDesc(
      "Show a desktop notification or an in-app mobile notice when a summary is ready."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.notifyDesktop).onChange((value) => {
        this.plugin.setLocalNotificationEnabled(value);
      })
    );
    new import_obsidian10.Setting(containerEl).setName("Phone notification webhook").setDesc(
      "Securely stored POST endpoint pinged when a summary is ready, such as a private ntfy topic."
    ).addComponent(
      (el) => new import_obsidian10.SecretComponent(this.app, el).setValue(this.plugin.settings.notifySecretId).onChange((value) => this.plugin.setNotificationSecretId(value))
    );
    new import_obsidian10.Setting(containerEl).setName("Run now").setDesc("Generate a summary of the current period immediately.").addButton(
      (btn) => btn.setButtonText("This week").onClick(() => {
        const start = this.plugin.weekStartOf(/* @__PURE__ */ new Date());
        void this.plugin.summarizePeriod(
          toDateKey(start),
          toDateKey(startOfToday()),
          "Weekly",
          `Weekly summary ${toDateKey(start)}`
        );
      })
    ).addButton(
      (btn) => btn.setButtonText("This month").onClick(() => {
        const today = startOfToday();
        const monthId = `${today.getFullYear()}-${String(
          today.getMonth() + 1
        ).padStart(2, "0")}`;
        void this.plugin.summarizePeriod(
          `${monthId}-01`,
          toDateKey(today),
          "Monthly",
          `Monthly summary ${monthId}`
        );
      })
    );
    new import_obsidian10.Setting(containerEl).setName("History").setHeading();
    new import_obsidian10.Setting(containerEl).setName("Backfill from existing notes").setDesc(
      "Seed the heatmap from every note's created and last-modified dates. Safe to run repeatedly - it never overwrites live tracking data."
    ).addButton(
      (btn) => btn.setButtonText("Backfill").onClick(() => this.plugin.backfillFromFileStats())
    );
    new import_obsidian10.Setting(containerEl).setName("Clear all history").setDesc("Deletes every recorded day. This cannot be undone.").addButton(
      (btn) => btn.setButtonText("Clear").setDestructive().onClick(() => {
        new ConfirmClearHistoryModal(
          this.app,
          () => this.plugin.clearHistory()
        ).open();
      })
    );
  }
};

// src/main.ts
var VaultActivityHeatmapPlugin = class extends import_obsidian11.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.activity = { days: {} };
    this.selectedDay = toDateKey(/* @__PURE__ */ new Date());
    this.sync = new SyncService(this, new VaultSyncTransport(this));
    this.activityService = new ActivityService(this);
    this.dailyNotes = new DailyNotesService(this);
    this.aiSummary = new AiSummaryService(this);
    this.notifications = new NotificationService(this);
  }
  async onload() {
    await this.sync.start();
    this.registerView(VIEW_TYPE_HEATMAP, (leaf) => new HeatmapView(leaf, this));
    this.addRibbonIcon("calendar-check", "Open activity heatmap", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-heatmap",
      name: "Open activity heatmap",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "backfill-history",
      name: "Backfill history from existing file dates",
      callback: () => this.backfillFromFileStats()
    });
    this.addCommand({
      id: "add-task-today",
      name: "Add task to today's daily reflection",
      callback: () => {
        new AddTaskModal(this.app, toDateKey(/* @__PURE__ */ new Date()), (text) => {
          void this.addTaskToDailyReflection(toDateKey(/* @__PURE__ */ new Date()), text);
        }).open();
      }
    });
    this.addCommand({
      id: "ai-summarize-week",
      name: "AI summary: this week (so far)",
      callback: () => {
        const start = this.weekStartOf(/* @__PURE__ */ new Date());
        void this.summarizePeriod(
          toDateKey(start),
          toDateKey(startOfToday()),
          "Weekly",
          `Weekly summary ${toDateKey(start)}`
        );
      }
    });
    this.addCommand({
      id: "ai-summarize-month",
      name: "AI summary: this month (so far)",
      callback: () => {
        const today = startOfToday();
        const monthId = `${today.getFullYear()}-${String(
          today.getMonth() + 1
        ).padStart(2, "0")}`;
        void this.summarizePeriod(
          `${monthId}-01`,
          toDateKey(today),
          "Monthly",
          `Monthly summary ${monthId}`
        );
      }
    });
    this.addSettingTab(new HeatmapSettingTab(this.app, this));
    this.registerDomEvent(activeDocument, "visibilitychange", () => {
      if (activeDocument.visibilityState === "hidden") void this.sync.flush();
      else void this.sync.refreshFromDisk();
    });
    this.app.workspace.onLayoutReady(() => {
      this.activityService.primeLastSizes();
      this.registerEvent(
        this.app.workspace.on("editor-change", (editor, info) => {
          if (info.file) this.activityService.recordEditorChange(info.file, editor.getValue());
        })
      );
      this.registerEvent(
        this.app.vault.on("rename", (f, oldPath) => this.migratePath(f, oldPath))
      );
      window.setTimeout(() => void this.maybeAutoSummarize(), 3e4);
      this.registerInterval(
        window.setInterval(() => void this.maybeAutoSummarize(), 60 * 60 * 1e3)
      );
    });
  }
  onunload() {
    this.activityService.stop();
    void this.sync.stop();
  }
  onExternalSettingsChange() {
    return this.sync.refreshFromDisk();
  }
  async persist() {
    await this.sync.flush();
  }
  saveSettings() {
    this.sync.updateSharedSettings(this.settings);
  }
  setLocalFolderFilter(folder) {
    this.sync.updateLocalSettings({ lastFolderFilter: folder });
  }
  setLocalNotificationEnabled(enabled) {
    this.sync.updateLocalSettings({ notifyDesktop: enabled });
  }
  setDeviceName(name) {
    this.sync.updateLocalSettings({ deviceName: name.trim() || "Obsidian device" });
  }
  setAiSecretId(id) {
    this.sync.updateLocalSettings({
      aiSecretId: /^[a-z0-9-]+$/.test(id) ? id : DEFAULT_SETTINGS.aiSecretId
    });
  }
  setNotificationSecretId(id) {
    this.sync.updateLocalSettings({
      notifySecretId: /^[a-z0-9-]+$/.test(id) ? id : DEFAULT_SETTINGS.notifySecretId
    });
  }
  setSelectedDay(dateKey) {
    this.sync.setSelectedDay(dateKey);
  }
  setAutomationDevice(deviceId) {
    this.sync.setAutomationDevice(deviceId);
  }
  isAutomationDevice() {
    return this.sync.automationDeviceId === this.sync.deviceId;
  }
  getAiApiKey() {
    const id = this.settings.aiSecretId.trim();
    if (!/^[a-z0-9-]+$/.test(id)) return "";
    return this.app.secretStorage.getSecret(id) ?? "";
  }
  getNotificationWebhook() {
    const id = this.settings.notifySecretId.trim();
    if (!/^[a-z0-9-]+$/.test(id)) return "";
    return this.app.secretStorage.getSecret(id) ?? "";
  }
  recordActivity(file, isCreate = false) {
    this.activityService.recordActivity(file, isCreate);
  }
  migratePath(file, oldPath) {
    this.activityService.migratePath(file, oldPath);
  }
  backfillFromFileStats() {
    this.activityService.backfillFromFileStats();
  }
  clearHistory() {
    this.activityService.clearHistory();
  }
  dailyNotePath(dateKey) {
    return this.dailyNotes.dailyNotePath(dateKey);
  }
  async addTaskToDailyReflection(dateKey, taskText) {
    await this.dailyNotes.addTaskToDailyReflection(dateKey, taskText);
  }
  async openDailyReflection(dateKey) {
    await this.dailyNotes.openDailyReflection(dateKey);
  }
  async readDailyTasks(dateKey) {
    return this.dailyNotes.readDailyTasks(dateKey);
  }
  async toggleTask(file, task, done) {
    await this.dailyNotes.toggleTask(file, task, done);
  }
  weekStartOf(date) {
    return weekStartOf(date, this.settings.firstDayOfWeek);
  }
  async maybeAutoSummarize() {
    await this.aiSummary.maybeAutoSummarize();
  }
  async summarizePeriod(startKey, endKey, label, noteName) {
    await this.aiSummary.summarizePeriod(startKey, endKey, label, noteName);
  }
  /** Resolve a backdrop setting to a loadable URL (vault file or https). */
  resolveBackdropUrl(setting) {
    const s = setting.trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    const f = this.app.vault.getAbstractFileByPath((0, import_obsidian11.normalizePath)(s));
    if (f instanceof import_obsidian11.TFile) return this.app.vault.getResourcePath(f);
    return null;
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEATMAP);
    const existingLeaf = import_obsidian11.Platform.isPhone ? existing.find((leaf2) => leaf2.getRoot() === this.app.workspace.rootSplit) : existing[0];
    if (existingLeaf) {
      await this.app.workspace.revealLeaf(existingLeaf);
      return;
    }
    const leaf = import_obsidian11.Platform.isPhone ? this.app.workspace.getLeaf("tab") : this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new import_obsidian11.Notice("Heatmap: could not open the activity view.");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_HEATMAP, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  renderAllViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HEATMAP)) {
      if (leaf.view instanceof HeatmapView) leaf.view.render();
    }
  }
  countForDay(key, folder) {
    return this.activityService.countForDay(key, folder);
  }
  filesForDay(key, folder) {
    return this.activityService.filesForDay(key, folder);
  }
  intensityLevel(count) {
    return this.activityService.intensityLevel(count);
  }
  allFolderPaths() {
    return this.activityService.allFolderPaths();
  }
};
