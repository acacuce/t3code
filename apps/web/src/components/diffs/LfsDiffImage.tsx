import type { ScopedThreadRef } from "@t3tools/contracts";
import { MISSING_FILE_ACCESS_MESSAGE } from "@t3tools/client-runtime/state/assets";
import { LFS_IMAGE_MAX_BYTES, parseLfsPointer } from "@t3tools/shared/gitLfs";
import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "~/hooks/useStableCallback";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import type { DiffImageState } from "~/lib/diffImageCache";
import { useDelayedStatus } from "~/hooks/useDelayedStatus";
import { useDiffImageCache } from "./DiffImageCacheProvider";

export interface LfsImageSide {
  readonly oid: string;
  readonly size: number;
  readonly path: string;
  readonly label: string;
}

/** Reads only the bounded pointer already in the patch; never loads full-file diff contents. */
export function lfsImageSide(
  lines: readonly string[],
  path: string,
  label: string,
): LfsImageSide | null {
  if (lines.length > 4 || lines.some((line) => line.length > 1024)) return null;
  const pointer = parseLfsPointer(lines.join(""));
  return pointer ? { ...pointer, path, label } : null;
}

function ImageLoading({ progress, queued = false }: { progress?: number; queued?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Spinner size="lg" />
      <span>
        {queued
          ? "Waiting for image…"
          : progress === undefined
            ? "Loading image…"
            : `Loading image… ${progress}%`}
      </span>
    </div>
  );
}

function ImageFailure({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs text-muted-foreground">
        Image unavailable locally or exceeds preview limits. Fetch missing LFS objects to view them.
      </p>
      <Button size="compact" variant="ghost" onClick={retry}>
        Retry image
      </Button>
    </div>
  );
}

function LfsImageContent({
  image,
  threadRef,
}: {
  image: LfsImageSide;
  threadRef: ScopedThreadRef;
}) {
  const resource = {
    _tag: "lfs-image" as const,
    threadId: threadRef.threadId,
    oid: image.oid,
    path: image.path,
  };
  const asset = useAssetUrlState(threadRef.environmentId, resource);
  const refresh = useAssetUrlRefresh(threadRef.environmentId, resource);
  const cache = useDiffImageCache();
  const cacheKey = `${threadRef.environmentId}:${image.oid}`;
  const [state, setState] = useState<DiffImageState>({ status: "queued" });
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const url = asset._tag === "Success" ? asset.url : undefined;
  const width = asset._tag === "Success" ? asset.imageDimensions?.width : undefined;
  const height = asset._tag === "Success" ? asset.imageDimensions?.height : undefined;
  useEffect(() => {
    if (!url || retrying) return;
    return cache.acquire(
      {
        key: cacheKey,
        url,
        sizeBytes: image.size,
        ...(width !== undefined && height !== undefined ? { dimensions: { width, height } } : {}),
      },
      setState,
    );
  }, [cache, cacheKey, url, image.size, width, height, retrying]);

  const blobUrl = state.status === "ready" ? state.url : null;
  const loaded = useStableCallback((element: HTMLImageElement) => {
    cache.decoded(cacheKey, element.naturalWidth, element.naturalHeight);
    setDecodedUrl(element.src);
  });
  // A recycled slot can attach an already-loaded image without another load event.
  useEffect(() => {
    const element = imageRef.current;
    if (blobUrl && element?.complete && element.naturalWidth > 0) loaded(element);
  }, [blobUrl, loaded]);

  const loading =
    retrying ||
    asset._tag === "Loading" ||
    (asset._tag === "Success" &&
      state.status !== "error" &&
      state.status !== "capacity" &&
      (state.status !== "ready" || decodedUrl !== blobUrl));
  const waitingForCapacity = asset._tag === "Success" && state.status === "capacity";
  const showStatus = useDelayedStatus(cacheKey, loading || waitingForCapacity ? true : null);
  const retry = () => {
    setState({ status: "queued" });
    setRetrying(true);
    void refresh()
      .then((freshUrl) => {
        if (freshUrl) cache.retry(cacheKey, freshUrl);
      })
      .catch(() => {})
      .finally(() => setRetrying(false));
  };
  if (asset._tag === "Failure" && asset.reason === "missing-file-access") {
    return <p className="text-xs text-muted-foreground">{MISSING_FILE_ACCESS_MESSAGE}</p>;
  }
  if (!retrying && (asset._tag === "Failure" || state.status === "error")) {
    return <ImageFailure retry={retry} />;
  }
  return (
    <div className="relative flex size-full min-h-0 items-center justify-center">
      {asset._tag === "Success" && state.status === "ready" && !retrying ? (
        <img
          ref={imageRef}
          src={state.url}
          alt={`${image.label}: ${image.path}`}
          decoding="async"
          className="max-h-full max-w-full object-contain"
          onLoad={(event) => loaded(event.currentTarget)}
          onError={() => cache.reject(cacheKey)}
        />
      ) : null}
      {waitingForCapacity && showStatus ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-center text-xs text-muted-foreground">
            Preview paused to limit memory use. Collapse other image files to resume.
          </p>
          <Button
            size="compact"
            variant="ghost"
            render={<a href={url} target="_blank" rel="noopener noreferrer" />}
          >
            Open image
          </Button>
        </div>
      ) : null}
      {loading && showStatus ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <ImageLoading
            queued={asset._tag === "Success" && state.status === "queued"}
            {...(state.status === "loading" ? { progress: state.progress } : {})}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The diff virtualizer mounts nearby expanded files and releases their cache leases offscreen. */
export function LfsDiffImage({
  image,
  threadRef,
}: {
  image: LfsImageSide;
  threadRef: ScopedThreadRef;
}) {
  return (
    <figure className="m-0 flex h-64 flex-col gap-2 border-y border-border/30 bg-background p-3 font-sans">
      <figcaption className="text-xs text-muted-foreground">
        {image.label} · Git LFS · {(image.size / 1024).toFixed(1)} KB
      </figcaption>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {image.size > LFS_IMAGE_MAX_BYTES ? (
          <p className="text-xs text-muted-foreground">Image exceeds the 20 MB preview limit.</p>
        ) : (
          <LfsImageContent key={image.oid} image={image} threadRef={threadRef} />
        )}
      </div>
    </figure>
  );
}
