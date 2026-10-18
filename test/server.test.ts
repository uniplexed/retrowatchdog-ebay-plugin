import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../src/config.js";
import { makeHandler, type SearchFn } from "../src/server.js";

/**
 * Run one handler on a loopback port for the duration of a test — the same
 * shape the Vinted plugin's tests/test_server.py uses: the server under
 * test is this process, the port is chosen by the kernel, and the search
 * function is injected so the HTTP surface is exercised without eBay.
 */
const servers: ReturnType<typeof createServer>[] = [];

function serve(search: SearchFn, overrides: Parameters<typeof loadSettings>[0] = {}): Promise<string> {
  const settings = loadSettings({ EBAY_PLUGIN_MARKETS: "ebay_uk,ebay_de", ...overrides });
  const server = createServer(makeHandler({ settings, search }));
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

const noSearch: SearchFn = () => {
  throw new Error("the search path must not run for this request");
};

async function get(url: string) {
  const response = await fetch(url);
  const body = await response.json();
  return { status: response.status, contentType: response.headers.get("content-type"), body };
}

describe("the eBay plugin's HTTP surface", () => {
  it("answers /health without calling eBay", async () => {
    const base = await serve(noSearch);
    const { status, contentType, body } = await get(`${base}/health`);
    expect(status).toBe(200);
    expect(contentType).toBe("application/json");
    expect(body).toMatchObject({ status: "ok", protocol: 3, configured: false });
  });

  it("answers /manifest without calling eBay", async () => {
    const base = await serve(noSearch);
    const { status, body } = await get(`${base}/manifest`);
    expect(status).toBe(200);
    expect(body.sources.map((s: { id: string }) => s.id)).toEqual(["ebay_uk", "ebay_de"]);
  });

  it("answers 500 naming the variable when this process is asked to declare a market it cannot", async () => {
    const base = await serve(noSearch, { EBAY_PLUGIN_MARKETS: "ebay_xx" });
    const { status, body } = await get(`${base}/manifest`);
    expect(status).toBe(500);
    expect(body.error).toContain("ebay_xx");
  });

  it("answers 400 when source is missing", async () => {
    const base = await serve(noSearch);
    const { status } = await get(`${base}/search?q=zelda`);
    expect(status).toBe(400);
  });

  it("answers 400 when q is missing", async () => {
    // source is supplied so this fails on the missing q and not one line
    // earlier on the missing source.
    const base = await serve(noSearch);
    const { status } = await get(`${base}/search?source=ebay_uk`);
    expect(status).toBe(400);
  });

  it("answers 404 when source names a market this process does not serve", async () => {
    // This process serves only ebay_uk and ebay_de (see serve()'s default
    // override); ebay_us is a real market, just not one this instance
    // declares — a well-formed request to the wrong process, not a bad one.
    const base = await serve(noSearch);
    const { status } = await get(`${base}/search?source=ebay_us&q=zelda`);
    expect(status).toBe(404);
  });

  it("answers 404 for a source that is not a market at all", async () => {
    const base = await serve(noSearch);
    const { status } = await get(`${base}/search?source=not_a_market&q=zelda`);
    expect(status).toBe(404);
  });

  it("answers 502 on a failed fetch, never 200 with an empty array", async () => {
    const failing: SearchFn = () => {
      throw new Error("eBay said no");
    };
    const base = await serve(failing);
    const { status, body } = await get(`${base}/search?source=ebay_uk&q=zelda`);
    expect(status).toBe(502);
    expect(body.error).toContain("eBay said no");
  });

  it("answers 200 with whatever the injected search function returns, unmodified", async () => {
    const rows = [{ sourceProductId: "1", title: "Super Mario World", prices: [] }];
    const search: SearchFn = async (marketId, query) => {
      expect(marketId).toBe("ebay_uk");
      expect(query.q).toBe("mario");
      return rows;
    };
    const base = await serve(search);
    const { status, body } = await get(`${base}/search?source=ebay_uk&q=mario`);
    expect(status).toBe(200);
    expect(body).toEqual(rows);
  });

  it("finding nothing is an empty array, not an error", async () => {
    const search: SearchFn = async () => [];
    const base = await serve(search);
    const { status, body } = await get(`${base}/search?source=ebay_uk&q=a+game+nobody+lists`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("passes alt, spelling and budgetMs through to the injected search function", async () => {
    const search: SearchFn = async (_marketId, query) => {
      expect(query.platform).toBe("snes");
      expect(query.alt).toEqual(["Super Nintendo"]);
      expect(query.spellings).toEqual(["SNES", "Super Nintendo Entertainment System"]);
      expect(query.budgetMs).toBe(7500);
      return [];
    };
    const base = await serve(search);
    const params = new URLSearchParams();
    params.set("source", "ebay_uk");
    params.set("q", "mario");
    params.set("platform", "snes");
    params.append("alt", "Super Nintendo");
    params.append("spelling", "SNES");
    params.append("spelling", "Super Nintendo Entertainment System");
    params.set("budgetMs", "7500");
    const { status } = await get(`${base}/search?${params}`);
    expect(status).toBe(200);
  });

  it("an unknown query parameter is ignored rather than refused", async () => {
    const base = await serve(async () => []);
    const { status } = await get(`${base}/search?source=ebay_uk&q=zelda&region=PAL&limit=5`);
    expect(status).toBe(200);
  });

  it("an unknown path is a 404", async () => {
    const base = await serve(noSearch);
    expect((await get(`${base}/items/1`)).status).toBe(404);
    expect((await get(`${base}/`)).status).toBe(404);
  });
});
