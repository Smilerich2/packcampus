import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const FEEDBACK_FILE = join(process.cwd(), "data", "feedback.json");

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

    let entries = [];
    try {
      const raw = await fs.readFile(FEEDBACK_FILE, "utf-8");
      entries = JSON.parse(raw);
    } catch {
      entries = [];
    }

    return new Response(JSON.stringify(entries), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Ungültige Anfrage." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
};
