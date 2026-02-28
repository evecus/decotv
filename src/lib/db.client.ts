/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
'use client';

/**
 * 仅在浏览器端使用的数据库工具。
 * 使用混合缓存策略：浏览器端 localStorage 作为缓存层，后端 JSON 文件作为持久化层。
 * 数据通过 API 路由与服务器端 FileStorage 交互。
 */

import { getAuthInfoFromBrowserCookie } from './auth';
import { SkipConfig } from './types';

function triggerGlobalError(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('globalError', { detail: { message } }));
  }
}

export interface PlayRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  search_title?: string;
}

export interface Favorite {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  total_episodes: number;
  save_time: number;
  search_title?: string;
  origin?: 'vod' | 'live';
}

interface CacheData<T> {
  data: T;
  timestamp: number;
  version: string;
}

interface UserCacheStore {
  playRecords?: CacheData<Record<string, PlayRecord>>;
  favorites?: CacheData<Record<string, Favorite>>;
  searchHistory?: CacheData<string[]>;
  skipConfigs?: CacheData<Record<string, SkipConfig>>;
}

const CACHE_PREFIX = 'decotv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000;
const SEARCH_HISTORY_LIMIT = 20;

class HybridCacheManager {
  private static instance: HybridCacheManager;

  static getInstance(): HybridCacheManager {
    if (!HybridCacheManager.instance) {
      HybridCacheManager.instance = new HybridCacheManager();
    }
    return HybridCacheManager.instance;
  }

  private getCurrentUsername(): string | null {
    const authInfo = getAuthInfoFromBrowserCookie();
    return authInfo?.username || null;
  }

  private getUserCacheKey(username: string): string {
    return `${CACHE_PREFIX}${username}`;
  }

  private getUserCache(username: string): UserCacheStore {
    if (typeof window === 'undefined') return {};
    try {
      const cached = localStorage.getItem(this.getUserCacheKey(username));
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  }

  private saveUserCache(username: string, cache: UserCacheStore): void {
    if (typeof window === 'undefined') return;
    try {
      if (JSON.stringify(cache).length > 15 * 1024 * 1024) {
        this.cleanOldCache(cache);
      }
      localStorage.setItem(this.getUserCacheKey(username), JSON.stringify(cache));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        this.clearAllCacheStorage();
        try { localStorage.setItem(this.getUserCacheKey(username), JSON.stringify(cache)); } catch {}
      }
    }
  }

  private cleanOldCache(cache: UserCacheStore): void {
    const now = Date.now();
    const maxAge = 60 * 24 * 60 * 60 * 1000;
    if (cache.playRecords && now - cache.playRecords.timestamp > maxAge) delete cache.playRecords;
    if (cache.favorites && now - cache.favorites.timestamp > maxAge) delete cache.favorites;
  }

