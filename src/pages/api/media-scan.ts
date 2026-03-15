import type { APIRoute } from "astro";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";

const GHOST_CONTENT = process.env.GHOST_CONTENT_PATH || "/ghost-content";
const GHOST_URL = "https://cms.packcampus.de";

export function generateGhostJwt(adminKey: string): string {
  const [id, secret] = adminKey.split(":");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" })).toString("base64url");
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
  sizeBytes?: number;
  onDisk?: boolean;
  relativePath?: string;
}

function extractMediaUrls(html: string): { url: string; type: "image" | "video" | "audio" }[] {
  const results: { url: string; type: "image" | "video" | "audio" }[] = [];
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    results.push({ url: match[1], type: "image" });
  }
  for (const match of html.matchAll(/<video[^>]+src=["']([^"']+)["']/gi)) {
    results.push({ url: match[1], type: "video" });
  }
  for (const match of html.matchAll(/<audio[^>]+src=["']([^"']+)["']/gi)) {
    results.push({ url: match[1], type: "audio" });
  }
  for (const match of html.matchAll(/<(video|audio)[^>]*>[\s\S]*?<source[^>]+src=["']([^"']+)["'][^>]*>[\s\S]*?<\/\1>/gi)) {
    results.push({ url: match[2], type: match[1].toLowerCase() as "video" | "audio" });
  }
  return results;
}

