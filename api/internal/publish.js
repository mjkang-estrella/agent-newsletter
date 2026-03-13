import { createSupabasePublicationRequestHandler } from "../../src/supabase/runtime.js";

let cachedHandler = null;

export const config = {
  runtime: "nodejs",
};

export default async function publishInternal(request, response) {
  try {
    cachedHandler ??= createSupabasePublicationRequestHandler({
      env: process.env,
    });
    await cachedHandler(request, response);
  } catch (error) {
    response.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify(
        {
          ok: false,
          error: "internal_server_error",
          message: error instanceof Error ? error.message : "Unexpected server error.",
        },
        null,
        2,
      ),
    );
  }
}
