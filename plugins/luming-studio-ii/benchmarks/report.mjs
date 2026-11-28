import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const renderer = fileURLToPath(
  new URL("../../../.codex/skills/delivery-report/scripts/render-report.mjs", import.meta.url),
);
const title = "白板性能基准";
const format = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  dateStyle: "medium",
  timeStyle: "medium",
});
const scopes = { normal: "常用视口", overview: "整板视角", retained: "保留历史" };
const measurements = {
  "cold-paint": "新浏览器上下文 · 首绘",
  "cold-ready": "新浏览器上下文 · 可操作",
  "warm-paint": "工作台重开 · 首绘",
  "warm-ready": "工作台重开 · 可操作",
  "drag-latency": "输入到对象首次位移",
  "drag-frames": "拖动帧间隔",
  "pan-latency": "输入到视口首次位移",
  "pan-frames": "平移帧间隔",
  "zoom-latency": "输入到缩放首次变化",
  "zoom-frames": "缩放帧间隔",
  "save-ui": "松手到界面显示「已保存」",
  "save-http": "松手到保存响应结束",
  "save-retained-move": "200 版起步 · 移动 HTTP",
  "save-retained-text": "200 版起步 · 改字 HTTP",
  "save-retained-add": "200 版起步 · 新增 HTTP",
};
const groups = [
  [
    "开板",
    /^(cold|warm)-/u,
    "从工作台点击作品开始，分别记录第一个对象进入可见区域的帧和目标可命中的时刻。",
  ],
  ["拖动", /^drag-/u, "移动对象时记录可见位移及动作窗口内的浏览器帧回调间隔。"],
  ["平移", /^pan-/u, "移动相机时记录可见位移及动作窗口内的帧回调间隔。"],
  ["缩放", /^zoom-/u, "缩放时记录可见变化及动作窗口内的帧回调间隔。"],
  [
    "保存",
    /^save-/u,
    "松手到界面确认和网络响应分别计时。200 版组直接测 HTTP 写入。每轮回读检查实际提交。",
  ],
];
const environmentLabels = {
  gitRevision: "工作区提交",
  os: "系统",
  cpu: "处理器",
  logicalCpus: "逻辑核心数",
  ramGiB: "总内存（GiB）",
  node: "Node.js",
  chromium: "Chromium 版本",
  channel: "浏览器通道",
  viewport: "视口",
  dpr: "设备像素比",
  headless: "无头模式",
  timeoutMs: "超时预算（ms）",
  workers: "工作进程",
  roundsPerCase: "每个场景的计时轮次",
  warmupsPerCase: "每个场景的预热轮次",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function number(value) {
  if (value === "Infinity") {
    return "∞";
  }
  if (Number.isFinite(value)) {
    return format.format(value);
  }

  return "—";
}

function completed(summary) {
  return (
    summary?.attempts > 0 &&
    summary.validAttempts === summary.attempts &&
    summary.attempts === (summary.planned ?? summary.attempts)
  );
}

function p95Difference({ initial, ii }) {
  if (!completed(initial) || !completed(ii)) {
    return null;
  }
  if (!Number.isFinite(initial.p95) || !Number.isFinite(ii.p95)) {
    return null;
  }

  return Math.round((ii.p95 - initial.p95) * 100) / 100;
}

function frameBudgetSummary(rows) {
  const budgetMs = 50;
  const frames = rows.filter(({ metric, ii }) => metric.endsWith("-frames") && completed(ii));
  if (!frames.length) {
    return "";
  }

  const within = frames.filter(({ ii }) => ii.p95 <= budgetMs).length;
  const overview = frames.filter(({ profile, view }) => profile === "near" && view === "overview");
  const portions = overview.map(({ metric, ii }) => {
    const percent = (ii.over50 / ii.samples) * 100;

    return `${measurements[metric].replace("帧间隔", "")} ${number(percent)}%`;
  });
  const overviewText = portions.length
    ? `2,000 对象整板概览的慢帧占比为${portions.join("、")}。`
    : "";

  return `按 20 Hz 的 50 ms 帧预算，V2 有 ${within}/${frames.length} 组帧间隔 p95 在预算内。${overviewText}`;
}

function comparison(record) {
  const difference = p95Difference(record);
  if (difference === null) {
    return "—";
  }

  const sign = difference > 0 ? "+" : "";
  const css = { "-1": "comparison-lower", 1: "comparison-higher" }[Math.sign(difference)] ?? "";
  const baseline = record.initial.p95;
  const percent = difference === 0 ? 0 : ((record.ii.p95 - baseline) / baseline) * 100;
  const fraction = baseline > 0 ? ` · ${sign}${number(percent)}%` : "";

  return `<span class="${css}">${sign}${number(difference)} ms${fraction}</span>`;
}

function measurementCell(summary, label, frames) {
  if (!summary) {
    return `<td class="percentiles" data-edition="${label}">—</td>`;
  }

  const { attempts, validAttempts, failures, timeouts, samples, p50, p95, p99, over50, worst } =
    summary;
  const share = samples > 0 ? (over50 / samples) * 100 : 0;
  const sampleNote = frames
    ? `${number(samples)} 帧 · ${number(over50)} 帧超过 50 ms（${number(share)}%）`
    : `${number(samples)} 个样本`;
  const longest = worst == null ? "" : ` · 最长 ${number(worst)} ms`;

  return `<td class="percentiles" data-edition="${label}">
    ${number(p50)} / <strong>${number(p95)}</strong> / ${number(p99)}
    <small>${number(validAttempts)}/${number(attempts)} 次有效 · ${number(failures)} 失败 · ${number(timeouts)} 超时</small>
    <small>${sampleNote}${longest}</small>
  </td>`;
}

function profileName(profile, fixtures) {
  const fixture = fixtures.find((sample) => sample.profile === profile);
  if (fixture) {
    return `${number(fixture.objects)} 对象`;
  }

  return String(profile);
}

function locationName(profile, view, fixtures) {
  return `${profileName(profile, fixtures)} · ${scopes[view] ?? view}`;
}

function displayTable(rows, fixtures, stableRuntime) {
  if (!rows.length) {
    return "<p>本次运行无此项采样。</p>";
  }

  const body = rows.map((record) => {
    const { metric, profile, view, initial, ii } = record;
    const frames = metric.endsWith("-frames");
    const name = escapeHtml(measurements[metric] ?? metric);
    const location = escapeHtml(locationName(profile, view, fixtures));
    const difference = stableRuntime ? comparison(record) : "—";

    return `<tr><th scope="row">${name}<small>${location}</small></th>
      ${measurementCell(initial, "V1", frames)}${measurementCell(ii, "V2", frames)}
      <td class="comparison">${difference}</td></tr>`;
  });

  return `<table class="measurement"><thead><tr><th scope="col">观测项</th>
    <th scope="col">V1 · p50 / p95 / p99（ms）</th><th scope="col">V2 · p50 / p95 / p99（ms）</th>
    <th scope="col">p95 变化</th></tr></thead><tbody>${body.join("\n")}</tbody></table>`;
}

function fullyObserved(row, hasInitial) {
  return completed(row.ii) && (!hasInitial || completed(row.initial));
}

function summarize(results) {
  const hasInitial = results.editions.some((edition) => edition.id === "initial");
  const successful = results.rows.filter((row) => fullyObserved(row, hasInitial));
  const kind = results.mode === "smoke" ? "冒烟运行" : "基线运行";
  const edition = hasInitial ? "V1 与 V2 同机对照" : "V2 独立测量";
  const scope = `${kind} · ${edition}，${successful.length}/${results.rows.length} 组观测完成全部尝试。`;
  if (results.runtimeVerified === false) {
    return `${scope}运行前后的运行包指纹不同，结果需要复测。`;
  }

  const differences = successful.map(p95Difference).filter(Number.isFinite);
  const lower = differences.filter((value) => value < 0).length;
  const higher = differences.filter((value) => value > 0).length;
  const same = differences.length - lower - higher;
  const direction = differences.length
    ? `按报表精度，V2 的 p95 有 ${lower} 组较短、${higher} 组较长、${same} 组相同。`
    : "";

  return `${scope}${frameBudgetSummary(results.rows)}${direction}`;
}

function stringify(value) {
  if (value === true) {
    return "是";
  }
  if (value === false) {
    return "否";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function verificationRows(results) {
  const { startedAt, finishedAt, environment, editions, fixtures, runtimeVerified } = results;
  const timestamps = [startedAt, finishedAt].map((stamp) => dateFormat.format(new Date(stamp)));
  const environmentItems = Object.entries(environment).flatMap(([key, value]) => {
    if (Object.hasOwn(environmentLabels, key) && value !== undefined) {
      return [{ label: environmentLabels[key], value: stringify(value) }];
    }

    return [];
  });
  const packageItems = editions.map(({ name, version, packageSha256 }) => ({
    label: `${name} 运行包`,
    value: `${version} · SHA-256 ${packageSha256}`,
  }));
  const fixtureItems = fixtures.map(
    ({ profile, historyVersions, archiveSha256, archiveBytes }) => ({
      label: `${profileName(profile, fixtures)} · ${historyVersions ?? 1} 版 · 白板包`,
      value: `${number(archiveBytes)} 字节 · SHA-256 ${archiveSha256}`,
    }),
  );

  const rows = [
    { label: "执行时间（中国标准时间）", value: timestamps.join(" ～ ") },
    ...environmentItems,
    ...packageItems,
    ...fixtureItems,
  ];

  if (typeof runtimeVerified === "boolean") {
    rows.push({ label: "运行前后指纹一致", value: stringify(runtimeVerified) });
  }
  return rows;
}

export async function readBenchmarkScreenshot(
  directory,
  { edition, profile, view, file },
  fixtures,
  label,
) {
  const root = await realpath(directory);
  const path = await realpath(resolve(root, file));
  const child = relative(root, path);
  if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) {
    throw new Error("Benchmark screenshot is outside the report directory.");
  }

  const bytes = await readFile(path);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Unsupported benchmark screenshot: ${file}`);
  }

  const name = label ?? (edition === "initial" ? "V1" : "V2");

  return {
    path,
    label: `${name} · ${locationName(profile, view, fixtures)}`,
    caption: "同轮操作结束后采集。",
    uri: `data:image/png;base64,${bytes.toString("base64")}`,
  };
}

function prepareSections(results, pictures) {
  const hasInitial = results.editions.some((edition) => edition.id === "initial");
  const stableRuntime = results.runtimeVerified !== false;
  const sections = groups.map(([name, pattern, description], index) => {
    const rows = results.rows.filter((row) => pattern.test(row.metric));
    const allCompleted = rows.length > 0 && rows.every((row) => fullyObserved(row, hasInitial));
    const observed = stableRuntime && allCompleted;
    const data = displayTable(rows, results.fixtures, stableRuntime);

    return {
      title: name,
      summary: [description, `BENCHMARK_MEASUREMENTS_${index}`],
      status: observed ? "done" : "partial",
      statusText: observed ? "已采集" : "样本需复核",
      data,
    };
  });

  if (pictures.length) {
    sections.push({
      title: "实测截图",
      summary: "截图记录实际画面和测试场景，采集耗时不计入测量。",
      status: "done",
      statusText: `${pictures.length} 张`,
      images: pictures,
    });
  }
  return sections;
}

async function rendererAvailable() {
  try {
    await access(renderer);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function useDeliveryTemplate(data, directory, output, css, links) {
  const input = join(directory, `.benchmark-report-input-${randomUUID()}.json`);
  const sections = data.sections.map(({ title: name, summary, status, statusText, images }) => ({
    title: name,
    summary,
    status,
    statusText,
    images: images?.map(({ path, label, caption }) => ({ path, label, caption })),
  }));

  try {
    await writeFile(input, JSON.stringify({ ...data, sections }), { flag: "wx" });
    await runFile(process.execPath, [renderer, input, output]);
    const template = await readFile(output, "utf8");
    const withStyles = template.replace("</style>", () => `${css}</style>`);
    const withLink = withStyles.replace("<nav ", () => `${links}<nav `);

    return data.sections.reduce((html, section, index) => {
      if (!section.data) {
        return html;
      }

      const placeholder = `<p>BENCHMARK_MEASUREMENTS_${index}</p>`;
      if (!html.includes(placeholder)) {
        throw new Error("Delivery report template omitted a benchmark measurements placeholder.");
      }

      return html.replace(placeholder, () => section.data);
    }, withLink);
  } finally {
    await rm(input, { force: true });
  }
}

const fallbackStyles = `
body{margin:0;background:#f5f5f3;color:var(--ink);font:15px/1.6 system-ui,sans-serif}
main{max-width:1100px;margin:auto;padding:28px 18px}a,summary{color:var(--accent)}
nav{display:flex;gap:12px;flex-wrap:wrap}section{padding:20px;margin:16px 0;background:#fff;border:1px solid var(--line);border-radius:10px}
h1{font-size:30px}h2{font-size:21px}small,footer,figcaption{color:var(--muted)}
dd{margin:0 0 8px;overflow-wrap:anywhere}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr));gap:14px}
figure{margin:0;min-width:0}.picture{display:block;width:100%;padding:0;border:1px solid var(--line);border-radius:6px;background:#f7f8f9;cursor:zoom-in}
.picture img{display:block;width:100%;height:auto}dialog{max-width:94vw;max-height:94vh}dialog::backdrop{background:#000b}
dialog img{display:block;max-width:90vw;height:auto}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
`;
const fallbackScript = `
const viewer = document.querySelector('dialog');
const image = viewer.querySelector('img');
let opener;
document.querySelectorAll('.picture').forEach((button) => button.addEventListener('click', () => {
  opener = button;
  const source = button.querySelector('img');
  image.src = source.src;
  image.alt = source.alt;
  viewer.showModal();
}));
viewer.querySelector('button').addEventListener('click', () => viewer.close());
viewer.addEventListener('close', () => opener?.focus());
`;

function fallbackGallery(images) {
  const figures = images.map(({ label, caption, uri }) => {
    const name = escapeHtml(label);

    return `<figure><button class="picture" type="button" aria-label="放大查看 ${name}">
      <img src="${uri}" alt="${name}" loading="lazy"></button>
      <figcaption><b>${name}</b> · ${escapeHtml(caption)}</figcaption></figure>`;
  });

  return `<div class="shots">${figures.join("\n")}</div>`;
}

function standaloneReport(data, css, links) {
  const navigation = data.sections.map(
    ({ title: name }, index) => `<a href="#item-${index + 1}">${escapeHtml(name)}</a>`,
  );
  const sections = data.sections.map((section, index) => {
    const description = Array.isArray(section.summary) ? section.summary[0] : section.summary;

    return `<section id="item-${index + 1}"><header><h2>${escapeHtml(section.title)}</h2>
      <small>${escapeHtml(section.statusText)}</small></header><p>${escapeHtml(description)}</p>
      ${section.data ?? fallbackGallery(section.images ?? [])}</section>`;
  });
  const details = data.verification.rows.map(
    ({ label, value }) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
  );
  const notes = data.verification.summary.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`);
  const scriptHash = createHash("sha256").update(fallbackScript).digest("base64");
  const heading = escapeHtml(data.title);
  const project = escapeHtml(data.project);

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; base-uri 'none'">
    <title>${heading} · ${project}</title><style>${fallbackStyles}${css}</style></head><body><main>
    <h1>${heading}</h1><p>${escapeHtml(data.summary)}</p><p>${escapeHtml(data.delivery)}</p>
    ${links}<nav aria-label="报告导航">${navigation.join("")}</nav>
    ${sections.join("\n")}
    <section><h2>测量条件与范围</h2>${notes.join("\n")}
    <details><summary>查看运行环境和指纹</summary><dl>${details.join("")}</dl></details></section>
    <footer>${escapeHtml(data.date)} · 本地离线报告</footer></main>
    <dialog aria-label="截图大图"><button type="button" autofocus>关闭</button><img alt=""></dialog>
    <script>${fallbackScript}</script></body></html>`;
}

function localLinks(sources) {
  const links = sources.map(({ filename, label }) => {
    if (!/^[a-z\d-]+\.json$/u.test(filename)) {
      throw new Error("Benchmark evidence links require local JSON files in the report directory.");
    }

    return `<a href="${filename}">${escapeHtml(label)}</a>`;
  });

  return `<p>${links.join(" · ")}</p>`;
}

export async function writeBenchmarkPage(data, directory, sources, styles = "") {
  const output = join(directory, "report.html");
  const css = (await readFile(new URL("./report.css", import.meta.url), "utf8")) + styles;
  const links = localLinks(sources);
  const html = (await rendererAvailable())
    ? await useDeliveryTemplate(data, directory, output, css, links)
    : standaloneReport(data, css, links);

  await writeFile(output, html, "utf8");
  return output;
}

export async function writeBenchmarkReport(results, directory) {
  const pictures = await Promise.all(
    results.screenshots.map((entry) => readBenchmarkScreenshot(directory, entry, results.fixtures)),
  );
  const data = {
    project: "Luming Studio II",
    title,
    summary: summarize(results),
    delivery: "耗时越低越好。差值以 V2 减 V1 计算，需要两边都完整采样且运行前后指纹一致。",
    sections: prepareSections(results, pictures),
    verification: { summary: results.notes, rows: verificationRows(results) },
    date: dateFormat.format(new Date(results.finishedAt)),
  };

  return writeBenchmarkPage(data, directory, [{ filename: "results.json", label: "查看原始数据" }]);
}

export { escapeHtml, number as reportNumber };
