import { createFileRoute } from "@tanstack/react-router";
import { verifyAppToken } from "@/lib/user-auth";

type PixabayVideo = {
  id: number;
  pageURL: string;
  duration: number;
  videos?: {
    large?: { url?: string; width?: number; height?: number; size?: number; thumbnail?: string };
    medium?: { url?: string; width?: number; height?: number; size?: number; thumbnail?: string };
  };
};

type CacheEntry = { expiresAt: number; value: unknown };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export const Route = createFileRoute("/api/pixabay-videos")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        const session = token ? await verifyAppToken(token) : null;
        if (!session || session.role !== "admin") return jsonError("Unauthorized", 401);

        const apiKey = process.env.PIXABAY_API_KEY?.trim();
        if (!apiKey) return jsonError("PIXABAY_API_KEY is not configured on the server", 500);

        const url = new URL(request.url);
        const query = (url.searchParams.get("q") ?? "nature").trim().slice(0, 100);
        const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page") ?? "1") || 1));
        if (!query) return jsonError("Search text is required", 400);

        const cacheKey = `${query.toLowerCase()}::${page}`;
        const cached = cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return Response.json(cached.value);
        if (cached) cache.delete(cacheKey);

        const apiUrl = new URL("https://pixabay.com/api/videos/");
        apiUrl.searchParams.set("key", apiKey);
        apiUrl.searchParams.set("q", query);
        apiUrl.searchParams.set("page", String(page));
        apiUrl.searchParams.set("per_page", "10");
        apiUrl.searchParams.set("min_width", "1920");
        apiUrl.searchParams.set("min_height", "1080");
        apiUrl.searchParams.set("safesearch", "true");

        const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
        const body = (await response.json().catch(() => null)) as {
          total?: number;
          totalHits?: number;
          hits?: PixabayVideo[];
          error?: string;
        } | null;
        if (!response.ok || !body) {
          return jsonError(body?.error || `Pixabay search failed (${response.status})`, 502);
        }

        const videos = (body.hits ?? [])
          .map((hit) => {
            const large = hit.videos?.large;
            return {
              id: hit.id,
              pageURL: hit.pageURL,
              duration: hit.duration,
              videoUrl: large?.url ?? "",
              thumbnail: large?.thumbnail ?? hit.videos?.medium?.thumbnail ?? "",
              width: large?.width ?? 0,
              height: large?.height ?? 0,
            };
          })
          .filter((video) => video.videoUrl && video.width >= 1920 && video.height >= 1080);

        const result = {
          ok: true,
          query,
          page,
          perPage: 10,
          totalHits: body.totalHits ?? body.total ?? 0,
          videos,
        };
        cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
        return Response.json(result, { headers: { "Cache-Control": "private, max-age=86400" } });
      },
    },
  },
});
