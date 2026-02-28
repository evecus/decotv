/* eslint-disable no-console */

/**
 * 本地文件存储实现 - 基于 JSON 文件，数据持久化到容器本地磁盘
 *
 * 数据目录优先级：
 *   1. 环境变量 DATA_DIR
 *   2. /app/data（默认）
 *   3. /tmp/decotv-data（兜底，当前两个目录无写权限时自动降级）
 *
 * 建议在 docker-compose.yml 中将数据目录挂载为 volume，确保容器重建后数据不丢失。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { AdminConfig } from './admin.types';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';

// ---- 自动探测可写数据目录 ----

function resolveDataDir(): string {
  const candidates = [
    process.env.DATA_DIR,
    '/app/data',
    path.join(os.tmpdir(), 'decotv-data'),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // 写一个测试文件确认有写权限
      const testFile = path.join(dir, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      console.log(`[FileStorage] 使用数据目录: ${dir}`);
      return dir;
    } catch {
      console.warn(`[FileStorage] 目录无写权限，跳过: ${dir}`);
    }
  }

  throw new Error('[FileStorage] 没有找到可写的数据目录，请检查权限或设置 DATA_DIR 环境变量');
}

const DATA_DIR = resolveDataDir();

// ---- 文件读写工具 ----

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`[FileStorage] 读取文件失败: ${filePath}`, err);
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  try {
    ensureDir(path.dirname(filePath));
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error(`[FileStorage] 写入文件失败: ${filePath}`, err);
    throw err;
  }
}

// ---- 路径工具 ----

function adminConfigPath(): string {
  return path.join(DATA_DIR, 'admin.json');
}

function usersPath(): string {
  return path.join(DATA_DIR, 'users.json');
}

function userFilePath(subdir: string, userName: string): string {
  const safe = userName.replace(/[^a-zA-Z0-9_\-@.]/g, '_');
  return path.join(DATA_DIR, subdir, `${safe}.json`);
}

// ---- 存储实现 ----

export class FileStorage implements IStorage {
  constructor() {
    ensureDir(DATA_DIR);
    ensureDir(path.join(DATA_DIR, 'playrecords'));
    ensureDir(path.join(DATA_DIR, 'favorites'));
    ensureDir(path.join(DATA_DIR, 'searchhistory'));
    ensureDir(path.join(DATA_DIR, 'skipconfigs'));
    console.log(`[FileStorage] 本地文件存储已初始化，数据目录: ${DATA_DIR}`);
  }

  // ========== 播放记录 ==========

  async getPlayRecord(userName: string, key: string): Promise<PlayRecord | null> {
    const records = readJson<Record<string, PlayRecord>>(
      userFilePath('playrecords', userName), {},
    );
    return records[key] ?? null;
  }

  async setPlayRecord(userName: string, key: string, record: PlayRecord): Promise<void> {
    const filePath = userFilePath('playrecords', userName);
    const records = readJson<Record<string, PlayRecord>>(filePath, {});
    records[key] = record;
    writeJson(filePath, records);
  }

  async getAllPlayRecords(userName: string): Promise<Record<string, PlayRecord>> {
    return readJson<Record<string, PlayRecord>>(
      userFilePath('playrecords', userName), {},
    );
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    const filePath = userFilePath('playrecords', userName);
    const records = readJson<Record<string, PlayRecord>>(filePath, {});
    delete records[key];
    writeJson(filePath, records);
  }

  // ========== 收藏 ==========

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const favorites = readJson<Record<string, Favorite>>(
      userFilePath('favorites', userName), {},
    );
    return favorites[key] ?? null;
  }

  async setFavorite(userName: string, key: string, favorite: Favorite): Promise<void> {
    const filePath = userFilePath('favorites', userName);
    const favorites = readJson<Record<string, Favorite>>(filePath, {});
    favorites[key] = favorite;
    writeJson(filePath, favorites);
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    return readJson<Record<string, Favorite>>(
      userFilePath('favorites', userName), {},
    );
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    const filePath = userFilePath('favorites', userName);
    const favorites = readJson<Record<string, Favorite>>(filePath, {});
    delete favorites[key];
    writeJson(filePath, favorites);
  }

  // ========== 用户 ==========

  async registerUser(userName: string, password: string): Promise<void> {
    const users = readJson<Record<string, string>>(usersPath(), {});
    if (users[userName]) throw new Error('用户已存在');
    users[userName] = password;
    writeJson(usersPath(), users);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const users = readJson<Record<string, string>>(usersPath(), {});
    return users[userName] === password;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const users = readJson<Record<string, string>>(usersPath(), {});
    return !!users[userName];
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const users = readJson<Record<string, string>>(usersPath(), {});
    if (!users[userName]) throw new Error('用户不存在');
    users[userName] = newPassword;
    writeJson(usersPath(), users);
  }

  async deleteUser(userName: string): Promise<void> {
    const users = readJson<Record<string, string>>(usersPath(), {});
    delete users[userName];
    writeJson(usersPath(), users);
    for (const subdir of ['playrecords', 'favorites', 'searchhistory', 'skipconfigs']) {
      const filePath = userFilePath(subdir, userName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  async getAllUsers(): Promise<string[]> {
    const users = readJson<Record<string, string>>(usersPath(), {});
    return Object.keys(users);
  }

  // ========== 搜索历史 ==========

  async getSearchHistory(userName: string): Promise<string[]> {
    return readJson<string[]>(userFilePath('searchhistory', userName), []);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const filePath = userFilePath('searchhistory', userName);
    const history = readJson<string[]>(filePath, []);
    const filtered = history.filter((k) => k !== keyword);
    filtered.unshift(keyword);
    writeJson(filePath, filtered.slice(0, 20));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const filePath = userFilePath('searchhistory', userName);
    if (keyword) {
      const history = readJson<string[]>(filePath, []);
      writeJson(filePath, history.filter((k) => k !== keyword));
    } else {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  // ========== 管理员配置 ==========

  async getAdminConfig(): Promise<AdminConfig | null> {
    return readJson<AdminConfig | null>(adminConfigPath(), null);
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    writeJson(adminConfigPath(), config);
    console.log('[FileStorage] 管理员配置已保存，视频源数量:', config.SourceConfig?.length || 0);
  }

  // ========== 跳过片头片尾配置 ==========

  async getSkipConfig(userName: string, source: string, id: string): Promise<SkipConfig | null> {
    const key = `${source}+${id}`;
    const configs = readJson<Record<string, SkipConfig>>(
      userFilePath('skipconfigs', userName), {},
    );
    return configs[key] ?? null;
  }

  async setSkipConfig(userName: string, source: string, id: string, config: SkipConfig): Promise<void> {
    const key = `${source}+${id}`;
    const filePath = userFilePath('skipconfigs', userName);
    const configs = readJson<Record<string, SkipConfig>>(filePath, {});
    configs[key] = config;
    writeJson(filePath, configs);
  }

  async deleteSkipConfig(userName: string, source: string, id: string): Promise<void> {
    const key = `${source}+${id}`;
    const filePath = userFilePath('skipconfigs', userName);
    const configs = readJson<Record<string, SkipConfig>>(filePath, {});
    delete configs[key];
    writeJson(filePath, configs);
  }

  async getAllSkipConfigs(userName: string): Promise<Record<string, SkipConfig>> {
    return readJson<Record<string, SkipConfig>>(
      userFilePath('skipconfigs', userName), {},
    );
  }

  // ========== 数据清理 ==========

  async clearAllData(): Promise<void> {
    for (const subdir of ['playrecords', 'favorites', 'searchhistory', 'skipconfigs']) {
      const dir = path.join(DATA_DIR, subdir);
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          fs.unlinkSync(path.join(dir, file));
        }
      }
    }
    if (fs.existsSync(usersPath())) fs.unlinkSync(usersPath());
    if (fs.existsSync(adminConfigPath())) fs.unlinkSync(adminConfigPath());
    console.log('[FileStorage] 所有数据已清空');
  }
}
