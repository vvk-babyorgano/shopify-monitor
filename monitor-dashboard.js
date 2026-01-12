const axios = require("axios");
const xml2js = require("xml2js");
const fs = require("fs");

// --- CONFIGURATION ---
const DISCORD_WEBHOOK_URL =
  process.env.DISCORD_WEBHOOK_URL ||
  "https://discord.com/api/webhooks/1460171595845996554/T0KPIzJsSv33CqBu3DB9rktMqu9BININB76hywkDP_J9cnQ1-hsiJeAaOs3VaNhuGWM3";
const APP_VERSION = "3.1.0 (Ultimate)";

// MAINTENANCE SCHEDULE
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

    console.log("\n✅ Saving & Generating App...");
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
  } catch (e) {}
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

  // GENERATE THE ULTIMATE HTML
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>BabyOrgano Monitor Pro</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            :root { 
                --bg-body: #0d1117; --bg-sidebar: #010409; --bg-card: #161b22; 
                --border: #30363d; --text-main: #c9d1d9; --text-muted: #8b949e; 
                --green: #238636; --green-dim: rgba(35, 134, 54, 0.4);
                --red: #da3633; --red-dim: rgba(218, 54, 51, 0.4);
                --blue: #58a6ff; --blue-dim: rgba(88, 166, 255, 0.2);
            }
            body.light-mode {
                --bg-body: #f6f8fa; --bg-sidebar: #ffffff; --bg-card: #ffffff; 
                --border: #d0d7de; --text-main: #24292f; --text-muted: #57606a; 
            }
            * { box-sizing: border-box; }
            body { font-family: 'Inter', sans-serif; background: var(--bg-body); color: var(--text-main); margin: 0; display: flex; height: 100vh; overflow: hidden; transition: background 0.3s; }
            
            .sidebar { width: 260px; background: var(--bg-sidebar); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; flex-shrink: 0; }
            .logo { font-size: 20px; font-weight: 700; margin-bottom: 40px; display: flex; align-items: center; gap: 10px; }
            .nav-item { padding: 12px 15px; border-radius: 6px; color: var(--text-muted); cursor: pointer; transition: 0.2s; font-weight: 500; margin-bottom: 5px; }
            .nav-item:hover, .nav-item.active { background: var(--bg-card); color: var(--text-main); }
            .nav-item.active { border-left: 3px solid var(--green); background: var(--blue-dim); }
            
            .main { flex: 1; padding: 30px; overflow-y: auto; }
            .view-section { display: none; }
            .view-section.active { display: block; animation: fadeIn 0.3s; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

            .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
            .theme-toggle { background: transparent; border: 1px solid var(--border); color: var(--text-main); padding: 8px 12px; border-radius: 6px; cursor: pointer; }
            input[type="text"], input[type="date"] { background: var(--bg-card); border: 1px solid var(--border); color: var(--text-main); padding: 10px; border-radius: 6px; }

            .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: var(--bg-card); border: 1px solid var(--border); padding: 20px; border-radius: 8px; }
            .stat-value { font-size: 28px; font-weight: 700; margin-top: 10px; }
            .text-green { color: #3fb950; } .text-red { color: #f85149; }

            .monitor-list { display: grid; gap: 12px; }
            .monitor-card { background: var(--bg-card); border: 1px solid var(--border); padding: 15px 20px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; }
            .monitor-card.down { border-left: 4px solid var(--red); }
            .m-history { display: flex; gap: 4px; height: 24px; align-items: flex-end; }
            .tick { width: 6px; height: 100%; border-radius: 2px; background: var(--border); opacity: 0.5; }
            .tick.up { background: #3fb950; opacity: 1; }
            .tick.down { background: #f85149; opacity: 1; }

            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { text-align: left; color: var(--text-muted); padding: 10px; border-bottom: 1px solid var(--border); }
            td { padding: 15px 10px; border-bottom: 1px solid var(--border); }
            .badge { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
            .bg-red { background: var(--red-dim); color: var(--red); }
            .bg-blue { background: var(--blue-dim); color: var(--blue); }
            .btn { padding: 10px 20px; background: var(--green); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <div class="logo">⚡ BabyOrgano</div>
            <div class="nav-item active" onclick="switchTab('dashboard', this)">Dashboard</div>
            <div class="nav-item" onclick="switchTab('incidents', this)">Incidents</div>
            <div class="nav-item" onclick="switchTab('maintenance', this)">Maintenance</div>
            <div class="nav-item" style="margin-top: auto;" onclick="switchTab('settings', this)">Settings</div>
        </div>

        <div class="main">
            <div id="dashboard" class="view-section active">
                <div class="top-bar">
                    <h2>Overview</h2>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="searchInput" placeholder="Search pages..." onkeyup="runSearch()" style="width: 300px;">
                        <button class="theme-toggle" onclick="toggleTheme()">🌗 Theme</button>
                    </div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card"><div>UP</div><div class="stat-value text-green">${up}</div></div>
                    <div class="stat-card"><div>DOWN</div><div class="stat-value text-red">${down}</div></div>
                    <div class="stat-card"><div>AVG PING</div><div class="stat-value">${avgTime}ms</div></div>
                    <div class="stat-card"><div>TOTAL</div><div class="stat-value">${
                      urls.length
                    }</div></div>
                </div>

                <div class="monitor-list" id="monitorList">
                    ${monitorListHTML}
                </div>
            </div>

            <div id="incidents" class="view-section">
                <div class="top-bar">
                    <h2>Incident History</h2>
                    <input type="date" id="dateFilter" onchange="filterIncidentsByDate()">
                </div>
                <table id="incidentsTable">
                    <thead><tr><th>Date</th><th>Product / URL</th><th>Status</th></tr></thead>
                    <tbody>
                        ${incidents
                          .map(
                            (inc) => `
                        <tr data-date="${inc.date.split("T")[0]}">
                            <td>${new Date(inc.date).toLocaleString()}</td>
                            <td>${inc.url.split("/").pop()}</td>
                            <td><span class="badge bg-red">Error ${
                              inc.status
                            }</span></td>
                        </tr>`
                          )
                          .join("")}
                    </tbody>
                </table>
                ${
                  incidents.length === 0
                    ? '<p style="padding:20px; text-align:center">No incidents recorded yet. Great job! 🎉</p>'
                    : ""
                }
            </div>

            <div id="maintenance" class="view-section">
                <h2>Maintenance Schedule</h2>
                <table>
                    <thead><tr><th>Event</th><th>Date</th><th>Duration</th><th>Status</th></tr></thead>
                    <tbody>
                        ${SCHEDULED_MAINTENANCE.map(
                          (m) => `
                        <tr>
                            <td>${m.title}</td>
                            <td>${m.date}</td>
                            <td>${m.duration}</td>
                            <td><span class="badge bg-blue">${m.status}</span></td>
                        </tr>`
                        ).join("")}
                    </tbody>
                </table>
            </div>

            <div id="settings" class="view-section">
                <h2>System Settings</h2>
                <div class="stat-card" style="margin-bottom: 20px;">
                    <h3>Application Info</h3>
                    <p><strong>Version:</strong> ${APP_VERSION}</p>
                    <p><strong>Webhook Status:</strong> ${
                      DISCORD_WEBHOOK_URL ? "✅ Connected" : "❌ Not Configured"
                    }</p>
                    <p><strong>Database:</strong> database.json (${(
                      fs.statSync(DATABASE_FILE).size / 1024
                    ).toFixed(2)} KB)</p>
                </div>
                <h3>Data Management</h3>
                <button class="btn" onclick="exportData()">📥 Export Database to CSV</button>
            </div>
        </div>

        <script>
            function switchTab(tabId, navItem) {
                document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
                document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
                navItem.classList.add('active');
            }

            function toggleTheme() {
                document.body.classList.toggle('light-mode');
                localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
            }
            if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-mode');

            function runSearch() {
                const term = document.getElementById('searchInput').value.toLowerCase();
                const cards = document.querySelectorAll('.monitor-card');
                cards.forEach(card => {
                    const name = card.dataset.name;
                    if (name.includes(term)) card.style.display = 'flex'; else card.style.display = 'none';
                });
            }

            function filterIncidentsByDate() {
                const filterDate = document.getElementById('dateFilter').value;
                const rows = document.querySelectorAll('#incidentsTable tbody tr');
                
                rows.forEach(row => {
                    if (!filterDate) {
                        row.style.display = ''; // Show all if no date selected
                    } else {
                        const rowDate = row.getAttribute('data-date');
                        row.style.display = (rowDate === filterDate) ? '' : 'none';
                    }
                });
            }

            function exportData() {
                const data = ${JSON.stringify(incidents)};
                let csvContent = "data:text/csv;charset=utf-8,Date,URL,Status\\n";
                data.forEach(row => {
                    csvContent += \`\${row.date},\${row.url},\${row.status}\\n\`;
                });
                const encodedUri = encodeURI(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", "monitor_report.csv");
                document.body.appendChild(link);
                link.click();
            }
        </script>
    </body>
    </html>
    `;

  fs.writeFileSync("dashboard.html", htmlContent);
  console.log("✅ Ultimate App Generated!");
}

checkAllPages();
