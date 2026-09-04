#!/usr/bin/env node
/**
 * 递增 package.json 的版本号（patch +1，patch 超过 9 时进位到 minor）。
 * 只替换 version 一行，其余内容原样保留。
 */
const fs = require("fs");
const path = require("path");

const pkgPath = path.join(__dirname, "..", "package.json");
const raw = fs.readFileSync(pkgPath, "utf-8");
let pkg;
try {
  pkg = JSON.parse(raw);
} catch (e) {
  console.error("package.json 解析失败：", e.message);
  process.exit(1);
}

const parts = String(pkg.version || "0.0.0").split(".").map((n) => Number(n) || 0);
const major = parts[0];
let minor = parts[1];
let patch = parts[2] + 1;
if (patch > 9) {
  patch = 0;
  minor = minor + 1;
}

const next = `${major}.${minor}.${patch}`;
const newRaw = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${next}"`);
fs.writeFileSync(pkgPath, newRaw);

console.log(`版本号更新：${pkg.version} -> ${next}`);