  private clearAllCacheStorage(): void {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('decotv_cache_')) localStorage.removeItem(key);
    });
  }

  private isCacheValid<T>(cache: CacheData<T>): boolean {
    return cache.version === CACHE_VERSION && Date.now() - cache.timestamp < CACHE_EXPIRE_TIME;
  }

  private createCacheData<T>(data: T): CacheData<T> {
    return { data, timestamp: Date.now(), version: CACHE_VERSION };
  }

  getCachedPlayRecords(): Record<string, PlayRecord> | null {
    const u = this.getCurrentUsername(); if (!u) return null;
    const c = this.getUserCache(u).playRecords;
    return c && this.isCacheValid(c) ? c.data : null;
  }
  cachePlayRecords(data: Record<string, PlayRecord>): void {
    const u = this.getCurrentUsername(); if (!u) return;
    const store = this.getUserCache(u);
    store.playRecords = this.createCacheData(data);
    this.saveUserCache(u, store);
  }

  getCachedFavorites(): Record<string, Favorite> | null {
    const u = this.getCurrentUsername(); if (!u) return null;
    const c = this.getUserCache(u).favorites;
    return c && this.isCacheValid(c) ? c.data : null;
  }
  cacheFavorites(data: Record<string, Favorite>): void {
    const u = this.getCurrentUsername(); if (!u) return;
    const store = this.getUserCache(u);
    store.favorites = this.createCacheData(data);
    this.saveUserCache(u, store);
  }

  getCachedSearchHistory(): string[] | null {
    const u = this.getCurrentUsername(); if (!u) return null;
    const c = this.getUserCache(u).searchHistory;
    return c && this.isCacheValid(c) ? c.data : null;
  }
  cacheSearchHistory(data: string[]): void {
    const u = this.getCurrentUsername(); if (!u) return;
    const store = this.getUserCache(u);
    store.searchHistory = this.createCacheData(data);
    this.saveUserCache(u, store);
  }

  getCachedSkipConfigs(): Record<string, SkipConfig> | null {
    const u = this.getCurrentUsername(); if (!u) return null;
    const c = this.getUserCache(u).skipConfigs;
    return c && this.isCacheValid(c) ? c.data : null;
  }
  cacheSkipConfigs(data: Record<string, SkipConfig>): void {
    const u = this.getCurrentUsername(); if (!u) return;
    const store = this.getUserCache(u);
    store.skipConfigs = this.createCacheData(data);
    this.saveUserCache(u, store);
  }

  clearUserCache(username?: string): void {
    const target = username || this.getCurrentUsername();
    if (!target) return;
    try { localStorage.removeItem(this.getUserCacheKey(target)); } catch {}
  }

  clearExpiredCaches(): void {
    if (typeof window === 'undefined') return;
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) {
          try {
            const store = JSON.parse(localStorage.getItem(key) || '{}');
            const hasValid = Object.values(store).some(
              (v) => v && this.isCacheValid(v as CacheData<any>),
            );
            if (!hasValid) toRemove.push(key);
          } catch { toRemove.push(key!); }
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
}

const cacheManager = HybridCacheManager.getInstance();

if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}

async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (!res.ok) {
    if (res.status === 401) {
      try { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); } catch {}
      const loginUrl = new URL('/login', window.location.origin);
      loginUrl.searchParams.set('redirect', window.location.pathname + window.location.search);
      window.location.href = loginUrl.toString();
      throw new Error('用户未授权，已跳转到登录页面');
    }
    throw new Error(`请求 ${url} 失败: ${res.status}`);
  }
  return res;
}

async function fetchFromApi<T>(path: string): Promise<T> {
  return (await fetchWithAuth(path)).json() as Promise<T>;
}

async function handleDbFailure(
  dataType: 'playRecords' | 'favorites' | 'searchHistory',
  error: any,
): Promise<void> {
  console.error(`数据库操作失败 (${dataType}):`, error);
  triggerGlobalError('数据库操作失败');
  try {
    let freshData: any;
    let eventName: string;
    switch (dataType) {
      case 'playRecords':
        freshData = await fetchFromApi<Record<string, PlayRecord>>('/api/playrecords');
        cacheManager.cachePlayRecords(freshData); eventName = 'playRecordsUpdated'; break;
      case 'favorites':
        freshData = await fetchFromApi<Record<string, Favorite>>('/api/favorites');
        cacheManager.cacheFavorites(freshData); eventName = 'favoritesUpdated'; break;
      case 'searchHistory':
        freshData = await fetchFromApi<string[]>('/api/searchhistory');
        cacheManager.cacheSearchHistory(freshData); eventName = 'searchHistoryUpdated'; break;
    }
    window.dispatchEvent(new CustomEvent(eventName, { detail: freshData }));
  } catch (e) {
    console.error('刷新缓存失败:', e);
  }
}

export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// ---- 播放记录 ----

