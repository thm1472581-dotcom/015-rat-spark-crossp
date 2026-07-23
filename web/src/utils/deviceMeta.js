import {request} from './utils';

const LEGACY_STORAGE_KEY = 'spark_device_meta';
export const DEFAULT_GROUP_KEY = '__default__';

let metaCache = emptyMeta();
let metaLoaded = false;
let metaLoadPromise = null;

function emptyMeta() {
	return {aliases: {}, groups: {}};
}

function normalizeMeta(data) {
	return {
		aliases: data?.aliases || {},
		groups: data?.groups || {},
	};
}

function isMetaEmpty(meta) {
	return Object.keys(meta.aliases).length === 0 && Object.keys(meta.groups).length === 0;
}

function readLegacyLocalMeta() {
	try {
		const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!raw) return null;
		return normalizeMeta(JSON.parse(raw));
	} catch (e) {
		return null;
	}
}

function applyMeta(data) {
	metaCache = normalizeMeta(data);
	metaLoaded = true;
	return metaCache;
}

export function getDeviceKey(device) {
	const wan = String(device?.wan || '').trim().toLowerCase();
	if (wan) return `wan:${wan}`;
	const mac = String(device?.mac || '').trim().toLowerCase();
	if (mac) return `mac:${mac}`;
	const lan = String(device?.lan || '').trim().toLowerCase();
	const host = String(device?.hostname || '').trim().toLowerCase();
	if (lan && host) return `host:${lan}|${host}`;
	return `id:${device?.id || ''}`;
}

function lookupValue(map, device) {
	const key = getDeviceKey(device);
	if (map[key] != null && map[key] !== '') return map[key];
	const wan = String(device?.wan || '').trim().toLowerCase();
	if (wan && map[`wan:${wan}`] != null) return map[`wan:${wan}`];
	const id = String(device?.id || '').trim();
	if (id && map[`id:${id}`] != null) return map[`id:${id}`];
	return '';
}

export function loadDeviceMeta() {
	return metaCache;
}

export async function ensureDeviceMeta(force = false) {
	if (metaLoaded && !force) return metaCache;
	if (metaLoadPromise && !force) return metaLoadPromise;
	metaLoadPromise = (async () => {
		const res = await request('/api/device/meta/get', {});
		if (res.data?.code === 0) applyMeta(res.data.data);
		const legacy = readLegacyLocalMeta();
		if (legacy && !isMetaEmpty(legacy) && isMetaEmpty(metaCache)) {
			const imported = await request('/api/device/meta/import', {
				aliases: legacy.aliases,
				groups: legacy.groups,
			});
			if (imported.data?.code === 0) applyMeta(imported.data.data);
			localStorage.removeItem(LEGACY_STORAGE_KEY);
		}
		metaLoaded = true;
		return metaCache;
	})();
	return metaLoadPromise;
}

function devicePayload(device) {
	return {
		id: device?.id || '',
		wan: device?.wan || '',
		mac: device?.mac || '',
		lan: device?.lan || '',
		hostname: device?.hostname || '',
	};
}

async function persistAlias(device, alias) {
	await ensureDeviceMeta();
	const res = await request('/api/device/meta/set', {
		...devicePayload(device),
		setAlias: true,
		setGroup: false,
		alias: String(alias ?? '').trim(),
	});
	if (res.data?.code === 0) {
		applyMeta(res.data.data);
		return metaCache;
	}
	throw new Error(res.data?.msg || 'save failed');
}

async function persistGroup(device, groupKey) {
	await ensureDeviceMeta();
	const value = groupKey || DEFAULT_GROUP_KEY;
	const res = await request('/api/device/meta/set', {
		...devicePayload(device),
		setAlias: false,
		setGroup: true,
		group: value === DEFAULT_GROUP_KEY ? '' : value,
	});
	if (res.data?.code === 0) {
		applyMeta(res.data.data);
		return metaCache;
	}
	throw new Error(res.data?.msg || 'save failed');
}

export function getAlias(device, meta = metaCache) {
	return lookupValue(meta.aliases, device);
}

export async function setAlias(device, alias) {
	return persistAlias(device, alias);
}

export function getGroupKey(device, meta = metaCache) {
	const group = lookupValue(meta.groups, device);
	return group || DEFAULT_GROUP_KEY;
}

export async function setGroup(device, groupKey) {
	return persistGroup(device, groupKey);
}

export function getDisplayName(device, meta = metaCache) {
	const alias = getAlias(device, meta);
	if (alias) return alias;
	return device?.hostname || device?.id || '-';
}

export function groupTitle(label, count) {
	return `${label}(${count})`;
}
