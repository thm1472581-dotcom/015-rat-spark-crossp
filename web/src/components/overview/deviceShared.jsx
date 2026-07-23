import React from 'react';
import {Progress, Tooltip} from 'antd';
import {formatSize, request} from '../../utils/utils';
import i18n from '../../locale/locale';
import {ensureDeviceMeta, getDisplayName, loadDeviceMeta} from '../../utils/deviceMeta';


export const DEFAULT_PAGE_SIZE = 25;
export const TABLE_HEIGHT = 560;

export const ComponentMap = {
	Generate: null,
	Explorer: null,
	Terminal: null,
	ProcMgr: null,
	Desktop: null,
	Execute: null,
};

export function expandDeviceRows(list) {
	const result = [];
	for (let i = 0; i < list.length; i++) {
		const row = Object.assign({}, list[i]);
		for (const k in row) {
			if (row[k] && typeof row[k] === 'object' && !Array.isArray(row[k])) {
				for (const key in row[k]) {
					row[k + '_' + key] = row[k][key];
				}
			}
		}
		result.push(row);
	}
	return result;
}

export function loadComponent(component, callback) {
	let element = null;
	component = component.toLowerCase();
	Object.keys(ComponentMap).forEach(k => {
		if (k.toLowerCase() === component.toLowerCase()) {
			element = k;
		}
	});
	if (!element) return;
	if (ComponentMap[element] === null) {
		import('../' + component + '/' + component).then((m) => {
			ComponentMap[element] = m.default;
			callback();
		});
	} else {
		callback();
	}
}

export function renderCPUStat(cpu) {
	let {model, usage, cores} = cpu || {};
	usage = Math.round((usage || 0) * 100) / 100;
	cores = {
		physical: Math.max(cores?.physical || 1, 1),
		logical: Math.max(cores?.logical || 1, 1),
	};
	return (
		<div>
			<div style={{fontSize: '10px'}}>{model}</div>
			{i18n.t('OVERVIEW.CPU_USAGE') + i18n.t('COMMON.COLON') + usage + '%'}
			<br />
			{i18n.t('OVERVIEW.CPU_LOGICAL_CORES') + i18n.t('COMMON.COLON') + cores.logical}
			<br />
			{i18n.t('OVERVIEW.CPU_PHYSICAL_CORES') + i18n.t('COMMON.COLON') + cores.physical}
		</div>
	);
}

export function renderRAMStat(info) {
	let {usage, total, used} = info || {};
	usage = Math.round((usage || 0) * 100) / 100;
	return (
		<div>
			{i18n.t('OVERVIEW.RAM_USAGE') + i18n.t('COMMON.COLON') + usage + '%'}
			<br />
			{i18n.t('OVERVIEW.FREE') + i18n.t('COMMON.COLON') + formatSize(total - used)}
			<br />
			{i18n.t('OVERVIEW.USED') + i18n.t('COMMON.COLON') + formatSize(used)}
			<br />
			{i18n.t('OVERVIEW.TOTAL') + i18n.t('COMMON.COLON') + formatSize(total)}
		</div>
	);
}

export function renderDiskStat(info) {
	let {usage, total, used} = info || {};
	usage = Math.round((usage || 0) * 100) / 100;
	return (
		<div>
			{i18n.t('OVERVIEW.DISK_USAGE') + i18n.t('COMMON.COLON') + usage + '%'}
			<br />
			{i18n.t('OVERVIEW.FREE') + i18n.t('COMMON.COLON') + formatSize(total - used)}
			<br />
			{i18n.t('OVERVIEW.USED') + i18n.t('COMMON.COLON') + formatSize(used)}
			<br />
			{i18n.t('OVERVIEW.TOTAL') + i18n.t('COMMON.COLON') + formatSize(total)}
		</div>
	);
}

export function renderNetworkIO(device) {
	let sent = (device?.net_sent || 0) * 8 / 1024;
	let recv = (device?.net_recv || 0) * 8 / 1024;
	return `${formatRate(sent)} ↑ / ${formatRate(recv)} ↓`;

	function formatRate(size) {
		if (size <= 1) return '0 Kbps';
		let k = 1024;
		let i = Math.floor(Math.log(size) / Math.log(k));
		let units = ['Kbps', 'Mbps', 'Gbps', 'Tbps'];
		return (size / Math.pow(k, i)).toFixed(1) + ' ' + units[i];
	}
}

export function UsageBar(props) {
	let {usage} = props;
	usage = usage || 0;
	usage = Math.round(usage * 100) / 100;
	return (
		<Tooltip
			title={props.title ?? `${usage}%`}
			overlayInnerStyle={{whiteSpace: 'nowrap', wordBreak: 'keep-all', maxWidth: '300px'}}
			overlayStyle={{maxWidth: '300px'}}
		>
			<Progress percent={usage} showInfo={false} strokeWidth={12} trailColor="#FFECFF" />
		</Tooltip>
	);
}

export function deviceMatchesKeyword(device, keyword) {
	if (!keyword) return true;
	const kw = keyword.toLowerCase();
	const fields = [
		device.hostname, device.username, device.os, device.arch,
		device.lan, device.wan, device.mac, device.id,
	];
	return fields.some(v => String(v || '').toLowerCase().includes(kw));
}

export function deviceRowKey(device) {
	const wan = String(device?.wan || '').trim().toLowerCase();
	if (wan) {
		return `wan:${wan}`;
	}
	const mac = String(device?.mac || '').trim().toLowerCase();
	if (mac) {
		return `mac:${mac}`;
	}
	const lan = String(device?.lan || '').trim().toLowerCase();
	const host = String(device?.hostname || '').trim().toLowerCase();
	if (lan && host) {
		return `host:${lan}|${host}`;
	}
	return `id:${device?.id || ''}`;
}

export function dedupeDevicesByWAN(list) {
	const best = new Map();
	for (const row of list || []) {
		const key = deviceRowKey(row);
		const prev = best.get(key);
		if (!prev) {
			best.set(key, row);
			continue;
		}
		const latA = Number(row?.latency ?? 999999);
		const latB = Number(prev?.latency ?? 999999);
		if (latA < latB || (latA === latB && String(row?.id || '') > String(prev?.id || ''))) {
			best.set(key, row);
		}
	}
	return Array.from(best.values());
}

export function filterDevicesByKeyword(list, keyword) {
	const kw = String(keyword || '').trim();
	if (!kw) {
		return list;
	}
	const meta = loadDeviceMeta();
	const lower = kw.toLowerCase();
	return list.filter(row =>
		deviceMatchesKeyword(row, lower) ||
		getDisplayName(row, meta).toLowerCase().includes(lower)
	);
}

export async function loadDeviceList(keyword = '') {
	await ensureDeviceMeta();
	const res = await request('/api/device/list', {current: 1, pageSize: 0, keyword: String(keyword || '').trim()});
	const data = res.data;
	if (data.code !== 0) {
		return {list: [], total: 0, revision: null};
	}
	const payload = data.data || {};
	let list = dedupeDevicesByWAN(expandDeviceRows(payload.list || []));
	list = filterDevicesByKeyword(list, keyword);
	return {
		list,
		total: list.length,
		revision: payload.revision ?? null,
	};
}

