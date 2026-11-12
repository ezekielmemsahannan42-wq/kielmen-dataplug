
const fs = require("fs");
const path = require("path");

const API_URL =
  "https://kielmen-dataplug-payment-api.onrender.com/agents/public-stores";

const SITE_URL = "https://kielmen.com";

const ROOT = process.cwd();
const TEMPLATE_PATH = path.join(ROOT, "agent-store.html");
const TRACK_FILE = path.join(ROOT, ".generated-agent-stores.json");

const DIRECTORY_PATH = path.join(ROOT, "agents");
const DIRECTORY_MARKER = path.join(
  DIRECTORY_PATH,
  ".kielmen-agent-directory-generated"
);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function replaceMeta(html, id, replacement) {
  const pattern = new RegExp(
    `<meta\\b[^>]*\\bid="${id}"[^>]*>`,
    "i"
  );

  if (!pattern.test(html)) {
    throw new Error(`Could not find SEO meta tag: ${id}`);
  }

  return html.replace(pattern, replacement);
}

// Insert agent content into HTML before JavaScript runs.
function replaceElementContent(html, id, content) {
  const pattern = new RegExp(
    `(<([a-z][\\w:-]*)\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(<\\/\\2>)`,
    "i"
  );

  if (!pattern.test(html)) {
    throw new Error(`Could not find HTML element: ${id}`);
  }

  return html.replace(
    pattern,
    (_match, openingTag, _tagName, closingTag) =>
      `${openingTag}${content}${closingTag}`
  );
}

function getPreviousSlugs() {
  try {
    const previous = JSON.parse(
      fs.readFileSync(TRACK_FILE, "utf8")
    );

    return Array.isArray(previous) ? previous : [];
  } catch {
    return [];
  }
}

