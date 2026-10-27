// 预设的独立存储：一个不随插件包被替换的用户级文件。
//
// 为什么不能继续把预设留在 config.json 里：
//   config.json 的位置由 REA_LITE_CONFIG 决定；没设时落在「网关根目录」。
//   npm 安装的网关根是 <profile>/node_modules/dsh-rea-lite-panel/gateway —— 在包目录**里面**。
//   而插件升级（dsh plugin add / 更新）会整体替换包目录，config.json 连同 presets 一起被删。
//   实测这就是「更新一次插件，存好的几套视角全没了」的来源。
//
// 所以预设单独存一份，放在用户级目录，位置与网关/插件的安装位置**无关**。
// 这与预设自身的性质相符：它只记「勾了哪些族 + 用哪档裁剪」，不含任何本机路径（见 presets.mjs），
// 本来就是可以跨安装、跨 profile 复用的用户数据。
//
// 路径解析（逐条优先）：
//   1. REA_LITE_PRESETS   —— 直接指定文件（自检脚本与高级用户用）
//   2. REA_LITE_DATA_DIR  —— 指定目录，文件名为 presets.json
//   3. <用户数据根>/rea-lite/presets.json，用户数据根 = DSH_HOME 或 ~/.dsh
//      （README 里推荐的 REA_LITE_CONFIG 位置也是 ~/.dsh/rea-lite/，两者相邻）
//
// 本模块只做「路径 + 读写」，不 import config.mjs：config.mjs 要用它来取/存预设，
// 反向引用会成环。纯预设逻辑仍然只在 presets.mjs 里。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePresets } from './presets.mjs';

/** 存储文件格式版本；将来换格式时靠它判断要不要迁移。 */
export const PRESET_STORE_VERSION = 1;
export const PRESET_STORE_FILE = 'presets.json';

/** 用户数据根目录：DSH_HOME 优先，否则 ~/.dsh。 */
export function userDataRoot() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured.trim());
  return path.join(os.homedir(), '.dsh');
}

/** rea-lite 的用户数据目录（预设等用户级数据放这里）。 */
export function userDataDir() {
  return path.join(userDataRoot(), 'rea-lite');
}

/**
 * 预设存储文件的实际路径。
 *
 * 注意：这里**故意不看** REA_LITE_CONFIG —— 若跟着 config.json 走，config.json 装在包内时
 * 预设也会一起被装进包内，等于没修。预设的位置只认上面那三条。
 */
export function presetStorePath() {
  const explicitFile = process.env.REA_LITE_PRESETS;
  if (typeof explicitFile === 'string' && explicitFile.trim() !== '') return path.resolve(explicitFile.trim());
  const explicitDir = process.env.REA_LITE_DATA_DIR;
  if (typeof explicitDir === 'string' && explicitDir.trim() !== '') {
    return path.join(path.resolve(explicitDir.trim()), PRESET_STORE_FILE);
  }
  return path.join(userDataDir(), PRESET_STORE_FILE);
}

/**
 * 读预设存储。
 * @returns {{ path: string, exists: boolean, presets: object, error?: string }}
 * 坏文件不抛异常：预设丢了不该让 CLI/面板整页打不开，读成空表并如实报出 error。
 */
export function readPresetStore(file = presetStorePath()) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { path: file, exists: false, presets: {} };
    return { path: file, exists: false, presets: {}, error: `读取预设存储失败：${error.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { path: file, exists: true, presets: {}, error: `预设存储不是合法 JSON（${file}）：${error.message}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { path: file, exists: true, presets: {}, error: `预设存储格式不对（应为对象）：${file}` };
  }
  // 只认 { version, presets } 这一种外壳，避免「某条预设恰好叫 version」这类歧义。
  if (!Object.hasOwn(parsed, 'presets')) {
    return { path: file, exists: true, presets: {}, error: `预设存储缺少 presets 字段：${file}` };
  }
  return { path: file, exists: true, presets: normalizePresets(parsed.presets) };
}

/**
 * 写预设存储（先写临时文件再改名，避免写一半断电留下半个文件）。
 * 目录不存在就建；写失败**抛异常**，由调用方决定是回退还是报错——静默丢失是最坏的结果。
 */
export function writePresetStore(presets, file = presetStorePath()) {
  const payload = { version: PRESET_STORE_VERSION, presets: normalizePresets(presets) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return { path: file, count: Object.keys(payload.presets).length };
}

/**
 * 存储的展示信息（CLI 与面板共用一处口径）。
 * @returns {{ path: string, dir: string, exists: boolean, count: number, writable: boolean, error?: string }}
 */
export function describePresetStore() {
  const file = presetStorePath();
  const store = readPresetStore(file);
  let writable = true;
  try {
    if (fs.existsSync(file)) fs.accessSync(file, fs.constants.W_OK);
    else fs.accessSync(fs.existsSync(path.dirname(file)) ? path.dirname(file) : userDataRoot(), fs.constants.W_OK);
  } catch {
    writable = false;
  }
  return {
    path: file,
    dir: path.dirname(file),
    exists: store.exists,
    count: Object.keys(store.presets).length,
    writable,
    ...(store.error === undefined ? {} : { error: store.error }),
  };
}
