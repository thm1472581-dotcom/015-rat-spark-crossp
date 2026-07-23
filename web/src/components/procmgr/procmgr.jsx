import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, message, Popconfirm} from "antd";
import ProTable from '@ant-design/pro-table';
import {request, waitTime} from "../../utils/utils";
import i18n from "../../locale/locale";
import DraggableModal from "../modal";
import {ReloadOutlined} from "@ant-design/icons";

const TABLE_HEIGHT = 420;
const PAGE_SIZE = 50;

function matchProcessKeyword(proc, keyword) {
	if (!keyword) {
		return true;
	}
	const fields = ['name', 'user', 'pid', 'cpu', 'mem', 'rss', 'stat', 'memUsage', 'status', 'windowTitle', 'session', 'cpuTime', 'vsz'];
	return fields.some((key) => String(proc?.[key] ?? '').toLowerCase().includes(keyword));
}

function filterProcesses(list, keyword) {
	const kw = (keyword || '').trim().toLowerCase();
	if (!kw) {
		return list;
	}
	return list.filter((proc) => matchProcessKeyword(proc, kw));
}

function ProcessMgr(props) {
	const [loading, setLoading] = useState(false);
	const isWindows = props.device?.os === 'windows';
	const tableRef = useRef();

	const renderOperation = useCallback((proc) => {
		return [
			<Popconfirm
				key='kill'
				title={i18n.t('PROCMGR.KILL_PROCESS_CONFIRM')}
				onConfirm={() => killProcess(proc.pid)}
			>
				<a>{i18n.t('PROCMGR.KILL_PROCESS')}</a>
			</Popconfirm>
		];
	}, [props.device?.id]);

	const columns = useMemo(() => {
		const base = [
			{
				key: 'keyword',
				title: i18n.t('PROCMGR.SEARCH'),
				dataIndex: 'keyword',
				hideInTable: true,
				fieldProps: {
					placeholder: i18n.t('PROCMGR.SEARCH_PLACEHOLDER'),
					allowClear: true,
				},
			},
			{
				key: 'Name',
				title: i18n.t('PROCMGR.PROCESS'),
				dataIndex: 'name',
				ellipsis: true,
				width: 200,
				hideInSearch: true,
			},
			{
				key: 'Pid',
				title: 'PID',
				dataIndex: 'pid',
				width: 80,
				hideInSearch: true,
			},
		];
		if (isWindows) {
			base.push(
				{ key: 'User', title: 'User', dataIndex: 'user', ellipsis: true, width: 140, hideInSearch: true },
				{ key: 'MemUsage', title: 'Mem', dataIndex: 'memUsage', ellipsis: true, width: 90, hideInSearch: true },
				{ key: 'Status', title: 'Status', dataIndex: 'status', ellipsis: true, width: 90, hideInSearch: true },
				{ key: 'WindowTitle', title: 'Window', dataIndex: 'windowTitle', ellipsis: true, width: 180, hideInSearch: true },
			);
		} else {
			base.push(
				{ key: 'User', title: 'User', dataIndex: 'user', ellipsis: true, width: 100, hideInSearch: true },
				{ key: 'CPU', title: 'CPU', dataIndex: 'cpu', ellipsis: true, width: 70, hideInSearch: true },
				{ key: 'Mem', title: 'Mem', dataIndex: 'mem', ellipsis: true, width: 70, hideInSearch: true },
				{ key: 'RSS', title: 'RSS', dataIndex: 'rss', ellipsis: true, width: 80, hideInSearch: true },
				{ key: 'Stat', title: 'Stat', dataIndex: 'stat', ellipsis: true, width: 70, hideInSearch: true },
			);
		}
		base.push({
			key: 'Option',
			width: 70,
			title: '',
			valueType: 'option',
			fixed: 'right',
			hideInSearch: true,
			render: (_, proc) => renderOperation(proc)
		});
		return base;
	}, [isWindows, renderOperation]);

	const options = {
		show: true,
		reload: false,
		density: false,
		setting: false,
	};

	useEffect(() => {
		if (props.open) {
			setLoading(false);
		}
	}, [props.device, props.open]);

	function killProcess(pid) {
		request(`/api/device/process/kill`, {pid: pid, device: props.device.id}).then(res => {
			let data = res.data;
			if (data.code === 0) {
				message.success(i18n.t('PROCMGR.KILL_PROCESS_SUCCESSFULLY'));
				tableRef.current.reload();
			}
		});
	}

	async function getData(params) {
		await waitTime(300);
		const keyword = (params.keyword || '').trim();
		let res = await request('/api/device/process/list', {
			device: props.device.id,
			keyword: keyword,
		});
		setLoading(false);
		let data = res.data;
		if (data.code === 0) {
			let processes = filterProcesses((data.data?.processes ?? []).slice(), keyword)
				.sort((a, b) => (b.pid - a.pid));
			const pageSize = params.pageSize || PAGE_SIZE;
			const current = params.current || 1;
			const start = (current - 1) * pageSize;
			return ({
				data: processes.slice(start, start + pageSize),
				success: true,
				total: processes.length
			});
		}
		return ({data: [], success: false, total: 0});
	}

	return (
		<DraggableModal
			draggable={true}
			maskClosable={false}
			destroyOnClose={true}
			modalTitle={i18n.t('PROCMGR.TITLE')}
			footer={null}
			width={isWindows ? 980 : 920}
			bodyStyle={{ padding: 0 }}
			{...props}
		>
			<ProTable
				rowKey={(row) => `${row.pid}-${row.name}`}
				tableStyle={{ paddingTop: '12px' }}
				scroll={{ scrollToFirstRowOnChange: true, x: 'max-content', y: TABLE_HEIGHT }}
				search={{
					labelWidth: 'auto',
					defaultCollapsed: false,
				}}
				size='small'
				loading={loading}
				onLoadingChange={setLoading}
				options={options}
				columns={columns}
				request={getData}
				pagination={{
					pageSize: PAGE_SIZE,
					defaultPageSize: PAGE_SIZE,
					showSizeChanger: true,
					pageSizeOptions: ['25', '50', '100', '200'],
					showTotal: (total) => i18n.t('PROCMGR.TOTAL').replace('{0}', total),
				}}
				actionRef={tableRef}
			/>
			<Button
				style={{right:'59px'}}
				className='header-button'
				icon={<ReloadOutlined />}
				onClick={() => {
					tableRef.current.reload();
				}}
			/>
		</DraggableModal>
	)
}

export default ProcessMgr;