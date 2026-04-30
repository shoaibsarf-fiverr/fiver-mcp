/**
 * Fiverr MCP Server
 * A remote MCP server that provides Claude with tools to read
 * and analyze your Fiverr seller profile: shoaibshoai
 *
 * Runs as an HTTP/SSE server on port 3000.
 * Connect to Claude via: Settings → Connectors → Add custom connector
 * URL: http://localhost:3000/sse  (or your deployed URL)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
import https from "https";
import http from "http";

// ── Constants ─────────────────────────────────────────────────────────────────
const SELLER_USERNAME = "shoaibshoai";
const FIVERR_BASE = "https://www.fiverr.com";
const PORT = process.env.PORT || 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch a Fiverr page with browser-like headers to bypass basic bot checks */
function fetchFiverr(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
    };

    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchFiverr(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

/** Extract JSON from Fiverr's __NEXT_DATA__ or window.__store__ scripts */
function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
  return null;
}

/** Simple text extractor – removes HTML tags */
function stripHtml(str = "") {
  return str.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** Parse seller profile from Fiverr's profile page */
async function getSellerProfile(username) {
  const url = `${FIVERR_BASE}/${username}`;
  const { status, body } = await fetchFiverr(url);

  if (status !== 200) {
    return { error: `HTTP ${status} when fetching profile`, url };
  }

  // Try NEXT_DATA first
  const nextData = extractNextData(body);
  if (nextData) {
    const props = nextData?.props?.pageProps;
    const user = props?.userData || props?.user || props?.seller;
    if (user) {
      return normalizeProfile(user, username, url);
    }
  }

  // Fallback: regex-based extraction from HTML
  return scrapeProfileFromHtml(body, username, url);
}

function normalizeProfile(user, username, url) {
  return {
    username,
    url,
    display_name: user.displayName || user.display_name || user.name || username,
    level: user.sellerLevel || user.seller_level || user.level || "Unknown",
    rating: user.rating || user.sellerRating || null,
    reviews_count: user.reviewsCount || user.reviews_count || 0,
    member_since: user.memberSince || user.member_since || null,
    country: user.country || user.location || null,
    languages: user.languages || [],
    skills: user.skills || [],
    description: stripHtml(user.description || user.bio || ""),
    response_time: user.responseTime || user.response_time || null,
    online_status: user.isOnline || user.online || null,
    completed_orders: user.completedOrders || user.completed_orders || null,
    source: "next_data",
  };
}

function scrapeProfileFromHtml(html, username, url) {
  const get = (pattern) => {
    const m = html.match(pattern);
    return m ? stripHtml(m[1] || "").trim() : null;
  };

  return {
    username,
    url,
    display_name: get(/class="[^"]*username[^"]*"[^>]*>([^<]+)</) || username,
    level: get(/seller-level[^>]*>([^<]+)</) || get(/Level \d[^<]*/) || "Unknown",
    rating: get(/rating[^>]*>([\d.]+)</) || get(/"ratingScore":([\d.]+)/) || null,
    reviews_count: get(/reviews_count[^>]*>(\d+)</) || get(/"reviewsCount":(\d+)/) || null,
    member_since: get(/member since[^>]*>([^<]+)</i) || null,
    country: get(/country[^>]*>([^<]+)</) || null,
    description: get(/<meta name="description" content="([^"]+)"/) || null,
    source: "html_scrape",
    note: "Some fields may be incomplete due to Fiverr's anti-bot measures.",
  };
}

/** Fetch gig listings for a seller */
async function getSellerGigs(username) {
  const url = `${FIVERR_BASE}/${username}`;
  const { status, body } = await fetchFiverr(url);

  if (status !== 200) {
    return { error: `HTTP ${status}`, gigs: [] };
  }

  const nextData = extractNextData(body);
  let gigs = [];

  if (nextData) {
    // Navigate the NEXT_DATA tree to find gigs
    const traverse = (obj, depth = 0) => {
      if (depth > 10 || !obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        // Look for arrays of gig-like objects
        if (obj.length > 0 && obj[0]?.gigId || obj[0]?.gig_id || obj[0]?.title) {
          gigs = obj.map(normalizeGig).filter(Boolean);
          return;
        }
        obj.forEach((v) => traverse(v, depth + 1));
      } else {
        for (const key of Object.keys(obj)) {
          if (["gigs", "sellerGigs", "seller_gigs", "gigsList"].includes(key)) {
            if (Array.isArray(obj[key]) && obj[key].length) {
              gigs = obj[key].map(normalizeGig).filter(Boolean);
              return;
            }
          }
          traverse(obj[key], depth + 1);
        }
      }
    };
    traverse(nextData);
  }

  // Fallback: regex extraction of gig data from HTML
  if (!gigs.length) {
    gigs = extractGigsFromHtml(body);
  }

  return { username, total_gigs: gigs.length, gigs };
}

