import { describe, expect, it } from "vitest";
import { type Fetcher, fetchElevations, MAX_PER_REQUEST } from "./elevation";

const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 35 + i / 1000, lon: -80 }));

// Answers each request with elevation = request index × 1000 + position.
function fakeFetch(calls: string[]): Fetcher {
  return async (url) => {
    calls.push(url);
    const count = new URL(url).searchParams.get("latitude")!.split(",").length;
    const base = (calls.length - 1) * 1000;
    return new Response(JSON.stringify({ elevation: Array.from({ length: count }, (_, i) => base + i) }));
  };
}

describe("fetchElevations", () => {
  it("splits requests at the API limit and keeps the order", async () => {
    const calls: string[] = [];
    const result = await fetchElevations(points(250), { fetcher: fakeFetch(calls) });
    expect(calls).toHaveLength(3);
    expect(result).toHaveLength(250);
    expect(result[0]).toBe(0);
    expect(result[MAX_PER_REQUEST]).toBe(1000);
    expect(result[249]).toBe(2049);
  });

  it("passes the API's error reason through", async () => {
    const fetcher: Fetcher = async () =>
      new Response(JSON.stringify({ error: true, reason: "Latitude must be in range" }), { status: 400 });
    await expect(fetchElevations(points(2), { fetcher })).rejects.toThrow("Latitude must be in range");
  });

  it("rejects a response with the wrong number of values", async () => {
    const fetcher: Fetcher = async () => new Response(JSON.stringify({ elevation: [1] }));
    await expect(fetchElevations(points(2), { fetcher })).rejects.toThrow("unexpected response");
  });
});
