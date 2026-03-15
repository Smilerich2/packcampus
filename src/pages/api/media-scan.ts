import type { APIRoute } from "astro";
import crypto from "node:crypto";

function generateGhostJwt(adminKey: string): string {
  const [id, secret] = adminKey.split(":");

  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iat: now,
    exp: now + 300,
    aud: "/admin/",
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

interface MediaEntry {
  url: string;
  filename: string;
  type: "image" | "video" | "audio";
  usedIn: { title: string; slug: string }[];
}

function extractMediaUrls(html: string): { url: string; type: "image" | "video" | "audio" }[] {
  const results: { url: string; type: "image" | "video" | "audio" }[] = [];

  // Images: <img src="...">
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    results.push({ url: match[1], type: "image" });
  }

  // Videos: <video src="..."> or <video ...><source src="...">
  for (const match of html.matchAll(/<video[^>]+src=["']([^"']+)["']/gi)) {
    results.push({ url: match[1], type: "video" });
  }

  // Audio: <audio src="..."> or <audio ...><source src="...">
  for (const match of html.matchAll(/<audio[^>]+src=["']([^"']+)["']/gi)) {
    results.push({ url: match[1], type: "audio" });
  }

  // <source src="..."> inside video/audio
  // We check context by looking for enclosing video/audio tags
  for (const match of html.matchAll(/<(video|audio)[^>]*>[\s\S]*?<source[^>]+src=["']([^"']+)["'][^>]*>[\s\S]*?<\/\1>/gi)) {
    const type = match[1].toLowerCase() as "video" | "audio";
    results.push({ url: match[2], type });
  }

  return results;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { token } = (await request.json()) as { token?: string };
    const correct = process.env.ADMIN_PASSWORD || "";

    if (!token || token !== correct) {
      return new Response(
        JSON.stringify({ error: "Nicht autorisiert." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const adminKey = process.env.GHOST_ADMIN_API_KEY || "";
    if (!adminKey || !adminKey.includes(":")) {
      return new Response(
        JSON.stringify({ error: "GHOST_ADMIN_API_KEY nicht konfiguriert." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const ghostUrl = "https://cms.packcampus.de";
    const jwt = generateGhostJwt(adminKey);
    const headers = { Authorization: `Ghost ${jwt}` };

    // Fetch all posts (including drafts) with pagination
    const allPosts: any[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${ghostUrl}/ghost/api/admin/posts/?formats=html&limit=100&page=${page}&filter=status:[published,draft,scheduled]`,
        { headers }
      );
      if (!res.ok) {
        const text = await res.text();
        return new Response(
          JSON.stringify({ error: `Ghost API Fehler: ${res.status} ${text}` }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
      const data = await res.json();
      allPosts.push(...data.posts);
      if (!data.meta?.pagination?.next) break;
      page++;
    }

    // Fetch all tags
    const tagsRes = await fetch(
      `${ghostUrl}/ghost/api/admin/tags/?limit=all`,
      { headers }
    );
    const tagsData = tagsRes.ok ? await tagsRes.json() : { tags: [] };
    const allTags: any[] = tagsData.tags || [];

    // Build media map: url -> MediaEntry
    const mediaMap = new Map<string, MediaEntry>();

    function addMedia(url: string, type: "image" | "video" | "audio", source: { title: string; slug: string }) {
      // Skip data URIs and empty URLs
      if (!url || url.startsWith("data:")) return;

      const existing = mediaMap.get(url);
      if (existing) {
        if (!existing.usedIn.some((u) => u.slug === source.slug)) {
          existing.usedIn.push(source);
        }
      } else {
        const filename = decodeURIComponent(url.split("/").pop()?.split("?")[0] || url);
        mediaMap.set(url, { url, filename, type, usedIn: [source] });
      }
    }

    // Process posts
    for (const post of allPosts) {
      const source = { title: post.title, slug: post.slug };

      // Feature image
      if (post.feature_image) {
        addMedia(post.feature_image, "image", source);
      }

      // HTML content
      if (post.html) {
        for (const media of extractMediaUrls(post.html)) {
          addMedia(media.url, media.type, source);
        }
      }
    }

    // Process tag feature images
    for (const tag of allTags) {
      if (tag.feature_image) {
        const source = { title: `Tag: ${tag.name}`, slug: `tag/${tag.slug}` };
        addMedia(tag.feature_image, "image", source);
      }
    }

    const media = Array.from(mediaMap.values());
    const stats = {
      total: media.length,
      images: media.filter((m) => m.type === "image").length,
      videos: media.filter((m) => m.type === "video").length,
      audio: media.filter((m) => m.type === "audio").length,
    };

    return new Response(JSON.stringify({ media, stats }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: `Serverfehler: ${err.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
