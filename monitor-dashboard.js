const axios = require("axios");
const xml2js = require("xml2js");
const fs = require("fs");

// --- CONFIGURATION ---
// NOTE: For GitHub Actions, we will use an Environment Variable.
// If running locally, it falls back to your hardcoded URL.
const DISCORD_WEBHOOK_URL =
  process.env.DISCORD_WEBHOOK_URL ||
  "https://discord.com/api/webhooks/1460171595845996554/T0KPIzJsSv33CqBu3DB9rktMqu9BININB76hywkDP_J9cnQ1-hsiJeAaOs3VaNhuGWM3";
const APP_VERSION = "3.0.0 (Auto)";

// CLEAR THIS LIST if you don't have real maintenance!
const SCHEDULED_MAINTENANCE = [];

const SITEMAPS = [
  "https://www.babyorgano.com/sitemap_products_1.xml?from=7211743150269&to=8175189065917",
  "https://www.babyorgano.com/sitemap_pages_1.xml?from=88326439101&to=125035479229",
  "https://www.babyorgano.com/sitemap_collections_1.xml?from=285188980925&to=325341544637",
];

const DATABASE_FILE = "database.json";

// --- TEST MODE CHECK ---
if (process.argv.includes("--test")) {
  console.log("🧪 Sending TEST Discord Alert...");
  sendDiscordAlert("TEST-PAGE", 500, "DOWN").then(() => {
    console.log("✅ Test Sent! Check your Discord.");
    process.exit(0);
  });
} else {
  // Normal Run
  let db = {};
  if (fs.existsSync(DATABASE_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DATABASE_FILE));
    } catch (e) {
      db = {};
    }
  }
  checkAllPages(db);
}

async function checkAllPages(db) {
  console.log(`🔍 Fetching URLs...`);
  let sitemapUrls = [];

  try {
    for (const sitemapUrl of SITEMAPS) {
      try {
        const { data } = await axios.get(sitemapUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(data);
        if (result.urlset && result.urlset.url) {
          sitemapUrls = [
            ...sitemapUrls,
            ...result.urlset.url.map((u) => u.loc[0]),
          ];
        }
      } catch (err) {
        console.log(`   ⚠️ Sitemap Error: ${sitemapUrl}`);
      }
    }

    const historyUrls = Object.keys(db);
    const allUrls = [...new Set([...sitemapUrls, ...historyUrls])];

    console.log(`✅ Checking ${allUrls.length} pages...`);
    const today = new Date().toISOString();

    for (const url of allUrls) {
      let status = 0;
      let duration = 0;
      const start = Date.now();

      try {
        const res = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        status = res.status;
        duration = Date.now() - start;
        process.stdout.write("•");
      } catch (err) {
        status = err.response?.status || 0;
        process.stdout.write("x");
      }

      const history = db[url] || [];
      const lastRun = history.length > 0 ? history[history.length - 1] : null;

      if (lastRun && lastRun.status === 200 && status !== 200)
        await sendDiscordAlert(url, status, "DOWN");
      if (lastRun && lastRun.status !== 200 && status === 200)
        await sendDiscordAlert(url, status, "RECOVERED");

      if (!db[url]) db[url] = [];
      db[url].push({ date: today, status: status, time: duration });
      if (db[url].length > 50) db[url].shift();
    }

    console.log("\n✅ Saving Data...");
    fs.writeFileSync(DATABASE_FILE, JSON.stringify(db, null, 2));
    generateFullApp(db);
  } catch (error) {
    console.error("Critical Error:", error.message);
  }
}

async function sendDiscordAlert(url, status, type) {
  if (!DISCORD_WEBHOOK_URL) return;
  const color = type === "DOWN" ? 15158332 : 3066993;
  const title = type === "DOWN" ? "🚨 Page Down!" : "✅ Page Recovered";
  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [
        {
          title: title,
          color: color,
          fields: [
            { name: "Product", value: url.split("/").pop() },
            { name: "Status", value: `${status}` },
          ],
        },
      ],
    });
  } catch (e) {
    console.log("Discord Error");
  }
}

