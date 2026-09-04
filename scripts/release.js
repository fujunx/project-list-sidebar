#!/usr/bin/env node
/**
 * 一条龙发布：递增版本号 -> 打包 .vsix -> git add/commit -> 打 tag -> push。
 * 默认直接执行；设 RELEASE_DRY_RUN=1 只做「递增版本 + 打包」，先预览 git 命令而不执行。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const DRY = process.env.RELEASE_DRY_RUN === "1";

function sh(cmd) {
  console.log("> " + cmd);
  execSync(cmd, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}
function gitStep(cmd) {
  if (DRY) {
    console.log("[dry] " + cmd);
    return;
  }
  sh(cmd);
}

// 1) 递增版本号（patch +1，满 9 进位到 minor）
const raw = fs.readFileSync(pkgPath, "utf8");
let pkg;
try {
  pkg = JSON.parse(raw);
} catch (e) {
  console.error("package.json 解析失败：", e.message);
  process.exit(1);
}
const [maj, min, pat] = String(pkg.version || "0.0.0")
  .split(".")
  .map((n) => Number(n) || 0);
let minor = min;
let patch = pat + 1;
if (patch > 9) {
  patch = 0;
  minor = minor + 1;
}
const next = `${maj}.${minor}.${patch}`;
fs.writeFileSync(pkgPath, raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${next}"`));
console.log(`版本号更新：${pkg.version} -> ${next}`);

// 2) 打包
sh("npm run vsix");

// 3) 确认产物存在
const vsixName = `project-list-sidebar-${next}.vsix`;
const vsixPath = path.join(root, vsixName);
if (!fs.existsSync(vsixPath)) {
  console.error(`未找到打包产物：${vsixName}`);
  process.exit(1);
}

// 4) git：暂存 -> 提交 -> 打标签 -> 推送
gitStep(`git add package.json "${vsixName}"`);
gitStep(`git commit -m "release v${next}"`);
gitStep(`git tag v${next}`);
gitStep(`git push origin main`);
gitStep(`git push origin v${next}`);

console.log(
  DRY
    ? `\n[dry-run] 完成（未执行 git 步骤）：v${next}`
    : `\n完成！已发布 v${next}，Release 将由 GitHub Actions 自动创建。`
);
