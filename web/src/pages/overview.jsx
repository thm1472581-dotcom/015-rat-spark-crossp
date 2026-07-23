import React, {useEffect, useRef, useState} from 'react';
import {Image, message, Modal, Tabs} from 'antd';
import {QuestionCircleOutlined} from '@ant-design/icons';
import {catchBlobReq, request} from '../utils/utils';
import i18n from '../locale/locale';
import DeviceTable from '../components/overview/deviceTable';
import DeviceGroup from '../components/overview/deviceGroup';
import {ComponentMap, loadComponent} from '../components/overview/deviceShared';
import {ensureDeviceMeta} from '../utils/deviceMeta';

console.log("%c By XZB %c https://github.com/XZB-1248/Spark", 'font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:64px;color:#00bbee;-webkit-text-fill-color:#00bbee;-webkit-text-stroke:1px#00bbee;', 'font-size:12px;');

const VIEW_STORAGE_KEY = 'spark_overview_view';

function overview() {
	const [viewMode, setViewMode] = useState(() => localStorage.getItem(VIEW_STORAGE_KEY) || 'page');
	const [refreshToken, setRefreshToken] = useState(0);
	const [loading, setLoading] = useState(false);
	const [execute, setExecute] = useState(false);
	const [desktop, setDesktop] = useState(false);
	const [procMgr, setProcMgr] = useState(false);
	const [explorer, setExplorer] = useState(false);
	const [generate, setGenerate] = useState(false);
	const [terminal, setTerminal] = useState(false);
	const [screenBlob, setScreenBlob] = useState('');
	const tableRef = useRef();
	const lastRevisionRef = useRef(null);

	function triggerRefresh() {
		if (viewMode === 'page') {
			tableRef.current?.reload?.();
		} else {
			setRefreshToken(v => v + 1);
		}
	}

	useEffect(() => {
		localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
	}, [viewMode]);

	useEffect(() => {
		ensureDeviceMeta();
	}, []);

	function onViewModeChange(key) {
		setViewMode(key);
		if (key === 'page') {
			queueMicrotask(() => tableRef.current?.reload?.());
		} else {
			setRefreshToken(v => v + 1);
		}
	}

	function onMenuClick(act, value) {
		const device = value;
		const hooksMap = {
			terminal: setTerminal,
			explorer: setExplorer,
			generate: setGenerate,
			procmgr: setProcMgr,
			execute: setExecute,
			desktop: setDesktop,
		};
		if (hooksMap[act]) {
			setLoading(true);
			loadComponent(act, () => {
				hooksMap[act](device);
				setLoading(false);
			});
			return;
		}
		if (act === 'screenshot') {
			request('/api/device/screenshot/get', {device: device.id}, {}, {responseType: 'blob'}).then(res => {
				if ((res.data.type ?? '').substring(0, 5) === 'image') {
					if (screenBlob.length > 0) URL.revokeObjectURL(screenBlob);
					setScreenBlob(URL.createObjectURL(res.data));
				}
			}).catch(catchBlobReq);
			return;
		}
		Modal.confirm({
			title: i18n.t('OVERVIEW.OPERATION_CONFIRM').replace('{0}', i18n.t('OVERVIEW.' + act.toUpperCase())),
			icon: <QuestionCircleOutlined/>,
			onOk() {
				request('/api/device/' + act, {device: device.id}).then(res => {
					if (res.data.code === 0) {
						message.success(i18n.t('OVERVIEW.OPERATION_SUCCESS'));
						triggerRefresh();
					}
				});
			}
		});
	}

	const tabItems = [
		{
			key: 'page',
			label: i18n.t('OVERVIEW.VIEW_PAGE'),
			children: (
				<DeviceTable
					loading={loading}
					setLoading={setLoading}
					onMenuClick={onMenuClick}
					lastRevisionRef={lastRevisionRef}
					tableRef={tableRef}
				/>
			),
		},
		{
			key: 'group',
			label: i18n.t('OVERVIEW.VIEW_GROUP'),
			children: (
				<DeviceGroup
					onMenuClick={onMenuClick}
					lastRevisionRef={lastRevisionRef}
					refreshToken={refreshToken}
				/>
			),
		},
	];

	return (
		<>
			<Image preview={{
				visible: !!screenBlob,
				src: screenBlob,
				onVisibleChange: () => {
					URL.revokeObjectURL(screenBlob);
					setScreenBlob('');
				}
			}} />
			{ComponentMap.Generate && <ComponentMap.Generate visible={generate} onVisibleChange={setGenerate} />}
			{ComponentMap.Execute && <ComponentMap.Execute visible={execute} device={execute} onCancel={setExecute.bind(null, false)} />}
			{ComponentMap.Explorer && <ComponentMap.Explorer open={explorer} device={explorer} onCancel={setExplorer.bind(null, false)} />}
			{ComponentMap.ProcMgr && <ComponentMap.ProcMgr open={procMgr} device={procMgr} onCancel={setProcMgr.bind(null, false)} />}
			{ComponentMap.Desktop && <ComponentMap.Desktop open={desktop} device={desktop} onCancel={setDesktop.bind(null, false)} />}
			{ComponentMap.Terminal && <ComponentMap.Terminal open={terminal} device={terminal} onCancel={setTerminal.bind(null, false)} />}
			<Tabs activeKey={viewMode} onChange={onViewModeChange} items={tabItems} destroyInactiveTabPane={false} />
		</>
	);
}

export default overview;
