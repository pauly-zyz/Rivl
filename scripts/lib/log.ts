const COLORS = { chain: 36, fulfill: 35, indexer: 33, web: 94, demo: 32, dev: 34 } as const;
export type LogTag = keyof typeof COLORS;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

export function prefix(tag: LogTag): string {
  const label = `[${tag}]`.padEnd(10);
  return useColor ? `\x1b[${COLORS[tag]}m${label}\x1b[0m` : label;
}

export function logger(tag: LogTag) {
  const p = prefix(tag);
  return {
    info: (...args: unknown[]) => console.log(p, ...args),
    error: (...args: unknown[]) => console.error(p, ...args),
  };
}

/** Teruskan output proses anak baris per baris dengan label. */
export function pipeLines(stream: NodeJS.ReadableStream, tag: LogTag, write = console.log): void {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      write(prefix(tag), buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  stream.on("end", () => {
    if (buf) write(prefix(tag), buf);
  });
}
