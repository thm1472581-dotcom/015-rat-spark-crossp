import React, {useEffect, useMemo, useRef} from 'react';
import ProTable, {TableDropdown} from '@ant-design/pro-table';
import {Button, Space} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import {formatSize, tsToTime} from '../../utils/utils';
import i18n from '../../locale/locale';
import {VList} from 'virtuallist-antd';
import {
	DEFAULT_PAGE_SIZE,
	TABLE_HEIGHT,
	UsageBar,
	deviceRowKey,
	loadDeviceList,
	renderCPUStat,
	renderDiskStat,
	renderNetworkIO,
	renderRAMStat,
} from './deviceShared';

function DeviceTable(props) {
	const {loading, setLoading, onMenuClick, lastRevisionRef, tableRef: externalRef} = props;
	const internalRef = useRef();
	const tableRef = externalRef ?? internalRef;
	const virtualTable = useMemo(() => VList({height: TABLE_HEIGHT}), []);

	useEffect(() => {
		tableRef.current?.reload?.();
	}, []);

	const columns = useMemo(() => [
		{
			key: 'keyword',
			title: i18n.t('OVERVIEW.SEARCH'),
			dataIndex: 'keyword',
			hideInTable: true,
			fieldProps: {
				placeholder: i18n.t('OVERVIEW.SEARCH_PLACEHOLDER'),
				allowClear: true,
			},
		},
		{
			key: 'hostname',
			title: i18n.t('OVERVIEW.HOSTNAME'),
			dataIndex: 'hostname',
			ellipsis: true,
			width: 100,
			hideInSearch: true,
		},
		{
			key: 'username',
			title: i18n.t('OVERVIEW.USERNAME'),
			dataIndex: 'username',
			ellipsis: true,
			width: 90,
			hideInSearch: true,
		},
		{
			key: 'ping',
			title: 'Ping',
			dataIndex: 'latency',
			ellipsis: true,
			renderText: (v) => String(v) + 'ms',
			width: 60,
			hideInSearch: true,
		},
		{
			key: 'cpu_usage',
			title: i18n.t('OVERVIEW.CPU_USAGE'),
			dataIndex: 'cpu_usage',
			ellipsis: true,
			render: (_, v) => <UsageBar title={renderCPUStat(v.cpu)} {...v.cpu} />,
			width: 100,
			hideInSearch: true,
		},
		{
			key: 'ram_usage',
			title: i18n.t('OVERVIEW.RAM_USAGE'),
			dataIndex: 'ram_usage',
			ellipsis: true,
			render: (_, v) => <UsageBar title={renderRAMStat(v.ram)} {...v.ram} />,
			width: 100,
			hideInSearch: true,
		},
		{
			key: 'disk_usage',
			title: i18n.t('OVERVIEW.DISK_USAGE'),
			dataIndex: 'disk_usage',
			ellipsis: true,
			render: (_, v) => <UsageBar title={renderDiskStat(v.disk)} {...v.disk} />,
			width: 100,
			hideInSearch: true,
		},
		{
			key: 'os',
			title: i18n.t('OVERVIEW.OS'),
			dataIndex: 'os',
			ellipsis: true,
			width: 80,
			hideInSearch: true,
		},
		{
			key: 'arch',
			title: i18n.t('OVERVIEW.ARCH'),
			dataIndex: 'arch',
			ellipsis: true,
			width: 70,
			hideInSearch: true,
		},
		{
			key: 'ram_total',
			title: i18n.t('OVERVIEW.RAM'),
			dataIndex: 'ram_total',
			ellipsis: true,
			renderText: formatSize,
			width: 70,
			hideInSearch: true,
		},
		{
			key: 'mac',
			title: 'MAC',
			dataIndex: 'mac',
			ellipsis: true,
			width: 100,
			hideInSearch: true,
		},
		{
			key: 'lan',
			title: 'LAN',
			dataIndex: 'lan',
			ellipsis: true,
			width: 100,
			hideInSearch: true,
		},
		{
			key: 'wan',
			title: 'WAN',
			dataIndex: 'wan',
			ellipsis: true,
			width: 100,
			hideInSearch: true,
		},
		{
			key: 'uptime',
			title: i18n.t('OVERVIEW.UPTIME'),
			dataIndex: 'uptime',
			ellipsis: true,
			renderText: tsToTime,
			width: 100,
			hideInSearch: true,
		},
		{
			key: 'net_stat',
			title: i18n.t('OVERVIEW.NETWORK'),
			ellipsis: true,
			renderText: (_, v) => renderNetworkIO(v),
			width: 170,
			hideInSearch: true,
		},
		{
			key: 'option',
			title: i18n.t('OVERVIEW.OPERATIONS'),
			dataIndex: 'id',
			valueType: 'option',
			hideInSearch: true,
			ellipsis: false,
			render: (_, device) => renderOperation(device),
			width: 170,
		},
	], []);

	function renderOperation(device) {
		let menus = [
			{key: 'execute', name: i18n.t('OVERVIEW.EXECUTE')},
			{key: 'desktop', name: i18n.t('OVERVIEW.DESKTOP')},
			{key: 'screenshot', name: i18n.t('OVERVIEW.SCREENSHOT')},
			{key: 'lock', name: i18n.t('OVERVIEW.LOCK')},
			{key: 'logoff', name: i18n.t('OVERVIEW.LOGOFF')},
			{key: 'hibernate', name: i18n.t('OVERVIEW.HIBERNATE')},
			{key: 'suspend', name: i18n.t('OVERVIEW.SUSPEND')},
			{key: 'restart', name: i18n.t('OVERVIEW.RESTART')},
			{key: 'shutdown', name: i18n.t('OVERVIEW.SHUTDOWN')},
			{key: 'offline', name: i18n.t('OVERVIEW.OFFLINE')},
		];
		return [
			<a key='terminal' onClick={() => onMenuClick('terminal', device)}>{i18n.t('OVERVIEW.TERMINAL')}</a>,
			<a key='explorer' onClick={() => onMenuClick('explorer', device)}>{i18n.t('OVERVIEW.EXPLORER')}</a>,
			<a key='procmgr' onClick={() => onMenuClick('procmgr', device)}>{i18n.t('OVERVIEW.PROC_MANAGER')}</a>,
			<TableDropdown key='more' onSelect={key => onMenuClick(key, device)} menus={menus} />,
		];
	}

	function pickKeyword(params) {
		const kw = params?.keyword ?? params?.Keyword ?? '';
		return String(kw).trim();
	}

	async function getData(params = {}) {
		const current = Math.max(1, parseInt(params.current, 10) || 1);
		const pageSize = Math.max(1, parseInt(params.pageSize, 10) || DEFAULT_PAGE_SIZE);
		const keyword = pickKeyword(params);
		const {list, total, revision} = await loadDeviceList(keyword);
		if (revision != null && lastRevisionRef) {
			lastRevisionRef.current = revision;
		}
		const start = (current - 1) * pageSize;
		return {
			data: list.slice(start, start + pageSize),
			success: true,
			total,
		};
	}

	return (
		<ProTable
			scroll={{x: 'max-content', y: TABLE_HEIGHT, scrollToFirstRowOnChange: true}}
			rowKey={(row) => deviceRowKey(row)}
			search={{labelWidth: 'auto', defaultCollapsed: false}}
			beforeSearchSubmit={(values) => ({...values, keyword: String(values?.keyword ?? '').trim()})}
			options={{show: true, density: true, setting: true, reload: false}}
			columns={columns}
			columnsState={{
				persistenceKey: 'columnsState',
				persistenceType: 'localStorage',
				defaultValue: {mac: {show: false}, wan: {show: false}},
			}}
			onLoadingChange={setLoading}
			loading={loading}
			manualRequest={true}
			revalidateOnFocus={false}
			request={getData}
			pagination={{
				pageSize: DEFAULT_PAGE_SIZE,
				defaultPageSize: DEFAULT_PAGE_SIZE,
				showSizeChanger: true,
				pageSizeOptions: ['25', '50', '100'],
				showTotal: (total) => i18n.t('OVERVIEW.TOTAL_HOSTS').replace('{0}', total),
			}}
			actionRef={tableRef}
			toolBarRender={() => (
				<Space>
					<Button icon={<ReloadOutlined />} onClick={() => tableRef.current?.reload?.()}>
						{i18n.t('OVERVIEW.REFRESH')}
					</Button>
					<Button type='primary' onClick={() => onMenuClick('generate', true)}>
						{i18n.t('OVERVIEW.GENERATE')}
					</Button>
				</Space>
			)}
			components={virtualTable}
		/>
	);
}

export default DeviceTable;

