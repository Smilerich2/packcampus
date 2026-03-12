import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { password } = (await request.json()) as { password?: string };
    const correct = process.env.ADMIN_PASSWORD || "";

    if (!password || password !== correct) {
      return new Response(
        JSON.stringify({ error: "Falsches Passwort." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, token: correct }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Ungültige Anfrage." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
};
