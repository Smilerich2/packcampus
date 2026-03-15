import type { APIRoute } from "astro";
import { generateGhostJwt } from "./media-scan";

const GHOST_URL = "https://cms.packcampus.de";

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const token = formData.get("token") as string;
    const file = formData.get("file") as File | null;
    const purpose = (formData.get("purpose") as string) || "image";

    const correct = process.env.ADMIN_PASSWORD || "";
    if (!token || token !== correct) {
      return new Response(JSON.stringify({ error: "Nicht autorisiert." }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }

    if (!file) {
      return new Response(JSON.stringify({ error: "Keine Datei hochgeladen." }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const adminKey = process.env.GHOST_ADMIN_API_KEY || "";
    if (!adminKey || !adminKey.includes(":")) {
      return new Response(JSON.stringify({ error: "GHOST_ADMIN_API_KEY nicht konfiguriert." }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const jwt = generateGhostJwt(adminKey);

    // Determine Ghost upload endpoint
    let endpoint: string;
    if (purpose === "media") {
      endpoint = `${GHOST_URL}/ghost/api/admin/media/upload/`;
    } else {
      endpoint = `${GHOST_URL}/ghost/api/admin/images/upload/`;
    }

    // Forward to Ghost Admin API
    const ghostForm = new FormData();
    ghostForm.append("file", file, file.name);
    if (purpose === "media") {
      // Ghost requires a thumbnail for video uploads
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) {
        // Create a minimal placeholder thumbnail if none provided
        const thumb = formData.get("thumbnail") as File | null;
        if (thumb) {
          ghostForm.append("thumbnail", thumb, thumb.name);
        }
      }
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Ghost ${jwt}` },
      body: ghostForm,
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: `Ghost Upload Fehler: ${res.status} ${text}` }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    // Ghost returns { images: [{ url, ref }] } for images
    // or { media: [{ url, ref }] } for media
    const uploadedUrl = data.images?.[0]?.url || data.media?.[0]?.url || null;

    return new Response(JSON.stringify({ success: true, url: uploadedUrl }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Serverfehler: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