function normalizeGig(g) {
  if (!g) return null;
  return {
    id: g.gigId || g.gig_id || g.id || null,
    title: g.title || g.gigTitle || g.name || "Untitled",
    slug: g.slug || null,
    url: g.gigUrl || g.url || null,
    price_from: g.price || g.startingPrice || g.pricing?.basic?.price || null,
    rating: g.rating || g.gigRating || null,
    reviews: g.reviewsCount || g.reviews_count || 0,
    category: g.category || g.categorySlug || null,
    delivery_days: g.deliveryTime || g.delivery_days || null,
    orders_in_queue: g.ordersInQueue || null,
    is_active: g.status === "active" || g.isActive !== false,
  };
}

function extractGigsFromHtml(html) {
  const gigs = [];
  // Extract gig cards using common Fiverr HTML patterns
  const gigPattern = /<div[^>]*class="[^"]*gig-card[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*gig-card|<\/section>)/g;
  let match;
  while ((match = gigPattern.exec(html)) !== null) {
    const block = match[1];
    const title = block.match(/alt="([^"]+)"/)?.[1] || block.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1];
    const price = block.match(/Starting at \$?([\d.]+)/i)?.[1] || block.match(/from \$?([\d.]+)/i)?.[1];
    const rating = block.match(/([\d.]+)\s*\([\d,]+/)?.[1];
    if (title) {
      gigs.push({ title: stripHtml(title), price_from: price ? parseFloat(price) : null, rating: rating ? parseFloat(rating) : null });
    }
  }
  return gigs;
}

/** Get seller reviews */
async function getSellerReviews(username, limit = 10) {
  // Fiverr loads reviews dynamically; we fetch the profile page and parse embedded data
  const url = `${FIVERR_BASE}/${username}`;
  const { status, body } = await fetchFiverr(url);

  if (status !== 200) return { error: `HTTP ${status}`, reviews: [] };

  const nextData = extractNextData(body);
  let reviews = [];

  if (nextData) {
    const traverse = (obj, depth = 0) => {
      if (depth > 12 || !obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        const r = obj.find((i) => i?.review || i?.comment || i?.reviewText);
        if (r) {
          reviews = obj.slice(0, limit).map((rv) => ({
            reviewer: rv.buyerName || rv.buyer?.name || rv.username || "Anonymous",
            country: rv.buyerCountry || rv.country || null,
            rating: rv.rating || rv.score || null,
            comment: stripHtml(rv.review || rv.comment || rv.reviewText || ""),
            date: rv.publishedAt || rv.created_at || rv.date || null,
            gig_title: rv.gigTitle || rv.gig_title || null,
          }));
          return;
        }
        obj.forEach((v) => traverse(v, depth + 1));
      } else {
        for (const key of Object.keys(obj)) {
          if (["reviews", "sellerReviews", "reviewsList"].includes(key)) {
            if (Array.isArray(obj[key]) && obj[key].length) {
              reviews = obj[key].slice(0, limit).map((rv) => ({
                reviewer: rv.buyerName || rv.username || "Anonymous",
                rating: rv.rating || rv.score || null,
                comment: stripHtml(rv.review || rv.comment || ""),
                date: rv.publishedAt || rv.date || null,
              }));
              return;
            }
          }
          traverse(obj[key], depth + 1);
        }
      }
    };
    traverse(nextData);
  }

  return {
    username,
    total_fetched: reviews.length,
    reviews,
    note: reviews.length === 0
      ? "Fiverr loads reviews via client-side JS. For full review access, deploy this server with a headless browser (Playwright/Puppeteer)."
      : null,
  };
}

/** Analyze profile for recommendations */
function analyzeProfile(profile, gigs) {
  const insights = [];
  const suggestions = [];

  if (profile.reviews_count < 10) {
    suggestions.push("You have fewer than 10 reviews — focus on getting your first 10 five-star reviews by delivering exceptional work.");
  }

  if (profile.response_time && profile.response_time.includes("hour")) {
    const hours = parseInt(profile.response_time);
    if (hours > 4) suggestions.push("Your response time could be improved. Faster responses (under 1 hour) improve ranking.");
  }

  if (gigs.total_gigs < 3) {
    suggestions.push("Consider adding more gigs (ideally 5–7) to increase visibility and cover different buyer needs.");
  }

  if (profile.level === "New Seller" || profile.level === "Unknown") {
    insights.push("You're a new seller. Focus on completing your first 10 orders to reach Level 1.");
  }

  insights.push(`Profile URL: ${profile.url}`);
  insights.push(`Active gigs found: ${gigs.total_gigs}`);

  return { insights, suggestions };
}