function classifyFile(filename: string): "image" | "video" | "audio" | null {
  const ext = extname(filename).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif"].includes(ext)) return "image";
  if ([".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(ext)) return "video";
  if ([".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"].includes(ext)) return "audio";
  return null;
}

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walkDir(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch { /* directory doesn't exist */ }
  return files;
}

function getStorageInfo(): { usedBytes: number; totalBytes: number; freeBytes: number } {
  try {
    const output = execSync(`df -B1 "${GHOST_CONTENT}" 2>/dev/null | tail -1`).toString().trim();
    const parts = output.split(/\s+/);
    return {
      totalBytes: parseInt(parts[1]) || 0,
      usedBytes: parseInt(parts[2]) || 0,
      freeBytes: parseInt(parts[3]) || 0,
    };
  } catch {
    return { usedBytes: 0, totalBytes: 0, freeBytes: 0 };
  }
}

async function getContentSize(dir: string): Promise<number> {
  try {
    const output = execSync(`du -sb "${dir}" 2>/dev/null | cut -f1`).toString().trim();
    return parseInt(output) || 0;
  } catch {
    return 0;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { token } = (await request.json()) as { token?: string };
    const correct = process.env.ADMIN_PASSWORD || "";

    if (!token || token !== correct) {
      return new Response(JSON.stringify({ error: "Nicht autorisiert." }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }

    const adminKey = process.env.GHOST_ADMIN_API_KEY || "";
    if (!adminKey || !adminKey.includes(":")) {
      return new Response(JSON.stringify({ error: "GHOST_ADMIN_API_KEY nicht konfiguriert." }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const jwt = generateGhostJwt(adminKey);
    const headers = { Authorization: `Ghost ${jwt}` };

    // Fetch all posts (including drafts)
    const allPosts: any[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${GHOST_URL}/ghost/api/admin/posts/?formats=html&limit=100&page=${page}&filter=status:[published,draft,scheduled]`,
        { headers },
      );
      if (!res.ok) {
        const text = await res.text();
        return new Response(JSON.stringify({ error: `Ghost API Fehler: ${res.status} ${text}` }), {
          status: 502, headers: { "Content-Type": "application/json" },
        });
      }
      const data = await res.json();
      allPosts.push(...data.posts);
      if (!data.meta?.pagination?.next) break;
      page++;
    }

    // Fetch all tags
    const tagsRes = await fetch(`${GHOST_URL}/ghost/api/admin/tags/?limit=all`, { headers });
    const tagsData = tagsRes.ok ? await tagsRes.json() : { tags: [] };
    const allTags: any[] = tagsData.tags || [];

    // Build referenced media map
    const mediaMap = new Map<string, MediaEntry>();

    function addMedia(url: string, type: "image" | "video" | "audio", source: { title: string; slug: string }) {
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

    for (const post of allPosts) {
      const source = { title: post.title, slug: post.slug };
      if (post.feature_image) addMedia(post.feature_image, "image", source);
      if (post.html) {
        for (const m of extractMediaUrls(post.html)) addMedia(m.url, m.type, source);
      }
    }
    for (const tag of allTags) {
      if (tag.feature_image) {
        addMedia(tag.feature_image, "image", { title: `Tag: ${tag.name}`, slug: `tag/${tag.slug}` });
      }
    }

    // Filesystem scan: find all original files (skip _o variants and size variants)
    const referencedUrls = new Set(mediaMap.keys());
    const imagesDir = join(GHOST_CONTENT, "images");
    const mediaDir = join(GHOST_CONTENT, "media");

    // Scan images (skip /size/ subdirectory)
    const allImageFiles = (await walkDir(imagesDir)).filter((f) => !f.includes("/size/") && !f.endsWith("_o" + extname(f).replace(extname(f), "") + extname(f)));
    // Better: skip _o files
    const originalImageFiles = allImageFiles.filter((f) => {
      const base = f.replace(extname(f), "");
      return !base.endsWith("_o");
    });

    for (const filePath of originalImageFiles) {
      const relativePath = filePath.replace(GHOST_CONTENT + "/", "");
      const url = `${GHOST_URL}/content/${relativePath}`;
      if (!mediaMap.has(url)) {
        const filename = filePath.split("/").pop() || "";
        const type = classifyFile(filename);
        if (type) {
          try {
            const stat = await fs.stat(filePath);
            mediaMap.set(url, { url, filename, type, usedIn: [], sizeBytes: stat.size, onDisk: true, relativePath });
          } catch { /* skip */ }
        }
      }
    }

    // Scan media (videos, audio)
    const allMediaFiles = (await walkDir(mediaDir)).filter((f) => {
      const base = f.replace(extname(f), "");
      return !base.endsWith("_thumb") && !base.endsWith("_o");
    });

    for (const filePath of allMediaFiles) {
      const relativePath = filePath.replace(GHOST_CONTENT + "/", "");
      const url = `${GHOST_URL}/content/${relativePath}`;
      if (!mediaMap.has(url)) {
        const filename = filePath.split("/").pop() || "";
        const type = classifyFile(filename);
        if (type) {
          try {
            const stat = await fs.stat(filePath);
            mediaMap.set(url, { url, filename, type, usedIn: [], sizeBytes: stat.size, onDisk: true, relativePath });
          } catch { /* skip */ }
        }
      }
    }

    // Enrich referenced media with filesystem info
    for (const [url, entry] of mediaMap) {
      if (entry.onDisk === undefined) {
        // Try to find on disk
        const contentPath = url.replace(`${GHOST_URL}/content/`, "");
        const fullPath = join(GHOST_CONTENT, contentPath);
        try {
          const stat = await fs.stat(fullPath);
          entry.sizeBytes = stat.size;
          entry.onDisk = true;
          entry.relativePath = contentPath;
        } catch {
          entry.onDisk = false;
        }
      }
    }

    const media = Array.from(mediaMap.values());
    const stats = {
      total: media.length,
      images: media.filter((m) => m.type === "image").length,
      videos: media.filter((m) => m.type === "video").length,
      audio: media.filter((m) => m.type === "audio").length,
      unused: media.filter((m) => m.usedIn.length === 0).length,
    };

    // Storage info
    const diskInfo = getStorageInfo();
    const [imagesSize, mediaSize] = await Promise.all([
      getContentSize(imagesDir),
      getContentSize(mediaDir),
    ]);

    const storage = {
      ...diskInfo,
      contentBytes: imagesSize + mediaSize,
      imagesBytes: imagesSize,
      mediaBytes: mediaSize,
    };

    return new Response(JSON.stringify({ media, stats, storage }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Serverfehler: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
