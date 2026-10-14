import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { DiffImageCache, type DiffImageState } from "./diffImageCache";

const caches: DiffImageCache[] = [];
function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<A>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  for (const cache of caches.splice(0)) cache.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function make(options: ConstructorParameters<typeof DiffImageCache>[0]) {
  const cache = new DiffImageCache(options);
  caches.push(cache);
  return cache;
}

function acquire(cache: DiffImageCache, key: string) {
  const ready = deferred<Extract<DiffImageState, { status: "ready" }>>();
  const states: DiffImageState[] = [];
  const release = cache.acquire(
    { key, url: `https://images.test/${key}`, sizeBytes: 3, dimensions: { width: 1, height: 1 } },
    (state) => {
      states.push(state);
      if (state.status === "ready") ready.resolve(state);
      if (state.status === "error") ready.reject(new Error("Image failed"));
    },
  );
  return { ready: ready.promise, release, states };
}

describe("DiffImageCache", () => {
  it("shares one download and object URL between visible consumers", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const cache = make({});
    const first = acquire(cache, "same");
    const second = acquire(cache, "same");
    expect(await first.ready).toEqual(await second.ready);
    first.release();
    second.release();
    const again = acquire(cache, "same");
    expect(await again.ready).toEqual(await first.ready);
    again.release();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used unpinned image at the count limit and revokes its URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const cache = make({ maxImages: 2 });
    const first = acquire(cache, "first");
    const firstUrl = (await first.ready).url;
    first.release();
    const second = acquire(cache, "second");
    const secondUrl = (await second.ready).url;
    second.release();
    const reused = acquire(cache, "first");
    await reused.ready;
    reused.release();
    const third = acquire(cache, "third");
    await third.ready;
    expect(revoke).toHaveBeenCalledWith(secondUrl);
    expect(revoke).not.toHaveBeenCalledWith(firstUrl);
    third.release();
  });

  it("retries a shared failure with a fresh URL while another consumer stays mounted", async () => {
    const response = deferred<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(response.promise)
      .mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const cache = make({});
    const failed = deferred<void>();
    const peerReady = deferred<DiffImageState>();
    const request = {
      key: "shared",
      url: "https://images.test/expired",
      sizeBytes: 3,
      dimensions: { width: 1, height: 1 },
    };
    const release = cache.acquire(request, () => {});
    const releasePeer = cache.acquire(request, (state) => {
      if (state.status === "error") failed.resolve();
      if (state.status === "ready") peerReady.resolve(state);
    });
    response.resolve(new Response(null, { status: 503 }));
    await failed.promise;
    release();
    cache.retry("shared", "https://images.test/fresh");
    const again = acquire(cache, "shared");
    expect(await again.ready).toEqual(await peerReady.promise);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe("https://images.test/fresh");
    again.release();
    releasePeer();
  });

  it("reports capacity without evicting visible images, then resumes on release", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    // Each request reserves 2 * 3 source bytes + 4 decoded bytes.
    const cache = make({ maxImages: 3, maxMemoryBytes: 20 });
    const first = acquire(cache, "first");
    const firstUrl = (await first.ready).url;
    const second = acquire(cache, "second");
    const secondUrl = (await second.ready).url;
    const waiting = acquire(cache, "waiting");
    expect(waiting.states).toEqual([{ status: "queued" }, { status: "capacity" }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    first.release();
    await waiting.ready;
    expect(revoke).toHaveBeenCalledWith(firstUrl);
    expect(revoke).not.toHaveBeenCalledWith(secondUrl);
    second.release();
    waiting.release();
  });

  it("aborts a download when its last visible consumer leaves", async () => {
    const aborted = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener(
              "abort",
              () => {
                aborted.resolve();
                reject(new DOMException("Cancelled", "AbortError"));
              },
              { once: true },
            );
          }),
      ),
    );
    const cache = make({});
    const release = cache.acquire(
      {
        key: "pending",
        url: "https://images.test/pending",
        sizeBytes: 3,
        dimensions: { width: 1, height: 1 },
      },
      () => {},
    );
    release();
    await aborted.promise;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
