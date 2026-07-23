import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Button, Descriptions, Dropdown, Input, Modal, Space, Tree, message} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import {formatSize, request, tsToTime} from '../../utils/utils';
import i18n from '../../locale/locale';
import {
	DEFAULT_GROUP_KEY,
	ensureDeviceMeta,
	getAlias,
	getDeviceKey,
	getDisplayName,
	getGroupKey,
	groupTitle,
	loadDeviceMeta,
	setAlias,
	setGroup,
} from '../../utils/deviceMeta';
import {loadDeviceList, renderNetworkIO} from './deviceShared';
import './deviceGroup.css';

function DeviceGroup(props) {
	const {onMenuClick, lastRevisionRef, refreshToken} = props;
	const [loading, setLoading] = useState(false);
	const [devices, setDevices] = useState([]);
	const [meta, setMeta] = useState(() => loadDeviceMeta());

	useEffect(() => {
		ensureDeviceMeta().then(setMeta);
	}, []);
	const [keywordInput, setKeywordInput] = useState('');
	const [keyword, setKeyword] = useState('');
	const [selectedDevice, setSelectedDevice] = useState(null);
	const [expandedKeys, setExpandedKeys] = useState(['root', DEFAULT_GROUP_KEY]);
	const [selectedKeys, setSelectedKeys] = useState([]);

	const fetchDevices = useCallback(async (searchKeyword) => {
		const kw = String(searchKeyword ?? keyword).trim();
		setLoading(true);
		try {
			const {list, revision} = await loadDeviceList(kw);
			setDevices(list);
			if (revision != null && lastRevisionRef) {
				lastRevisionRef.current = revision;
			}
		} finally {
			setLoading(false);
		}
	}, [keyword, lastRevisionRef]);

	useEffect(() => {
		fetchDevices('');
	}, []);

	useEffect(() => {
		if (refreshToken > 0) {
			fetchDevices(keyword);
		}
	}, [refreshToken]);

	const groupLabels = useMemo(() => {
		const labels = {[DEFAULT_GROUP_KEY]: i18n.t('OVERVIEW.DEFAULT_GROUP')};
		devices.forEach(device => {
			const gk = getGroupKey(device, meta);
			if (!labels[gk] && gk !== DEFAULT_GROUP_KEY) {
				labels[gk] = gk;
			}
		});
		return labels;
	}, [devices, meta]);

	const treeData = useMemo(() => {
		const buckets = {};
		devices.forEach(device => {
			const gk = getGroupKey(device, meta);
			if (!buckets[gk]) buckets[gk] = [];
			buckets[gk].push(device);
		});
		const groupKeys = Object.keys(buckets).sort((a, b) => {
			if (a === DEFAULT_GROUP_KEY) return -1;
			if (b === DEFAULT_GROUP_KEY) return 1;
			return groupLabels[a].localeCompare(groupLabels[b]);
		});
		return [{
			key: 'root',
			title: 'Spark',
			selectable: false,
			children: groupKeys.map(gk => ({
				key: gk,
				title: groupTitle(groupLabels[gk] || gk, buckets[gk].length),
				selectable: false,
				children: buckets[gk].map(device => ({
					key: getDeviceKey(device),
					title: getDisplayName(device, meta),
					isLeaf: true,
					device,
				})),
			})),
		}];
	}, [devices, meta, groupLabels]);

	function refreshMeta() {
		setMeta({...loadDeviceMeta()});
	}

	function promptAlias(device) {
		const current = getAlias(device, meta);
		Modal.confirm({
			title: i18n.t('OVERVIEW.SET_ALIAS'),
			content: (
				<Input defaultValue={current} id='spark-alias-input' placeholder={device.hostname} />
			),
			onOk: async () => {
				const input = document.getElementById('spark-alias-input');
				try {
					await setAlias(device, input?.value || '');
					refreshMeta();
					message.success(i18n.t('OVERVIEW.ALIAS_SAVED'));
				} catch (e) {
					message.error(String(e.message || e));
				}
			},
		});
	}

	function promptGroup(device) {
		const current = getGroupKey(device, meta);
		const currentLabel = groupLabels[current] || current;
		Modal.confirm({
			title: i18n.t('OVERVIEW.SET_GROUP'),
			content: (
				<Input defaultValue={currentLabel === i18n.t('OVERVIEW.DEFAULT_GROUP') ? '' : currentLabel} id='spark-group-input' placeholder={i18n.t('OVERVIEW.DEFAULT_GROUP')} />
			),
			onOk: async () => {
				const input = document.getElementById('spark-group-input');
				const value = (input?.value || '').trim();
				try {
					await setGroup(device, value || DEFAULT_GROUP_KEY);
					refreshMeta();
					message.success(i18n.t('OVERVIEW.GROUP_SAVED'));
				} catch (e) {
					message.error(String(e.message || e));
				}
			},
		});
	}

	function onTreeSelect(keys, info) {
		setSelectedKeys(keys);
		const node = info.node;
		if (node.device) {
			setSelectedDevice(node.device);
		}
	}

	function contextMenu(device) {
		return {
			items: [
				{key: 'alias', label: i18n.t('OVERVIEW.SET_ALIAS')},
				{key: 'group', label: i18n.t('OVERVIEW.SET_GROUP')},
				{type: 'divider'},
				{key: 'terminal', label: i18n.t('OVERVIEW.TERMINAL')},
				{key: 'explorer', label: i18n.t('OVERVIEW.EXPLORER')},
				{key: 'procmgr', label: i18n.t('OVERVIEW.PROC_MANAGER')},
			],
			onClick: ({key}) => {
				if (key === 'alias') return promptAlias(device);
				if (key === 'group') return promptGroup(device);
				onMenuClick(key, device);
			},
		};
	}

	function renderTreeTitle(node) {
		if (!node.device) return node.title;
		return (
			<Dropdown menu={contextMenu(node.device)} trigger={['contextMenu']}>
				<span className='device-group-node'>{node.title}</span>
			</Dropdown>
		);
	}

	const mappedTree = useMemo(() => {
		function mapNode(node) {
			return {
				...node,
				title: renderTreeTitle(node),
				children: node.children ? node.children.map(mapNode) : undefined,
			};
		}
		return treeData.map(mapNode);
	}, [treeData, meta]);

	return (
		<div className='device-group-layout'>
			<div className='device-group-toolbar'>
				<Input.Search
					allowClear
					value={keywordInput}
					placeholder={i18n.t('OVERVIEW.SEARCH_PLACEHOLDER')}
					onChange={e => setKeywordInput(e.target.value)}
					onSearch={(v) => { setKeyword(v); setKeywordInput(v); fetchDevices(v); }}
					style={{maxWidth: 360}}
				/>
				<Space>
				<span className='device-group-count'>{i18n.t('OVERVIEW.TOTAL_HOSTS').replace('{0}', String(devices.length))}</span>
					<Button icon={<ReloadOutlined />} loading={loading} onClick={() => fetchDevices(keyword)}>
						{i18n.t('OVERVIEW.REFRESH')}
					</Button>
					<Button type='primary' onClick={() => onMenuClick('generate', true)}>
						{i18n.t('OVERVIEW.GENERATE')}
					</Button>
				</Space>
			</div>
			<div className='device-group-body'>
				<div className='device-group-tree'>
					<Tree
						showLine
						blockNode
						defaultExpandAll
						treeData={mappedTree}
						expandedKeys={expandedKeys}
						selectedKeys={selectedKeys}
						onExpand={setExpandedKeys}
						onSelect={onTreeSelect}
					/>
				</div>
				<div className='device-group-detail'>
					{selectedDevice ? (
						<>
							<div className='device-group-detail-title'>
								{getDisplayName(selectedDevice, meta)}
								<Space style={{marginLeft: 12}}>
									<Button size='small' onClick={() => promptAlias(selectedDevice)}>{i18n.t('OVERVIEW.SET_ALIAS')}</Button>
									<Button size='small' onClick={() => promptGroup(selectedDevice)}>{i18n.t('OVERVIEW.SET_GROUP')}</Button>
								</Space>
							</div>
							<Descriptions column={1} size='small' bordered>
								<Descriptions.Item label={i18n.t('OVERVIEW.HOSTNAME')}>{selectedDevice.hostname}</Descriptions.Item>
								<Descriptions.Item label={i18n.t('OVERVIEW.USERNAME')}>{selectedDevice.username}</Descriptions.Item>
								<Descriptions.Item label='WAN'>{selectedDevice.wan}</Descriptions.Item>
								<Descriptions.Item label='LAN'>{selectedDevice.lan}</Descriptions.Item>
								<Descriptions.Item label={i18n.t('OVERVIEW.OS')}>{selectedDevice.os}</Descriptions.Item>
								<Descriptions.Item label={i18n.t('OVERVIEW.ARCH')}>{selectedDevice.arch}</Descriptions.Item>
								<Descriptions.Item label='Ping'>{selectedDevice.latency}ms</Descriptions.Item>
								<Descriptions.Item label={i18n.t('OVERVIEW.UPTIME')}>{tsToTime(selectedDevice.uptime)}</Descriptions.Item>
								<Descriptions.Item label={i18n.t('OVERVIEW.RAM')}>{formatSize(selectedDevice.ram_total)}</Descriptions.Item>
								<Descriptions.Item label={i18n.t('OVERVIEW.NETWORK')}>{renderNetworkIO(selectedDevice)}</Descriptions.Item>
							</Descriptions>
							<div className='device-group-actions'>
								<Button onClick={() => onMenuClick('terminal', selectedDevice)}>{i18n.t('OVERVIEW.TERMINAL')}</Button>
								<Button onClick={() => onMenuClick('explorer', selectedDevice)}>{i18n.t('OVERVIEW.EXPLORER')}</Button>
								<Button onClick={() => onMenuClick('procmgr', selectedDevice)}>{i18n.t('OVERVIEW.PROC_MANAGER')}</Button>
							</div>
						</>
					) : (
						<div className='device-group-empty'>{i18n.t('OVERVIEW.SELECT_HOST')}</div>
					)}
				</div>
			</div>
		</div>
	);
}

export default DeviceGroup;