export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  if (typeof window === 'undefined') return {};
  const cached = cacheManager.getCachedPlayRecords();
  if (cached) {
    fetchFromApi<Record<string, PlayRecord>>('/api/playrecords')
      .then((fresh) => {
        if (JSON.stringify(cached) !== JSON.stringify(fresh)) {
          cacheManager.cachePlayRecords(fresh);
          window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: fresh }));
        }
      })
      .catch((e) => { console.warn('后台同步播放记录失败:', e); triggerGlobalError('后台同步播放记录失败'); });
    return cached;
  }
  try {
    const fresh = await fetchFromApi<Record<string, PlayRecord>>('/api/playrecords');
    cacheManager.cachePlayRecords(fresh);
    return fresh;
  } catch (e) {
    console.error('获取播放记录失败:', e); triggerGlobalError('获取播放记录失败'); return {};
  }
}

export async function savePlayRecord(source: string, id: string, record: PlayRecord): Promise<void> {
  const key = generateStorageKey(source, id);
  const cached = cacheManager.getCachedPlayRecords() || {};
  cached[key] = record;
  cacheManager.cachePlayRecords(cached);
  window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: cached }));
  try {
    await fetchWithAuth('/api/playrecords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, record }) });
  } catch (e) { await handleDbFailure('playRecords', e); triggerGlobalError('保存播放记录失败'); throw e; }
}