// Create the public directory page.
function generateAgentDirectory(stores) {
  // Do not overwrite an unrelated existing folder.
  if (
    fs.existsSync(DIRECTORY_PATH) &&
    !fs.existsSync(DIRECTORY_MARKER)
  ) {
    throw new Error(
      "The /agents folder already exists and is not owned by this generator. " +
      "Rename or inspect that folder before continuing."
    );
  }

  const cards = stores.map(agent => {
    const name = escapeHtml(agent.businessName);
    const slug = agent.storeSlug;

    return `
      <a class="agent-card"
         href="/${slug}/"
         data-search="${escapeHtml(agent.businessName.toLowerCase())}">
        <div class="agent-icon">K636</div>
        <div class="agent-info">
          <h2>${name}</h2>
          <p>MTN · Telecel · AirtelTigo</p>
          <span class="visit-link">Visit Agent Store →</span>
        </div>
      </a>
    `;
  }).join("\n");

  const emptyMessage = stores.length
    ? ""
    : `<p class="empty-message">No approved agents are available yet. Please check back soon.</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>Kielmen Agent Directory | Find Data Sellers in Ghana</title>

  <meta
    name="description"
    content="Find approved Kielmen data agents in Ghana. Search MTN, Telecel and AirtelTigo data sellers and visit their individual online stores."
  >

  <meta name="robots" content="index, follow">

  <link
    rel="canonical"
    href="${SITE_URL}/agents/"
  >

  <meta
    property="og:title"
    content="Kielmen Agent Directory | Data Sellers in Ghana"
  >

  <meta
    property="og:description"
    content="Discover approved Kielmen agents and visit their personal data stores."
  >

  <meta
    property="og:url"
    content="${SITE_URL}/agents/"
  >

  <meta property="og:type" content="website">

  <meta name="theme-color" content="#101b15">

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #101510;
      color: #f5f7f5;
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.6;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .topbar {
      padding: 18px 5%;
      background: #1b241e;
      border-bottom: 1px solid #344339;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 15px;
    }

    .brand {
      font-size: 21px;
      font-weight: 800;
      color: #80e5a5;
    }

    .home-link {
      padding: 9px 16px;
      border: 1px solid #526457;
      border-radius: 10px;
      font-size: 14px;
    }

    .hero {
      text-align: center;
      padding: 55px 18px 35px;
      background: linear-gradient(145deg, #14291c, #101510);
    }

    .hero h1 {
      margin: 0 0 12px;
      font-size: clamp(28px, 6vw, 43px);
      line-height: 1.2;
    }

    .hero p {
      max-width: 650px;
      margin: 0 auto;
      color: #b8c5bb;
      font-size: 16px;
    }

    .directory {
      max-width: 1000px;
      margin: 0 auto;
      padding: 25px 18px 65px;
    }

    .directory-heading {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 18px;
    }

    .directory-heading h2 {
      margin: 0;
      font-size: 21px;
    }

    .agent-count {
      color: #8be6aa;
      font-size: 13px;
    }

    .search-box {
      width: 100%;
      padding: 16px;
      margin-bottom: 24px;
      background: #202923;
      border: 1px solid #526457;
      border-radius: 12px;
      color: white;
      font-size: 16px;
      outline: none;
    }

    .search-box:focus {
      border-color: #80e5a5;
    }

    .agent-list {
      display: grid;
      grid-template-columns: repeat(
        auto-fit,
        minmax(250px, 1fr)
      );
      gap: 15px;
    }

    .agent-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px;
      background: #1b241e;
      border: 1px solid #35443a;
      border-radius: 15px;
      transition: border-color .2s, transform .2s;
    }

    .agent-card:hover {
      border-color: #80e5a5;
      transform: translateY(-2px);
    }

    .agent-icon {
      width: 54px;
      height: 54px;
      min-width: 54px;
      display: grid;
      place-items: center;
      border: 2px solid #087b3a;
      border-radius: 15px;
      color: #80e5a5;
      font-size: 15px;
      font-weight: 800;
    }

    .agent-info {
      min-width: 0;
    }

    .agent-info h2 {
      margin: 0 0 5px;
      font-size: 17px;
      overflow-wrap: anywhere;
    }

    .agent-info p {
      margin: 0 0 8px;
      color: #b3beb6;
      font-size: 12px;
    }

    .visit-link {
      color: #80e5a5;
      font-size: 13px;
      font-weight: 700;
    }

    .empty-message {
      grid-column: 1 / -1;
      padding: 25px;
      color: #c4cec7;
      text-align: center;
    }

    .footer {
      padding: 25px 15px;
      text-align: center;
      color: #aebbb2;
      border-top: 1px solid #35443a;
      font-size: 13px;
    }

    .footer a {
      color: #80e5a5;
    }
  </style>
</head>

<body>

  <header class="topbar">
    <a class="brand" href="/">KIELMEN 636</a>
    <a class="home-link" href="/">Main Website</a>
  </header>

  <main>
    <section class="hero">
      <h1>Kielmen Agent Directory</h1>

      <p>
        Find approved data sellers across Ghana.
        Discover MTN, Telecel and AirtelTigo bundles
        from individual Kielmen agent stores.
      </p>
    </section>

    <section class="directory">

      <div class="directory-heading">
        <h2>Find Your Data Agent</h2>

        <span class="agent-count">
          ${stores.length} approved agents
        </span>
      </div>

      <label for="agentSearch" style="display:block;margin-bottom:8px">
        Search by agent business name
      </label>

      <input
        id="agentSearch"
        class="search-box"
        type="search"
        placeholder="Enter an agent or business name..."
        autocomplete="off"
      >

      <div class="agent-list" id="agentList">
        ${cards}
        ${emptyMessage}
      </div>

      <p
        id="noResults"
        class="empty-message"
        hidden
      >
        No matching agent found. Try another business name.
      </p>

    </section>
  </main>

  <footer class="footer">
    <p>
      Powered by
      <a href="/">Kielmen 636 Dataplug</a>
    </p>

    <p>
      Find data bundles from approved sellers across Ghana.
    </p>
  </footer>

  <script>
    const searchInput = document.getElementById("agentSearch");
    const agentCards = Array.from(
      document.querySelectorAll(".agent-card")
    );

    const noResults = document.getElementById("noResults");

    searchInput.addEventListener("input", function () {
      const searchTerm = this.value.trim().toLowerCase();

      let visibleCount = 0;

      agentCards.forEach(card => {
        const name = card.dataset.search || "";
        const matches = name.includes(searchTerm);

        card.hidden = !matches;

        if (matches) {
          visibleCount++;
        }
      });

      noResults.hidden =
        visibleCount > 0 || searchTerm.length === 0;
    });
  </script>

</body>
</html>`;

  fs.mkdirSync(DIRECTORY_PATH, { recursive: true });

  fs.writeFileSync(
    path.join(DIRECTORY_PATH, "index.html"),
    html
  );

  fs.writeFileSync(
    DIRECTORY_MARKER,
    "Generated by Kielmen sitemap automation."
  );
}

