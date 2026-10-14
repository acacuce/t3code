export const LFS_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const LFS_IMAGE_MAX_PIXELS = 32 * 1024 * 1024;

/** Only complete, plain v1 pointers are previewable; extensions can transform the stored bytes. */
export function parseLfsPointer(contents: string) {
  if (contents.length >= 1024) return null;
  // This URL identifies the Git LFS pointer format, regardless of repository host; it is never fetched.
  const match =
    /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (0|[1-9][0-9]*)\n?$/.exec(
      contents,
    );
  if (!match) return null;
  const size = Number(match[2]);
  return Number.isSafeInteger(size) ? { oid: match[1]!, size } : null;
}