export async function deletePlayRecord(source: string, id: string): Promise<void> {
  const key = generateStorageKey(source, id);
  const cached = cacheManager.getCachedPlayRecords() || {};
  delete cached[key];
  cacheManager.cachePlayRecords(cached);
  window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: cached }));
  try {
    await fetchWithAuth(`/api/playrecords?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch (e) { await handleDbFailure('playRecords', e); triggerGlobalError('删除播放记录失败'); throw e; }
}

export async function clearAllPlayRecords(): Promise<void> {
  cacheManager.cachePlayRecords({});
  window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: {} }));
  try {
    await fetchWithAuth('/api/playrecords', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
  } catch (e) { await handleDbFailure('playRecords', e); triggerGlobalError('清空播放记录失败'); throw e; }
}

// ---- 搜索历史 ----

export async function getSearchHistory(): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  const cached = cacheManager.getCachedSearchHistory();
  if (cached) {
    fetchFromApi<string[]>('/api/searchhistory')
      .then((fresh) => {
        if (JSON.stringify(cached) !== JSON.stringify(fresh)) {
          cacheManager.cacheSearchHistory(fresh);
          window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: fresh }));
        }
      })
      .catch((e) => { console.warn('后台同步搜索历史失败:', e); });
    return cached;
  }
  try {
    const fresh = await fetchFromApi<string[]>('/api/searchhistory');
    cacheManager.cacheSearchHistory(fresh);
    return fresh;
  } catch (e) { console.error('获取搜索历史失败:', e); return []; }
}

export async function addSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim(); if (!trimmed) return;
  const history = cacheManager.getCachedSearchHistory() || [];
  const next = [trimmed, ...history.filter((k) => k !== trimmed)].slice(0, SEARCH_HISTORY_LIMIT);
  cacheManager.cacheSearchHistory(next);
  window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: next }));
  try { await fetchWithAuth('/api/searchhistory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: trimmed }) }); }
  catch (e) { await handleDbFailure('searchHistory', e); }
}

export async function clearSearchHistory(): Promise<void> {
  cacheManager.cacheSearchHistory([]);
  window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: [] }));
  try { await fetchWithAuth('/api/searchhistory', { method: 'DELETE' }); }
  catch (e) { await handleDbFailure('searchHistory', e); }
}

export async function deleteSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim(); if (!trimmed) return;
  const history = cacheManager.getCachedSearchHistory() || [];
  const next = history.filter((k) => k !== trimmed);
  cacheManager.cacheSearchHistory(next);
  window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: next }));
  try { await fetchWithAuth(`/api/searchhistory?keyword=${encodeURIComponent(trimmed)}`, { method: 'DELETE' }); }
  catch (e) { await handleDbFailure('searchHistory', e); }
}

// ---- 收藏 ----

export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  if (typeof window === 'undefined') return {};
  const cached = cacheManager.getCachedFavorites();
  if (cached) {
    fetchFromApi<Record<string, Favorite>>('/api/favorites')
      .then((fresh) => {
        if (JSON.stringify(cached) !== JSON.stringify(fresh)) {
          cacheManager.cacheFavorites(fresh);
          window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: fresh }));
        }
      })
      .catch((e) => { console.warn('后台同步收藏失败:', e); });
    return cached;
  }
  try {
    const fresh = await fetchFromApi<Record<string, Favorite>>('/api/favorites');
    cacheManager.cacheFavorites(fresh);
    return fresh;
  } catch (e) { console.error('获取收藏失败:', e); return {}; }
}

export async function saveFavorite(source: string, id: string, favorite: Favorite): Promise<void> {
  const key = generateStorageKey(source, id);
  const cached = cacheManager.getCachedFavorites() || {};
  cached[key] = favorite;
  cacheManager.cacheFavorites(cached);
  window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: cached }));
  try { await fetchWithAuth('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, favorite }) }); }
  catch (e) { await handleDbFailure('favorites', e); triggerGlobalError('保存收藏失败'); throw e; }
}

export async function deleteFavorite(source: string, id: string): Promise<void> {
  const key = generateStorageKey(source, id);
  const cached = cacheManager.getCachedFavorites() || {};
  delete cached[key];
  cacheManager.cacheFavorites(cached);
  window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: cached }));
  try { await fetchWithAuth(`/api/favorites?key=${encodeURIComponent(key)}`, { method: 'DELETE' }); }
  catch (e) { await handleDbFailure('favorites', e); triggerGlobalError('删除收藏失败'); throw e; }
}

export async function isFavorited(source: string, id: string): Promise<boolean> {
  const all = await getAllFavorites();
  return !!all[generateStorageKey(source, id)];
}

export async function clearAllFavorites(): Promise<void> {
  cacheManager.cacheFavorites({});
  window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: {} }));
  try { await fetchWithAuth('/api/favorites', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }); }
  catch (e) { await handleDbFailure('favorites', e); triggerGlobalError('清空收藏失败'); throw e; }
}

// ---- 缓存辅助 ----

export function clearUserCache(): void { cacheManager.clearUserCache(); }

export async function refreshAllCache(): Promise<void> {
  try {
    const [pr, fav, sh, sc] = await Promise.allSettled([
      fetchFromApi<Record<string, PlayRecord>>('/api/playrecords'),
      fetchFromApi<Record<string, Favorite>>('/api/favorites'),
      fetchFromApi<string[]>('/api/searchhistory'),
      fetchFromApi<Record<string, SkipConfig>>('/api/skipconfigs'),
    ]);
    if (pr.status === 'fulfilled') { cacheManager.cachePlayRecords(pr.value); window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: pr.value })); }
    if (fav.status === 'fulfilled') { cacheManager.cacheFavorites(fav.value); window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: fav.value })); }
    if (sh.status === 'fulfilled') { cacheManager.cacheSearchHistory(sh.value); window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: sh.value })); }
    if (sc.status === 'fulfilled') { cacheManager.cacheSkipConfigs(sc.value); window.dispatchEvent(new CustomEvent('skipConfigsUpdated', { detail: sc.value })); }
  } catch (e) { console.error('刷新缓存失败:', e); triggerGlobalError('刷新缓存失败'); }
}

export function getCacheStatus() {
  const authInfo = getAuthInfoFromBrowserCookie();
  return {
    hasPlayRecords: !!cacheManager.getCachedPlayRecords(),
    hasFavorites: !!cacheManager.getCachedFavorites(),
    hasSearchHistory: !!cacheManager.getCachedSearchHistory(),
    hasSkipConfigs: !!cacheManager.getCachedSkipConfigs(),
    username: authInfo?.username || null,
  };
}

export type CacheUpdateEvent = 'playRecordsUpdated' | 'favoritesUpdated' | 'searchHistoryUpdated' | 'skipConfigsUpdated';

export function subscribeToDataUpdates<T>(eventType: CacheUpdateEvent, callback: (data: T) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: CustomEvent) => callback(e.detail);
  window.addEventListener(eventType, handler as EventListener);
  return () => window.removeEventListener(eventType, handler as EventListener);
}

export async function preloadUserData(): Promise<void> {
  const s = getCacheStatus();
  if (s.hasPlayRecords && s.hasFavorites && s.hasSearchHistory && s.hasSkipConfigs) return;
  refreshAllCache().catch((e) => { console.warn('预加载用户数据失败:', e); });
}

// ---- 跳过片头片尾配置 ----

export async function getSkipConfig(source: string, id: string): Promise<SkipConfig | null> {
  if (typeof window === 'undefined') return null;
  const key = generateStorageKey(source, id);
  const cached = cacheManager.getCachedSkipConfigs();
  if (cached) {
    fetchFromApi<Record<string, SkipConfig>>('/api/skipconfigs')
      .then((fresh) => {
        if (JSON.stringify(cached) !== JSON.stringify(fresh)) {
          cacheManager.cacheSkipConfigs(fresh);
          window.dispatchEvent(new CustomEvent('skipConfigsUpdated', { detail: fresh }));
        }
      })
      .catch(() => {});
    return cached[key] || null;
  }
  try {
    const fresh = await fetchFromApi<Record<string, SkipConfig>>('/api/skipconfigs');
    cacheManager.cacheSkipConfigs(fresh);
    return fresh[key] || null;
  } catch (e) { console.error('获取跳过配置失败:', e); return null; }
}

export async function saveSkipConfig(source: string, id: string, config: SkipConfig): Promise<void> {
  const key = generateStorageKey(source, id);
  const cached = cacheManager.getCachedSkipConfigs() || {};
  cached[key] = config;
  cacheManager.cacheSkipConfigs(cached);
  window.dispatchEvent(new CustomEvent('skipConfigsUpdated', { detail: cached }));
  try { await fetchWithAuth('/api/skipconfigs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, config }) }); }
  catch (e) { console.error('保存跳过配置失败:', e); }
}

export async function getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
  if (typeof window === 'undefined') return {};
  const cached = cacheManager.getCachedSkipConfigs();
  if (cached) {
    fetchFromApi<Record<string, SkipConfig>>('/api/skipconfigs')
      .then((fresh) => {
        if (JSON.stringify(cached) !== JSON.stringify(fresh)) {
          cacheManager.cacheSkipConfigs(fresh);
          window.dispatchEvent(new CustomEvent('skipConfigsUpdated', { detail: fresh }));
        }
      })
      .catch(() => {});
    return cached;
  }
  try {
    const fresh = await fetchFromApi<Record<string, SkipConfig>>('/api/skipconfigs');
    cacheManager.cacheSkipConfigs(fresh);
    return fresh;
  } catch (e) { console.error('获取跳过配置失败:', e); return {}; }
}

export async function deleteSkipConfig(source: string, id: string): Promise<void> {
  const key = generateStorageKey(source, id);
  const cached = cacheManager.getCachedSkipConfigs() || {};
  delete cached[key];
  cacheManager.cacheSkipConfigs(cached);
  window.dispatchEvent(new CustomEvent('skipConfigsUpdated', { detail: cached }));
  try { await fetchWithAuth(`/api/skipconfigs?key=${encodeURIComponent(key)}`, { method: 'DELETE' }); }
  catch (e) { console.error('删除跳过配置失败:', e); }
}