async function main() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(
      "agent-store.html is missing from the repository root."
    );
  }

  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error(
      `Agent API returned HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (
    data.success !== true ||
    !Array.isArray(data.stores)
  ) {
    throw new Error(
      "The agent API returned an invalid response."
    );
  }

  const template = fs.readFileSync(
    TEMPLATE_PATH,
    "utf8"
  );

  const stores = data.stores.filter(agent =>
    agent &&
    typeof agent.businessName === "string" &&
    typeof agent.storeSlug === "string" &&
    /^[a-z0-9_-]{1,100}$/.test(agent.storeSlug)
  );

  const previousSlugs = getPreviousSlugs();

  const currentSlugs = [];

  const sitemapUrls = [
    {
      url: `${SITE_URL}/`,
      lastmod: new Date().toISOString().slice(0, 10)
    }
  ];

  for (const agent of stores) {
    const slug = agent.storeSlug;
    const businessName = agent.businessName.trim();

    if (!businessName) continue;

    // The directory owns the /agents/ URL.
    if (slug === "agents") {
      throw new Error(
        'An agent uses the reserved store slug "agents". ' +
        "Change that agent's store slug before generating the directory."
      );
    }

    const folder = path.join(ROOT, slug);

    const marker = path.join(
      folder,
      ".kielmen-agent-store-generated"
    );

    // Never overwrite a folder not created by this script.
    if (
      fs.existsSync(folder) &&
      !fs.existsSync(marker)
    ) {
      throw new Error(
        `Cannot safely generate ${slug}: its folder already exists.`
      );
    }

    fs.mkdirSync(folder, { recursive: true });

    const pageUrl = `${SITE_URL}/${slug}/`;

    const title =
      `${businessName} Data Bundles | MTN, Telecel & AirtelTigo | Kielmen`;

    const description =
      `Buy MTN, Telecel and AirtelTigo data bundles from ${businessName} in Ghana. Visit this agent's Kielmen 636 Dataplug store.`;

    let html = template;

    // Page title.
    html = html.replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${escapeHtml(title)}</title>`
    );

    // SEO description.
    html = replaceMeta(
      html,
      "seoDescription",
      `<meta name="description" id="seoDescription" content="${escapeHtml(description)}">`
    );

    // Canonical URL.
    const canonicalPattern =
      /<link\b[^>]*\bid="seoCanonical"[^>]*>/i;

    if (!canonicalPattern.test(html)) {
      throw new Error(
        "Could not find the canonical SEO link."
      );
    }

    html = html.replace(
      canonicalPattern,
      `<link rel="canonical" id="seoCanonical" href="${pageUrl}">`
    );

    // Open Graph title.
    html = replaceMeta(
      html,
      "seoOgTitle",
      `<meta property="og:title" id="seoOgTitle" content="${escapeHtml(title)}">`
    );

    // Open Graph description.
    html = replaceMeta(
      html,
      "seoOgDescription",
      `<meta property="og:description" id="seoOgDescription" content="${escapeHtml(description)}">`
    );

    // Open Graph URL.
    html = replaceMeta(
      html,
      "seoOgUrl",
      `<meta property="og:url" id="seoOgUrl" content="${pageUrl}">`
    );

    // Insert the real agent business name.
    html = replaceElementContent(
      html,
      "heroBusinessName",
      escapeHtml(businessName)
    );

    // Insert the real agent description.
    html = replaceElementContent(
      html,
      "storeDescription",
      escapeHtml(description)
    );

    // Set the individual agent slug.
    const slugScript =
      `<script>window.__KIELMEN_STORE_SLUG__=${JSON.stringify(slug)};</script>`;

    html = html.replace(
      /<head(?:\s[^>]*)?>/i,
      head => head + "\n" + slugScript
    );

    // Generate individual agent page.
    fs.writeFileSync(
      path.join(folder, "index.html"),
      html
    );

    fs.writeFileSync(
      marker,
      "Generated by Kielmen sitemap automation."
    );

    currentSlugs.push(slug);

    const lastmod = agent.updatedAt
      ? new Date(agent.updatedAt)
      : null;

    sitemapUrls.push({
      url: pageUrl,
      lastmod:
        lastmod && !Number.isNaN(lastmod.getTime())
          ? lastmod.toISOString().slice(0, 10)
          : null
    });
  }

  // Generate the public agent directory.
  generateAgentDirectory(
    stores.filter(agent =>
      agent.businessName.trim() &&
      agent.storeSlug !== "agents"
    )
  );

  // Add directory to Google's sitemap.
  sitemapUrls.push({
    url: `${SITE_URL}/agents/`,
    lastmod: new Date().toISOString().slice(0, 10)
  });

  // Remove old generated pages for agents no longer approved.
  for (const oldSlug of previousSlugs) {
    if (
      !/^[a-z0-9_-]{1,100}$/.test(oldSlug) ||
      currentSlugs.includes(oldSlug)
    ) {
      continue;
    }

    const oldFolder = path.join(ROOT, oldSlug);

    const marker = path.join(
      oldFolder,
      ".kielmen-agent-store-generated"
    );

    if (fs.existsSync(marker)) {
      fs.rmSync(
        oldFolder,
        { recursive: true, force: true }
      );
    }
  }

  // Save current approved agent slugs.
  fs.writeFileSync(
    TRACK_FILE,
    JSON.stringify(currentSlugs, null, 2) + "\n"
  );

  // Generate sitemap.xml.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(item => `  <url>
    <loc>${escapeXml(item.url)}</loc>
${item.lastmod ? `    <lastmod>${item.lastmod}</lastmod>\n` : ""}  </url>`).join("\n")}
</urlset>
`;

  fs.writeFileSync(
    path.join(ROOT, "sitemap.xml"),
    sitemap
  );

  // Generate robots.txt.
  fs.writeFileSync(
    path.join(ROOT, "robots.txt"),
    `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`
  );

  console.log(
    `SEO generation complete. ${currentSlugs.length} approved agent pages generated.`
  );

  console.log(
    `Public agent directory generated at ${SITE_URL}/agents/`
  );
}

main().catch(error => {
  console.error("SEO generation failed:", error);
  process.exit(1);
});
