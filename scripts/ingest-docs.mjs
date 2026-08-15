import OpenAI, { toFile } from "openai";
import { load } from "cheerio";
import robotsParser from "robots-parser";
import TurndownService from "turndown";

const USER_AGENT = "WP-Support-Copilot/1.0 (+private curated documentation index)";
const REQUEST_DELAY_MS = 650;
const ALLOWED_HOSTS = new Set(["wordpress.com", "woocommerce.com"]);

const CURATED_DOCS = [
  ["Coming Soon", "https://wordpress.com/support/privacy-settings/display-a-coming-soon-page/"],
  ["Site privacy and visibility", "https://wordpress.com/support/settings/privacy-settings/"],
  ["Launch a website", "https://wordpress.com/support/privacy-settings/launch-your-website/"],
  ["Pages", "https://wordpress.com/support/pages/"],
  ["Posts", "https://wordpress.com/support/posts/"],
  ["Set the homepage", "https://wordpress.com/support/pages/front-page/"],
  ["Navigation menus", "https://wordpress.com/support/menus/"],
  ["Themes", "https://wordpress.com/support/themes/"],
  ["Classic theme Customizer", "https://wordpress.com/support/customizer/"],
  ["Switch from a classic theme to a block theme", "https://wordpress.com/support/migrate-from-a-classic-theme-to-a-block-theme/"],
  ["Site Editor", "https://wordpress.com/support/site-editor/"],
  ["WordPress Editor", "https://wordpress.com/support/wordpress-editor/"],
  ["Domains", "https://wordpress.com/support/domains/"],
  ["DNS records", "https://wordpress.com/support/domains/custom-dns/"],
  ["HTTPS and SSL", "https://wordpress.com/support/domains/https-ssl/"],
  ["WordPress.com plans", "https://wordpress.com/support/plan-features/"],
  ["Install a plugin", "https://wordpress.com/support/plugins/install-a-plugin/"],
  ["Media", "https://wordpress.com/support/media/"],
  ["Gallery block", "https://wordpress.com/support/wordpress-editor/blocks/gallery-block/"],
  ["Form block", "https://wordpress.com/support/wordpress-editor/blocks/form-block/"],
  ["SEO tools", "https://wordpress.com/support/seo-tools/"],
  ["Sitemaps", "https://wordpress.com/support/sitemaps/"],
  ["Search engines", "https://wordpress.com/support/search-engines/"],
  ["WooCommerce settings", "https://woocommerce.com/document/configuring-woocommerce-settings/"],
  ["WooCommerce products", "https://woocommerce.com/document/managing-products/"],
];

const robotsCache = new Map();
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertOfficialUrl(value) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^www\./, "");
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(hostname)) {
    throw new Error(`Refusing non-official URL: ${value}`);
  }
  return url;
}

async function robotsAllows(url) {
  const origin = url.origin;
  if (!robotsCache.has(origin)) {
    const robotsUrl = `${origin}/robots.txt`;
    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`Could not verify robots.txt for ${origin} (${response.status})`);
    }
    robotsCache.set(origin, robotsParser(robotsUrl, await response.text()));
  }
  return robotsCache.get(origin).isAllowed(url.toString(), USER_AGENT) !== false;
}

async function fetchDocument(title, sourceUrl) {
  const requestedUrl = assertOfficialUrl(sourceUrl);
  if (!(await robotsAllows(requestedUrl))) {
    throw new Error(`Blocked by robots.txt: ${sourceUrl}`);
  }

  const response = await fetch(requestedUrl, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${sourceUrl}`);

  const finalUrl = assertOfficialUrl(response.url);
  const html = await response.text();
  const $ = load(html);
  $("script, style, nav, footer, header, form, aside, noscript, svg").remove();

  const candidates = [$("article").first(), $("main").first(), $("body")].filter(
    (candidate) => candidate.length,
  );
  const root = candidates.sort(
    (a, b) => b.text().trim().length - a.text().trim().length,
  )[0];
  const markdown = turndown.turndown(root.html() || "").trim();
  if (markdown.length < 400) {
    throw new Error(`Not enough useful content extracted from ${sourceUrl}`);
  }

  return {
    sourceUrl: finalUrl.toString(),
    content: `# ${title}\n\nOfficial source: ${finalUrl.toString()}\n\n${markdown}`,
  };
}

function filenameFor(url, index) {
  const slug = new URL(url).pathname
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join("-")
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();
  return `${String(index + 1).padStart(2, "0")}-${slug || "home"}.md`;
}

async function existingFiles(client, vectorStoreId) {
  const files = [];
  for await (const file of client.vectorStores.files.list(vectorStoreId, {
    limit: 100,
  })) {
    files.push(file);
  }
  return files;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Set OPENAI_API_KEY before running ingestion.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

  if (vectorStoreId) {
    await client.vectorStores.retrieve(vectorStoreId);
    console.log(`Updating vector store ${vectorStoreId}`);
  } else {
    const vectorStore = await client.vectorStores.create({
      name: "WP Support Copilot — Official Documentation",
      description:
        "Curated official WordPress.com and WooCommerce support documentation.",
    });
    vectorStoreId = vectorStore.id;
    console.log(`Created vector store ${vectorStoreId}`);
  }

  const priorFiles = await existingFiles(client, vectorStoreId);
  let completed = 0;
  const failures = [];

  for (const [index, [title, url]] of CURATED_DOCS.entries()) {
    try {
      const document = await fetchDocument(title, url);
      const previous = priorFiles.filter(
        (file) => file.attributes?.source_url === document.sourceUrl,
      );
      for (const file of previous) {
        await client.vectorStores.files.delete(file.id, {
          vector_store_id: vectorStoreId,
        });
        await client.files.delete(file.id);
      }

      const upload = await client.files.create({
        file: await toFile(
          Buffer.from(document.content, "utf8"),
          filenameFor(document.sourceUrl, index),
          { type: "text/markdown" },
        ),
        purpose: "assistants",
      });
      const attached = await client.vectorStores.files.createAndPoll(
        vectorStoreId,
        {
          file_id: upload.id,
          attributes: {
            source_url: document.sourceUrl,
            title,
            publisher: new URL(document.sourceUrl).hostname,
          },
        },
      );
      if (attached.status !== "completed") {
        throw new Error(attached.last_error?.message || "Vector indexing failed");
      }

      completed += 1;
      console.log(`[${completed}/${CURATED_DOCS.length}] Indexed ${title}`);
    } catch (error) {
      failures.push({ title, error: error instanceof Error ? error.message : String(error) });
      console.warn(`Skipped ${title}: ${failures.at(-1).error}`);
    }
    await wait(REQUEST_DELAY_MS);
  }

  if (completed === 0) {
    throw new Error("No documentation was indexed.");
  }

  console.log(`\nIndexed ${completed} curated documents.`);
  if (failures.length) console.log(`${failures.length} documents were skipped; review the messages above.`);
  console.log(`Set OPENAI_VECTOR_STORE_ID=${vectorStoreId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
