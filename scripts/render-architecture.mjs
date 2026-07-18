import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./process.mjs";

const WIDTH = 1800;
const HEIGHT = 1200;
const source = resolve(ROOT, "docs", "assets", "policytwin-architecture.svg");
const defaultOutput = resolve(ROOT, "artifacts", "screenshots", "08-architecture.png");
const rootStat = lstatSync(ROOT);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
  throw new Error("Repository root must be a physical directory.");
}
const physicalRoot = realpathSync.native(ROOT);

function assertPhysicalRepositoryPath(path, label) {
  const physicalPath = realpathSync.native(path);
  const physicalRelative = relative(physicalRoot, physicalPath);
  if (
    physicalRelative.startsWith("..") ||
    isAbsolute(physicalRelative) ||
    physicalRelative.split(/[\\/]/u).some((segment) => segment === "..")
  ) {
    throw new Error(`${label} resolves outside the physical repository root.`);
  }
}

function resolveOutput(args) {
  if (args.length === 0) return defaultOutput;
  if (args.length !== 2 || args[0] !== "--output" || args[1].length === 0) {
    throw new Error(
      "Usage: node scripts/render-architecture.mjs [--output <repository-artifact-path>]",
    );
  }
  const candidate = resolve(ROOT, args[1]);
  const relativePath = relative(ROOT, candidate).replaceAll("\\", "/");
  if (
    relativePath === "artifacts" ||
    !relativePath.startsWith("artifacts/") ||
    relativePath.includes("../") ||
    !relativePath.endsWith(".png")
  ) {
    throw new Error("Architecture output must be a PNG under repository artifacts/.");
  }
  return candidate;
}

const output = resolveOutput(process.argv.slice(2));

function assertManagedFile(path, label) {
  const relativePath = relative(ROOT, path);
  if (relativePath.length === 0 || relativePath.startsWith("..") || relativePath.includes("..")) {
    throw new Error(`${label} escaped the repository root.`);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular repository file.`);
  }
  assertPhysicalRepositoryPath(path, label);
}

function prepareManagedOutput(path) {
  const parent = dirname(path);
  const parentRelative = relative(ROOT, parent);
  if (parentRelative.startsWith("..") || isAbsolute(parentRelative)) {
    throw new Error("Architecture output parent escaped the repository root.");
  }
  let current = ROOT;
  for (const segment of parentRelative.split(/[\\/]/u).filter(Boolean)) {
    current = resolve(current, segment);
    if (!existsSync(current)) mkdirSync(current);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Architecture output parents must be physical repository directories.");
    }
    assertPhysicalRepositoryPath(current, "Architecture output parent");
  }
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Architecture output must be a regular repository file when present.");
    }
    assertPhysicalRepositoryPath(path, "Architecture output");
  }
  return parent;
}

assertManagedFile(source, "Architecture SVG");
const svg = readFileSync(source, "utf8");
const svgWithoutStandardNamespace = svg.replace(
  'xmlns="http://www.w3.org/2000/svg"',
  "",
);
if (
  !svg.includes(`width="${WIDTH}" height="${HEIGHT}"`) ||
  !svg.includes(`viewBox="0 0 ${WIDTH} ${HEIGHT}"`) ||
  /<script\b|https?:\/\/|xlink:href|<image\b/iu.test(svgWithoutStandardNamespace)
) {
  throw new Error("Architecture SVG is not self-contained or has the wrong canvas.");
}

const outputParent = prepareManagedOutput(output);
const temporaryOutput = resolve(
  outputParent,
  `.${basename(output)}.${randomBytes(16).toString("hex")}.png`,
);
if (existsSync(temporaryOutput)) throw new Error("Architecture temporary output already exists.");

let promoted = false;
try {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-gpu", "--disable-lcd-text", "--font-render-hinting=none"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(source).href, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolvePaint) => {
        requestAnimationFrame(() => requestAnimationFrame(resolvePaint));
      });
    });
    const dimensions = await page.evaluate(() => {
      const root = document.documentElement;
      return {
        width: Number(root.getAttribute("width")),
        height: Number(root.getAttribute("height")),
      };
    });
    if (dimensions.width !== WIDTH || dimensions.height !== HEIGHT) {
      throw new Error("Rendered architecture dimensions do not match the contract.");
    }
    await page.screenshot({
      path: temporaryOutput,
      type: "png",
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      animations: "disabled",
    });
    await context.close();
  } finally {
    await browser.close();
  }

  assertManagedFile(temporaryOutput, "Architecture temporary PNG");
  prepareManagedOutput(output);
  if (existsSync(output)) rmSync(output, { force: true });
  renameSync(temporaryOutput, output);
  promoted = true;
} finally {
  if (!promoted && existsSync(temporaryOutput)) rmSync(temporaryOutput, { force: true });
}

assertManagedFile(output, "Architecture PNG");
console.log(`Rendered truthful architecture asset: ${relative(ROOT, output)}`);
