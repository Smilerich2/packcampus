import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { join, extname, dirname, basename } from "node:path";
import { generateGhostJwt } from "./media-scan";

const GHOST_CONTENT = process.env.GHOST_CONTENT_PATH || "/ghost-content";
const GHOST_URL = "https://cms.packcampus.de";

async function findSizeVariants(relativePath: string): Promise<string[]> {
  // Ghost creates responsive variants in /images/size/w{320,600,960,1200,1600,2000}/...
  const sizeDir = join(GHOST_CONTENT, "images", "size");
  const variants: string[] = [];
  try {
    const widths = await fs.readdir(sizeDir);
    for (const w of widths) {
      // Direct variant: /size/w600/2026/03/file.jpg
      const directPath = join(sizeDir, w, relativePath.replace(/^images\//, ""));
      try {
        await fs.access(directPath);
        variants.push(directPath);
      } catch { /* doesn't exist */ }

      // WebP variant: /size/w600/format/webp/2026/03/file.jpg
      const webpPath = join(sizeDir, w, "format", "webp", relativePath.replace(/^images\//, ""));
      try {
        await fs.access(webpPath);
        variants.push(webpPath);
      } catch { /* doesn't exist */ }
    }
  } catch { /* size dir doesn't exist */ }
  return variants;
}

function getOriginalPath(filePath: string): string {
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  return join(dirname(filePath), `${base}_o${ext}`);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      token?: string;
      action?: string;
      url?: string;
      newFilename?: string;
    };

    const correct = process.env.ADMIN_PASSWORD || "";
    if (!body.token || body.token !== correct) {
      return new Response(JSON.stringify({ error: "Nicht autorisiert." }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }

    const adminKey = process.env.GHOST_ADMIN_API_KEY || "";

    switch (body.action) {
      case "delete": {
        if (!body.url) {
          return new Response(JSON.stringify({ error: "URL fehlt." }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }

        const relativePath = body.url.replace(`${GHOST_URL}/content/`, "");
        const fullPath = join(GHOST_CONTENT, relativePath);
        const deletedFiles: string[] = [];

        // Delete the main file
        try {
          await fs.unlink(fullPath);
          deletedFiles.push(relativePath);
        } catch (err: any) {
          return new Response(JSON.stringify({ error: `Datei nicht gefunden: ${relativePath}` }), {
            status: 404, headers: { "Content-Type": "application/json" },
          });
        }

        // Delete _o (original) variant
        const origPath = getOriginalPath(fullPath);
        try {
          await fs.unlink(origPath);
          deletedFiles.push(origPath.replace(GHOST_CONTENT + "/", ""));
        } catch { /* no _o variant */ }

        // Delete size variants (images only)
        if (relativePath.startsWith("images/")) {
          const variants = await findSizeVariants(relativePath);
          for (const v of variants) {
            try {
              await fs.unlink(v);
              deletedFiles.push(v.replace(GHOST_CONTENT + "/", ""));
            } catch { /* already gone */ }
          }
        }

        return new Response(JSON.stringify({ success: true, deletedFiles }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      case "rename": {
        if (!body.url || !body.newFilename) {
          return new Response(JSON.stringify({ error: "URL und neuer Dateiname erforderlich." }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }

        // Sanitize new filename
        const newFilename = body.newFilename.replace(/[^a-zA-Z0-9._-]/g, "-");
        if (!newFilename || newFilename === "." || newFilename === "..") {
          return new Response(JSON.stringify({ error: "Ungültiger Dateiname." }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }

        const relativePath = body.url.replace(`${GHOST_URL}/content/`, "");
        const fullPath = join(GHOST_CONTENT, relativePath);
        const dir = dirname(fullPath);
        const newPath = join(dir, newFilename);
        const newRelativePath = newPath.replace(GHOST_CONTENT + "/", "");
        const newUrl = `${GHOST_URL}/content/${newRelativePath}`;

        // Check source exists
        try {
          await fs.access(fullPath);
        } catch {
          return new Response(JSON.stringify({ error: `Datei nicht gefunden: ${relativePath}` }), {
            status: 404, headers: { "Content-Type": "application/json" },
          });
        }

        // Check target doesn't exist
        try {
          await fs.access(newPath);
          return new Response(JSON.stringify({ error: `Datei existiert bereits: ${newFilename}` }), {
            status: 409, headers: { "Content-Type": "application/json" },
          });
        } catch { /* good, doesn't exist */ }

        // Rename main file
        await fs.rename(fullPath, newPath);

        // Rename _o variant if exists
        const origPath = getOriginalPath(fullPath);
        const newOrigPath = getOriginalPath(newPath);
        try {
          await fs.rename(origPath, newOrigPath);
        } catch { /* no _o variant */ }

        // Delete size variants (Ghost regenerates them on next request)
        if (relativePath.startsWith("images/")) {
          const variants = await findSizeVariants(relativePath);
          for (const v of variants) {
            try { await fs.unlink(v); } catch { /* already gone */ }
          }
        }

        // Update Ghost posts that reference old URL
        let updatedPosts = 0;
        if (adminKey && adminKey.includes(":")) {
          const jwt = generateGhostJwt(adminKey);
          const ghostHeaders = {
            Authorization: `Ghost ${jwt}`,
            "Content-Type": "application/json",
          };

          // Fetch all posts
          const allPosts: any[] = [];
          let page = 1;
          while (true) {
            const res = await fetch(
              `${GHOST_URL}/ghost/api/admin/posts/?formats=html,lexical&limit=100&page=${page}&filter=status:[published,draft,scheduled]`,
              { headers: { Authorization: `Ghost ${jwt}` } },
            );
            if (!res.ok) break;
            const data = await res.json();
            allPosts.push(...data.posts);
            if (!data.meta?.pagination?.next) break;
            page++;
          }

          const oldUrl = body.url;
          for (const post of allPosts) {
            let needsUpdate = false;
            const updates: any = {};

            // Check feature_image
            if (post.feature_image === oldUrl) {
              updates.feature_image = newUrl;
              needsUpdate = true;
            }

            // Check lexical content
            if (post.lexical && post.lexical.includes(oldUrl)) {
              updates.lexical = post.lexical.replaceAll(oldUrl, newUrl);
              needsUpdate = true;
            }

            if (needsUpdate) {
              // Ghost requires updated_at for conflict detection
              updates.updated_at = post.updated_at;
              const putRes = await fetch(
                `${GHOST_URL}/ghost/api/admin/posts/${post.id}/`,
                {
                  method: "PUT",
                  headers: ghostHeaders,
                  body: JSON.stringify({ posts: [updates] }),
                },
              );
              if (putRes.ok) updatedPosts++;
            }
          }

          // Update tags feature_image
          const tagsRes = await fetch(`${GHOST_URL}/ghost/api/admin/tags/?limit=all`, {
            headers: { Authorization: `Ghost ${jwt}` },
          });
          if (tagsRes.ok) {
            const tagsData = await tagsRes.json();
            for (const tag of tagsData.tags || []) {
              if (tag.feature_image === oldUrl) {
                await fetch(`${GHOST_URL}/ghost/api/admin/tags/${tag.id}/`, {
                  method: "PUT",
                  headers: ghostHeaders,
                  body: JSON.stringify({ tags: [{ feature_image: newUrl, updated_at: tag.updated_at }] }),
                });
              }
            }
          }
        }

        return new Response(JSON.stringify({ success: true, newUrl, updatedPosts }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unbekannte Aktion: ${body.action}` }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Serverfehler: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