// ── MCP Server Setup ──────────────────────────────────────────────────────────

const mcpServer = new McpServer({
  name: "fiverr-profile-mcp",
  version: "1.0.0",
  description: `MCP server for Fiverr seller: ${SELLER_USERNAME}`,
});

// Tool 1: Get Seller Profile
mcpServer.tool(
  "get_fiverr_profile",
  "Get the Fiverr seller profile for shoaibshoai including level, rating, reviews, skills and bio",
  {},
  async () => {
    try {
      const profile = await getSellerProfile(SELLER_USERNAME);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(profile, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching profile: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: Get Gigs
mcpServer.tool(
  "get_fiverr_gigs",
  "Get all active gigs/services listed by shoaibshoai on Fiverr with prices, ratings and delivery times",
  {},
  async () => {
    try {
      const gigs = await getSellerGigs(SELLER_USERNAME);
      return {
        content: [{ type: "text", text: JSON.stringify(gigs, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching gigs: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: Get Reviews
mcpServer.tool(
  "get_fiverr_reviews",
  "Get recent buyer reviews for shoaibshoai on Fiverr",
  {
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Number of reviews to fetch (max 50)"),
  },
  async ({ limit }) => {
    try {
      const reviews = await getSellerReviews(SELLER_USERNAME, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(reviews, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching reviews: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: Full Profile Analysis
mcpServer.tool(
  "analyze_fiverr_profile",
  "Get a complete analysis of the Fiverr profile shoaibshoai — combining profile data, gigs, and actionable improvement suggestions",
  {},
  async () => {
    try {
      const [profile, gigs] = await Promise.all([
        getSellerProfile(SELLER_USERNAME),
        getSellerGigs(SELLER_USERNAME),
      ]);

      const analysis = analyzeProfile(profile, gigs);

      const report = {
        seller: SELLER_USERNAME,
        profile_summary: {
          name: profile.display_name,
          level: profile.level,
          rating: profile.rating,
          reviews: profile.reviews_count,
          member_since: profile.member_since,
          country: profile.country,
          response_time: profile.response_time,
        },
        gigs_summary: {
          total: gigs.total_gigs,
          gigs: gigs.gigs?.map((g) => ({
            title: g.title,
            price_from: g.price_from,
            rating: g.rating,
            reviews: g.reviews,
          })),
        },
        insights: analysis.insights,
        improvement_suggestions: analysis.suggestions,
        profile_url: `https://www.fiverr.com/${SELLER_USERNAME}`,
        generated_at: new Date().toISOString(),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error running analysis: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: Get Profile Stats Summary
mcpServer.tool(
  "get_fiverr_stats",
  "Get a quick stats summary of the Fiverr seller shoaibshoai: rating, reviews count, seller level",
  {},
  async () => {
    try {
      const profile = await getSellerProfile(SELLER_USERNAME);
      const stats = {
        username: SELLER_USERNAME,
        profile_url: `https://www.fiverr.com/${SELLER_USERNAME}`,
        level: profile.level,
        overall_rating: profile.rating,
        total_reviews: profile.reviews_count,
        completed_orders: profile.completed_orders,
        response_time: profile.response_time,
        member_since: profile.member_since,
        country: profile.country,
        online: profile.online_status,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Express HTTP/SSE Transport ────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

const transports = {};

app.get("/sse", async (req, res) => {
  console.log(`[${new Date().toISOString()}] New SSE connection`);
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    console.log(`[${new Date().toISOString()}] SSE connection closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  await mcpServer.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    return res.status(404).json({ error: "Session not found" });
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "fiverr-profile-mcp",
    seller: SELLER_USERNAME,
    tools: ["get_fiverr_profile", "get_fiverr_gigs", "get_fiverr_reviews", "analyze_fiverr_profile", "get_fiverr_stats"],
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "Fiverr Profile MCP Server",
    seller: SELLER_USERNAME,
    profile_url: `https://www.fiverr.com/${SELLER_USERNAME}`,
    mcp_endpoint: "/sse",
    health: "/health",
    instructions: "Add this server to Claude via Settings → Connectors → Add custom connector. Use URL: <your-host>/sse",
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Fiverr MCP Server running on port ${PORT}`);
  console.log(`   Seller:     ${SELLER_USERNAME}`);
  console.log(`   SSE URL:    http://localhost:${PORT}/sse`);
  console.log(`   Health:     http://localhost:${PORT}/health`);
  console.log(`\n   Connect to Claude via:`);
  console.log(`   Settings → Connectors → Add custom connector`);
  console.log(`   URL: http://localhost:${PORT}/sse\n`);
});
