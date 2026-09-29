import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { documents } from "../src/data/documents.js";

const manifest = JSON.parse(
  await readFile("scripts/data/mvp-files.json", "utf8"),
);
const byId = new Map(documents.map(document => [document.id, document]));
const outputDir = "public/acervo";
await mkdir(outputDir, { recursive: true });
for (const item of manifest) {
  const document = byId.get(item.id);
  if (!document) throw new Error(`Registro não encontrado: ${item.id}`);
  const target = path.join(outputDir, item.file);
  if (!existsSync(target)) {
    const source = document.originalPdf ?? document.pdf;
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${response.status} ao baixar ${source}`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    console.log(`baixado ${item.file}`);
  } else console.log(`existente ${item.file}`);
}