function generateFullApp(database) {
  const urls = Object.keys(database);
  let up = 0,
    down = 0,
    avgTime = 0,
    totalTime = 0;
  let incidents = [];

  const monitorListHTML = urls
    .map((url) => {
      const history = database[url];
      const lastRun = history[history.length - 1];
      if (lastRun.status === 200) up++;
      else down++;
      totalTime += lastRun.time || 0;
      history.forEach((entry) => {
        if (entry.status !== 200)
          incidents.push({ url: url, status: entry.status, date: entry.date });
      });

      let type = "Other";
      if (url.includes("/products/")) type = "Product";
      else if (url.includes("/collections/")) type = "Collection";
      else if (url.includes("/pages/")) type = "Page";

      const ticks = history
        .slice(-30)
        .map(
          (h) =>
            `<div class="tick ${h.status === 200 ? "up" : "down"}" title="${
              h.status
            }"></div>`
        )
        .join("");

      return `
        <div class="monitor-card ${
          lastRun.status === 200 ? "" : "down"
        }" data-type="${type.toLowerCase()}" data-status="${
        lastRun.status === 200 ? "up" : "down"
      }" data-name="${url.toLowerCase()}">
            <div style="flex:1">
                <span class="badge" style="background:#333; color:#ccc; font-size:10px; margin-bottom:5px; display:inline-block;">${type}</span>
                <div style="font-weight:600; margin-bottom:4px;">${url
                  .split("/")
                  .pop()
                  .replace(/-/g, " ")}</div>
                <div style="font-size:12px; color:var(--text-muted)">${url}</div>
            </div>
            <div class="m-history" style="margin:0 20px">${ticks}</div>
            <div class="badge ${
              lastRun.status === 200 ? "bg-blue" : "bg-red"
            }">${lastRun.status === 200 ? "OPERATIONAL" : "DOWN"}</div>
        </div>`;
    })
    .join("");

  avgTime = urls.length > 0 ? (totalTime / urls.length).toFixed(0) : 0;
  incidents.sort((a, b) => new Date(b.date) - new Date(a.date));

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>BabyOrgano Monitor Pro</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            :root { --bg-body: #0d1117; --bg-sidebar: #010409; --bg-card: #161b22; --border: #30363d; --text-main: #c9d1d9; --text-muted: #8b949e; --green: #238636; --red: #da3633; --blue: #58a6ff; }
            body.light-mode { --bg-body: #f6f8fa; --bg-sidebar: #ffffff; --bg-card: #ffffff; --border: #d0d7de; --text-main: #24292f; }
            * { box-sizing: border-box; }
            body { font-family: 'Inter', sans-serif; background: var(--bg-body); color: var(--text-main); margin: 0; display: flex; height: 100vh; overflow: hidden; }
            .sidebar { width: 260px; background: var(--bg-sidebar); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; flex-shrink: 0; }
            .nav-item { padding: 12px; margin-bottom:5px; border-radius: 6px; color: var(--text-muted); cursor: pointer; }
            .nav-item.active { background: #1f6feb33; color: var(--blue); border-left: 3px solid var(--blue); }
            .main { flex: 1; padding: 30px; overflow-y: auto; }
            .view-section { display: none; } .view-section.active { display: block; }
            .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: var(--bg-card); border: 1px solid var(--border); padding: 20px; border-radius: 8px; }
            .stat-value { font-size: 28px; font-weight: 700; }
            .monitor-list { display: grid; gap: 12px; }
            .monitor-card { background: var(--bg-card); border: 1px solid var(--border); padding: 15px 20px; border-radius: 8px; display: flex; align-items: center; }
            .monitor-card.down { border-left: 4px solid var(--red); }
            .m-history { display: flex; gap: 4px; height: 24px; align-items: flex-end; }
            .tick { width: 6px; height: 100%; border-radius: 2px; background: var(--border); opacity: 0.5; }
            .tick.up { background: #3fb950; opacity: 1; } .tick.down { background: #f85149; opacity: 1; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 10px; border-bottom: 1px solid var(--border); text-align: left; }
            .badge { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
            .bg-red { background: rgba(218, 54, 51, 0.2); color: var(--red); } .bg-blue { background: rgba(88, 166, 255, 0.2); color: var(--blue); }
            input { background: var(--bg-card); border: 1px solid var(--border); color: var(--text-main); padding: 10px; border-radius: 6px; }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <h2 style="margin:0 0 40px 0">⚡ Monitor</h2>
            <div class="nav-item active" onclick="switchTab('dashboard', this)">Dashboard</div>
            <div class="nav-item" onclick="switchTab('incidents', this)">Incidents</div>
            <div class="nav-item" onclick="switchTab('maintenance', this)">Maintenance</div>
            <div class="nav-item" onclick="switchTab('settings', this)">Settings</div>
        </div>
        <div class="main">
            <div id="dashboard" class="view-section active">
                <div style="display:flex; justify-content:space-between; margin-bottom:20px;">
                    <h2>Overview</h2>
                    <input type="text" id="s" placeholder="Search..." onkeyup="runSearch()">
                </div>
                <div class="stats-grid">
                    <div class="stat-card"><div>UP</div><div class="stat-value" style="color:#3fb950">${up}</div></div>
                    <div class="stat-card"><div>DOWN</div><div class="stat-value" style="color:#f85149">${down}</div></div>
                    <div class="stat-card"><div>PING</div><div class="stat-value">${avgTime}ms</div></div>
                    <div class="stat-card"><div>TOTAL</div><div class="stat-value">${
                      urls.length
                    }</div></div>
                </div>
                <div class="monitor-list">${monitorListHTML}</div>
            </div>
            <div id="incidents" class="view-section">
                <h2>Incidents</h2>
                <table><thead><tr><th>Date</th><th>URL</th><th>Status</th></tr></thead>
                <tbody>${incidents
                  .map(
                    (i) =>
                      `<tr><td>${new Date(
                        i.date
                      ).toLocaleString()}</td><td>${i.url
                        .split("/")
                        .pop()}</td><td><span class="badge bg-red">${
                        i.status
                      }</span></td></tr>`
                  )
                  .join("")}</tbody></table>
            </div>
            <div id="maintenance" class="view-section">
                <h2>Maintenance</h2>
                <table><thead><tr><th>Event</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>${SCHEDULED_MAINTENANCE.map(
                  (m) =>
                    `<tr><td>${m.title}</td><td>${m.date}</td><td><span class="badge bg-blue">${m.status}</span></td></tr>`
                ).join("")}</tbody></table>
            </div>
            <div id="settings" class="view-section">
                <h2>Settings</h2>
                <p>Version: ${APP_VERSION}</p>
                <button onclick="exportData()" style="padding:10px; background:#238636; color:white; border:none; border-radius:6px; cursor:pointer;">Export CSV</button>
            </div>
        </div>
        <script>
            function switchTab(id, btn) {
                document.querySelectorAll('.view-section').forEach(e => e.classList.remove('active'));
                document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
                document.getElementById(id).classList.add('active');
                btn.classList.add('active');
            }
            function runSearch() {
                const term = document.getElementById('s').value.toLowerCase();
                document.querySelectorAll('.monitor-card').forEach(c => {
                    c.style.display = c.dataset.name.includes(term) ? 'flex' : 'none';
                });
            }
            function exportData() {
                const d = ${JSON.stringify(incidents)};
                if(d.length === 0) { alert("No incidents to export!"); return; }
                let c = "Date,URL,Status\\n" + d.map(r => \`\${r.date},\${r.url},\${r.status}\`).join("\\n");
                const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURI(c); a.download = "incidents.csv"; a.click();
            }
        </script>
    </body>
    </html>`;
  fs.writeFileSync("dashboard.html", htmlContent);
  console.log("✅ App Generated!");
}
