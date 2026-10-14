import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { DiffImageCache } from "~/lib/diffImageCache";

const Context = createContext<DiffImageCache | null>(null);

export function DiffImageCacheProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new DiffImageCache());
  useEffect(() => () => cache.clear(), [cache]);
  return <Context value={cache}>{children}</Context>;
}

export function useDiffImageCache() {
  const cache = useContext(Context);
  if (!cache) throw new Error("Image previews require a diff image cache");
  return cache;
}
