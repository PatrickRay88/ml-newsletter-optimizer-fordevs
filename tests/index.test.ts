import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directoryPath = __dirname;

void (async () => {
  const fileImports = readdirSync(directoryPath)
    .filter((file) => file.endsWith(".test.ts") && file !== "index.test.ts")
    .map((file) => import(pathToFileURL(join(directoryPath, file)).href));

  await Promise.all(fileImports);
})();
