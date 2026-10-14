import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";

export class LfsObjects extends Context.Service<
  LfsObjects,
  {
    readonly localPath: (cwd: string, oid: string) => Effect.Effect<string | null>;
  }
>()("t3/assets/LfsObjects") {}

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const path = yield* Path.Path;
  // Both sides and all visible files share one lookup, including concurrent requests.
  const directories = yield* Cache.makeWith(
    (cwd: string) =>
      runner
        .run({
          command: "git",
          args: ["lfs", "env"],
          cwd,
          timeout: "5 seconds",
          maxOutputBytes: 32 * 1024,
        })
        .pipe(
          Effect.map((result) => {
            const directory =
              result.code === 0
                ? /^LocalMediaDir=(.+)$/m.exec(result.stdout)?.[1]?.replace(/\r$/, "")
                : undefined;
            return directory && path.isAbsolute(directory) ? directory : null;
          }),
          Effect.orElseSucceed(() => null),
        ),
    { capacity: 128, timeToLive: () => "1 minute" },
  );

  return LfsObjects.of({
    localPath: Effect.fn("LfsObjects.localPath")(function* (cwd, oid) {
      if (!/^[a-f0-9]{64}$/.test(oid)) return null;
      // `lfs env` respects linked worktrees and custom lfs.storage without transferring files.
      const directory = yield* Cache.get(directories, cwd);
      return directory ? path.join(directory, oid.slice(0, 2), oid.slice(2, 4), oid) : null;
    }),
  });
});

export const layer = Layer.effect(LfsObjects, make);
