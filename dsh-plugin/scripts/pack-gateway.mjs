#!/usr/bin/env node
// prepack：把网关（仓库根的 src/ + 工具快照 + 许可证）复制进 dsh-plugin/gateway/。
//
// 为什么要在发包时复制一份：
//   npm 包只能打包自己目录以内的文件，装到 node_modules 里以后就没有「兄弟目录」了
//   （本地开发是 dsh-plugin/ 与 src/ 同级，插件默认从上一级找网关）。所以发布时把
//   src/ 复制到 dsh-plugin/gateway/src/，插件在找不到仓库布局的网关时会退到这份副本。
//
// 生成物不进版本库（见根 .gitignore）：唯一事实来源永远是仓库根的 src/，
// 每次 pack / publish 重新生成，避免「副本改了、源码没改」这类只有发布时才暴露的漂移。
//
// 用法：npm pack / npm publish 会自动跑（package.json 的 prepack）；
//       也可以手动 `node scripts/pack-gateway.mjs` 看它复制了哪些文件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');
const GATEWAY = path.join(PACKAGE_ROOT, 'gateway');

/** 要复制的条目：[源（相对仓库根）, 目标（相对 dsh-plugin/）]。 */
const ITEMS = [
  ['src', 'gateway/src'],
  ['data/tools-model.json', 'gateway/data/tools-model.json'],
  ['config.example.json', 'gateway/config.example.json'],
  ['LICENSE', 'LICENSE'],
];

/** 递归复制目录（只复制文件；node_modules 之类不存在于 src/ 下）。 */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

function main() {
  if (!fs.existsSync(path.join(REPO_ROOT, 'src', 'bundles.mjs'))) {
    throw new Error(`找不到网关源码：${REPO_ROOT}/src/bundles.mjs。本脚本必须在仓库内运行。`);
  }
  // 先清掉上一次的生成物：留着会在 src/ 删掉某个模块时留下幽灵文件。
  fs.rmSync(GATEWAY, { recursive: true, force: true });
  fs.rmSync(path.join(PACKAGE_ROOT, 'LICENSE'), { force: true });

  const copied = [];
  for (const [from, to] of ITEMS) {
    const source = path.join(REPO_ROOT, from);
    const target = path.join(PACKAGE_ROOT, to);
    if (!fs.existsSync(source)) {
      // 快照缺失不算错误：网关第一次连上 REA 会自己生成。缺了只是面板进不去快照口径。
      // 一律写 stderr：npm pack --json / npm publish 读的是 stdout，别把 JSON 污染掉。
      console.error(`跳过（源不存在）：${from}`);
      continue;
    }
    const stat = fs.statSync(source);
    if (stat.isDirectory()) copyDir(source, target);
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    copied.push(to);
  }

  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(PACKAGE_ROOT, full).split(path.sep).join('/'));
    }
  })(GATEWAY);

  const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(PACKAGE_ROOT, file)).size, 0);
  console.error(`已把网关复制进 dsh-plugin/：${copied.join('、')}`);
  console.error(`gateway/ 共 ${files.length} 个文件，${(bytes / 1024).toFixed(1)} KB`);
}

main();