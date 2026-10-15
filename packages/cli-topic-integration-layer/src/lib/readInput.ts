import { readFile } from "node:fs/promises";

/** The contents of `file`, or of stdin when `file` is `-`. */
export async function readFileOrStdin(file: string): Promise<string> {
  if (file !== "-") return readFile(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
