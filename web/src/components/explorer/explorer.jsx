import React, {useEffect, useMemo, useRef, useState} from "react";
import ProTable, {TableDropdown} from "@ant-design/pro-table";
import {Breadcrumb, Button, Image, Input, message, Modal, Popconfirm, Space} from "antd";
import {catchBlobReq, formatSize, orderCompare, post, request, waitTime} from "../../utils/utils";
import dayjs from "dayjs";
import i18n from "../../locale/locale";
import {VList} from "virtuallist-antd";
import {HomeOutlined, QuestionCircleOutlined, ReloadOutlined, UploadOutlined} from "@ant-design/icons";
import Qs from "qs";
import DraggableModal from "../modal";
import FileUploader from "./uploader";
import AceBuilds from "ace-builds";
import "./explorer.css";

let TextEditor = null;
const ModeList = AceBuilds.require("ace/ext/modelist");

function loadEditor(callback) {
	if (TextEditor === null) {
		import('./editor').then(m => {
			TextEditor = m.default;
			callback();
		});
	} else {
		callback();
	}
}

let isWindows = false;
let position = '';
let fileList = [];
function FileBrowser(props) {
	const [path, setPath] = useState(`/`);
	const [preview, setPreview] = useState('');
	const [loading, setLoading] = useState(false);
	const [draggable, setDraggable] = useState(true);
	const [uploading, setUploading] = useState(false);
	const [editingFile, setEditingFile] = useState('');
	const [editingContent, setEditingContent] = useState('');
	const [selectedRowKeys, setSelectedRowKeys] = useState([]);
	const [searchInput, setSearchInput] = useState('');
	const searchKeywordRef = useRef('');
	const recursiveSearchRef = useRef(false);
	const [tableParams, setTableParams] = useState({});
	const columns = [
		{
			key: 'Name',
			title: i18n.t('EXPLORER.FILE_NAME'),
			dataIndex: 'name',
			ellipsis: true,
			width: 180
		},
		{
			key: 'Size',
			title: i18n.t('EXPLORER.FILE_SIZE'),
			dataIndex: 'size',
			ellipsis: true,
			width: 60,
			// only display file size when it is a file or disk
			renderText: (size, file) => file.type === 0 || file.type === 2 ? formatSize(size) : '-'
		},
		{
			key: 'Time',
			title: i18n.t('EXPLORER.DATE_MODIFIED'),
			dataIndex: 'time',
			ellipsis: true,
			width: 100,
			renderText: (ts, file) => file.type === 0 ? dayjs.unix(ts).format(i18n.t('EXPLORER.DATE_TIME_FORMAT')) : '-'
		},
		{
			key: 'Option',
			width: 120,
			title: '',
			dataIndex: 'name',
			valueType: 'option',
			ellipsis: true,
			render: (_, file) => renderOperation(file)
		},
	];
	const options = {
		show: true,
		search: false,
		reload: false,
		density: false,
		setting: false,
	};
	const tableRef = useRef();
	const virtualTable = useMemo(() => {
		return VList({
			height: 300,
			vid: 'file-table',
		})
	}, []);
	const alertOptionRenderer = () => (<Space size={16}>
		<Popconfirm
			title={i18n.t('EXPLORER.DOWNLOAD_MULTI_CONFIRM')}
			onConfirm={() => downloadFiles(selectedRowKeys)}
		>
			<a>{i18n.t('EXPLORER.DOWNLOAD')}</a>
		</Popconfirm>
		<Popconfirm
			title={i18n.t('EXPLORER.DELETE_MULTI_CONFIRM')}
			onConfirm={() => removeFiles(selectedRowKeys)}
		>
			<a>{i18n.t('EXPLORER.DELETE')}</a>
		</Popconfirm>
	</Space>);
	useEffect(() => {
		if (props.device) {
			isWindows = props.device.os === 'windows';
			position = '/';
			setPath(`/`);
		}
		if (props.open) {
			fileList = [];
			setLoading(false);
			setSearchInput('');
			searchKeywordRef.current = '';
			recursiveSearchRef.current = false;
			setTableParams({});
		}
	}, [props.device, props.open]);


	function renderOperation(file) {
		let menus = [
			{key: 'editAsText', name: i18n.t('EXPLORER.EDIT_AS_TEXT')},
			{key: 'delete', name: i18n.t('EXPLORER.DELETE')},
		];
		if (file.type === 1) {
			menus.shift();
		} else if (file.type === 2) {
			return [];
		}
		if (file.name === '..') {
			return [];
		}
		return [
			<a
				key='download'
				onClick={() => downloadFiles(getRowKey(file))}
			>
				{i18n.t('EXPLORER.DOWNLOAD')}
			</a>,
			<TableDropdown
				key='more'
				onSelect={key => onDropdownSelect(key, file)}
				menus={menus}
			/>,
		];
	}
	function onDropdownSelect(key, file) {
		switch (key) {
			case 'delete':
				let content = i18n.t('EXPLORER.DELETE_CONFIRM');
				if (file.type === 0) {
					content = content.replace('{0}', i18n.t('EXPLORER.FILE'));
				} else {
					content = content.replace('{0}', i18n.t('EXPLORER.FOLDER'));
				}
				Modal.confirm({
					icon: <QuestionCircleOutlined />,
					content: content,
					onOk: removeFiles.bind(null, getRowKey(file))
				});
				break;
			case 'editAsText':
				textEdit(file);
		}
	}
	function onRowClick(file) {
		const separator = isWindows ? '\\' : '/';
		if (file.name === '..') {
			listFiles(getParentPath(position));
			return;
		}
		if (recursiveSearchRef.current && file.fullPath) {
			if (file.type !== 0) {
				let dir = file.fullPath;
				if (!dir.endsWith(separator)) {
					dir += separator;
				}
				listFiles(dir);
				return;
			}
			const baseName = file.name.split('/').pop().split('\\').pop();
			const ext = baseName.split('.').pop().toLowerCase();
			const images = ['jpg', 'jpeg', 'png', 'gif', 'bmp'];
			if (images.includes(ext) && file.size <= 2 << 22) {
				imgPreview(file);
				return;
			}
			if (file.size <= 2 << 20) {
				const result = ModeList.getModeForPath(baseName);
				if (result && result.extRe.test(baseName)) {
					textEdit(file);
					return;
				}
			}
			downloadFiles(getRowKey(file));
			return;
		}
		if (file.type !== 0) {
			if (isWindows) {
				if (path === '/' || path === '\\' || path.length === 0) {
					listFiles(file.name + separator);
					return
				}
			}
			listFiles(path + file.name + separator);
			return;
		}
		const ext = file.name.split('.').pop().toLowerCase();
		// Preview image when size is less than 8M.
		const images = ['jpg', 'jpeg', 'png', 'gif', 'bmp'];
		if (images.includes(ext) && file.size <= 2 << 22) {
			imgPreview(file);
			return;
		}
		// Open editor when file is a text file and size is less than 2MB.
		if (file.size <= 2 << 20) {
			const result = ModeList.getModeForPath(file.name);
			if (result && result.extRe.test(file.name)) {
				textEdit(file);
				return;
			}
		}
		downloadFiles(getRowKey(file));
	}
	function imgPreview(file) {
		setLoading(true);
		request('/api/device/file/get', {device: props.device.id, files: getFilePath(file)}, {}, {
			responseType: 'blob',
			timeout: 10000
		}).then(res => {
			if (res.status === 200) {
				if (preview.length > 0) {
					URL.revokeObjectURL(preview);
				}
				setPreview(URL.createObjectURL(res.data));
			}
		}).catch(catchBlobReq).finally(() => {
			setLoading(false);
		});
	}
	function textEdit(file) {
		// Only edit text file smaller than 2MB.
		if (file.size > 2 << 20) {
			message.warn(i18n.t('EXPLORER.FILE_TOO_LARGE'));
			return;
		}
		if (editingFile) return;
		setLoading(true);
		request('/api/device/file/text', {device: props.device.id, file: getFilePath(file)}, {}, {
			responseType: 'blob',
			timeout: 7000
		}).then(res => {
			if (res.status === 200) {
				res.data.text().then(str => {
					loadEditor(() => {
						setEditingContent(str);
						setDraggable(false);
						setEditingFile(file.name);
					});
				});
			}
		}).catch(catchBlobReq).finally(() => {
			setLoading(false);
		});
	}


	function getFilePath(file) {
		if (file.fullPath) {
			return file.fullPath;
		}
		return path + file.name;
	}

	function getRowKey(file) {
		return file.fullPath || file.name;
	}

	function resolveFilePaths(items) {
		if (Array.isArray(items)) {
			let files = [];
			for (let i = 0; i < items.length; i++) {
				if (items[i] === '..') continue;
				let found = fileList.find(f => getRowKey(f) === items[i] || f.name === items[i]);
				files.push(found?.fullPath || (path + items[i]));
			}
			return files;
		}
		let found = fileList.find(f => f.name === items || getRowKey(f) === items);
		return found?.fullPath || (path + items);
	}

	function filterCurrentDirFiles(files, keyword) {
		if (!keyword) {
			return files;
		}
		let kw = keyword.toLowerCase();
		let exp = kw.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		let regexp = new RegExp(`^${exp.replace(/\*/g,'.*').replace(/\?/g,'.')}$`, 'i');
		return files.filter(file => {
			if (file.name === '..') {
				return true;
			}
			if (file.name.toLowerCase().includes(kw)) {
				return true;
			}
			return regexp.test(file.name);
		});
	}

	function getSearchPath() {
		return position || path;
	}

	function onSearchCurrentDir() {
		const kw = searchInput.trim();
		searchKeywordRef.current = kw;
		recursiveSearchRef.current = false;
		setTableParams({ keyword: kw, recursive: '', _ts: Date.now() });
		runFileSearch();
	}

	function onSearchRecursive() {
		const kw = searchInput.trim();
		if (!kw) {
			message.warn(i18n.t('EXPLORER.SEARCH_KEYWORD_REQUIRED'));
			return;
		}
		const searchPath = getSearchPath();
		if (searchPath === '/' || searchPath === '\\' || searchPath.length === 0) {
			message.warn(i18n.t('EXPLORER.SEARCH_NEED_PATH'));
			return;
		}
		searchKeywordRef.current = kw;
		recursiveSearchRef.current = true;
		setTableParams({ keyword: kw, recursive: '1', _ts: Date.now() });
		runFileSearch();
	}

	function onClearSearch() {
		setSearchInput('');
		searchKeywordRef.current = '';
		recursiveSearchRef.current = false;
		setTableParams({ keyword: '', recursive: '', _ts: Date.now() });
		runFileSearch();
	}
	function listFiles(newPath) {
		if (loading) return;
		recursiveSearchRef.current = false;
		searchKeywordRef.current = '';
		setSearchInput('');
		position = newPath;
		setPath(newPath);
		setTableParams({ keyword: '', recursive: '', _ts: Date.now() });
		tableRef.current?.reload();
	}
	function getParentPath(path) {
		let separator = isWindows ? '\\' : '/';
		// remove the last separator
		// or there'll be an empty element after split
		let tempPath = path.substring(0, path.length - 1);
		let pathArr = tempPath.split(separator);
		// remove current folder
		pathArr.pop();
		// back to root folder
		if (pathArr.length === 0) {
			return `/`;
		}
		return pathArr.join(separator) + separator;
	}

	function uploadFile() {
		if (path === '/' || path === '\\' || path.length === 0) {
			if (isWindows) {
				message.error(i18n.t('EXPLORER.UPLOAD_INVALID_PATH'));
				return;
			}
		}
		document.getElementById('file-uploader').click();
	}
	function onFileChange(e) {
		let file = e.target.files[0];
		if (file === undefined) return;
		e.target.value = null;
		{
			let exists = false;
			for (let i = 0; i < fileList.length; i++) {
				if (fileList[i].type === 0 && fileList[i].name === file.name) {
					exists = true;
					break;
				}
			}
			if (exists) {
				Modal.confirm({
					autoFocusButton: 'cancel',
					content: i18n.t('EXPLORER.OVERWRITE_CONFIRM').replace('{0}', file.name),
					okText: i18n.t('EXPLORER.OVERWRITE'),
					onOk: () => {
						setUploading(file);
					},
					okButtonProps: {
						danger: true,
					},
				});
			} else {
				setUploading(file);
				setDraggable(false);
			}
		}
	}
	function onUploadSuccess() {
		tableRef.current.reload();
		setUploading(false);
		setDraggable(true);
	}
	function onUploadCancel() {
		setUploading(false);
		setDraggable(true);
	}

	function downloadFiles(items) {
		if (path === '/' || path === '\\' || path.length === 0) {
			if (isWindows && !recursiveSearchRef.current) {
				// It may take an extremely long time to archive volumes.
				// So we don't allow to download volumes.
				// Besides, archive volumes may throw an error.
				message.error(i18n.t('EXPLORER.DOWNLOAD_VOLUMES_ERROR'));
				return;
			}
		}
		let files = resolveFilePaths(items);
		if (Array.isArray(files) && files.length === 0) {
			return;
		}
		post(location.origin + location.pathname + 'api/device/file/get', {
			files: files,
			device: props.device.id
		});
	}
	function removeFiles(items) {
		if (path === '/' || path === '\\' || path.length === 0) {
			if (isWindows && !recursiveSearchRef.current) {
				message.error(i18n.t('EXPLORER.DELETE_INVALID_PATH'));
				return;
			}
		}
		let files = resolveFilePaths(items);
		if (Array.isArray(files) && files.length === 0) {
			return;
		}
		request(`/api/device/file/remove`, {
			files: files,
			device: props.device.id
		}, {}, {
			transformRequest: [v => Qs.stringify(v, {indices: false})]
		}).then(res => {
			let data = res.data;
			if (data.code === 0) {
				message.success(i18n.t('EXPLORER.DELETE_SUCCESS'));
				tableRef.current.reload();
			}
		});
	}

	function buildFileListResult(files, keyword, recursive) {
		let addParentShortcut = false;
		if (!recursive && keyword.length > 0) {
			files = filterCurrentDirFiles(files, keyword);
		}
		files = files.sort((a, b) => orderCompare(a.name, b.name));
		files = files.sort((a, b) => (b.type - a.type));
		if (!recursive && path.length > 0 && path !== '/' && path !== '\\') {
			addParentShortcut = true;
			files.unshift({
				name: '..',
				size: '0',
				type: 3,
				modTime: 0
			});
		}
		fileList = [].concat(files);
		setPath(position);
		return {
			data: files,
			success: true,
			total: files.length - (addParentShortcut ? 1 : 0)
		};
	}

	async function queryFileList(keyword, recursive) {
		let params = {path: position, device: props.device.id};
		if (recursive && keyword.length > 0) {
			params.keyword = keyword;
			params.recursive = '1';
		}
		let res = await request('/api/device/file/list', params);
		let data = res.data;
		if (data.code === 0) {
			return buildFileListResult(data.data.files || [], keyword, recursive);
		}
		if (!recursive) {
			setPath(getParentPath(position));
		}
		return {data: [], success: false, total: 0};
	}

	function runFileSearch() {
		setSelectedRowKeys([]);
		// ProTable skips fetch while controlled loading=true; reset before reload.
		setLoading(false);
		requestAnimationFrame(() => {
			tableRef.current?.reload();
		});
	}

	async function getData(form) {
		await waitTime(300);
		const keyword = String(form.keyword ?? searchKeywordRef.current ?? '').trim();
		const recursive = (form.recursive === '1' || recursiveSearchRef.current) && keyword.length > 0;
		setSelectedRowKeys([]);
		const result = await queryFileList(keyword, recursive);
		setLoading(false);
		return result;
	}

	return (
		<DraggableModal
			draggable={draggable}
			maskClosable={false}
			destroyOnClose={true}
			modalTitle={i18n.t('EXPLORER.TITLE')}
			footer={null}
			width={830}
			bodyStyle={{
				padding: 0
			}}
			{...props}
		>
				<div className="explorer-search-bar">
				<Input
					allowClear
					value={searchInput}
					placeholder={i18n.t('EXPLORER.SEARCH_PLACEHOLDER')}
					onChange={(e) => setSearchInput(e.target.value)}
					onPressEnter={onSearchCurrentDir}
				/>
				<Button onClick={onSearchCurrentDir}>{i18n.t('EXPLORER.SEARCH_CURRENT')}</Button>
				<Button type="primary" onClick={onSearchRecursive}>{i18n.t('EXPLORER.SEARCH_RECURSIVE')}</Button>
				<Button onClick={onClearSearch}>{i18n.t('EXPLORER.SEARCH_CLEAR')}</Button>
			</div>
			<ProTable
				params={tableParams}
				rowKey={(row) => getRowKey(row)}
				tableStyle={{
					minHeight: '320px',
					maxHeight: '320px'
				}}
				onRow={file => ({
					onDoubleClick: onRowClick.bind(null, file)
				})}
				scroll={{scrollToFirstRowOnChange: true, y: 300}}
				search={false}
				size='small'
				loading={loading}
				rowClassName='file-row'
				onLoadingChange={setLoading}
				rowSelection={{
					selectedRowKeys,
					onChange: setSelectedRowKeys,
					alwaysShowAlert: true
				}}
				tableAlertRender={() =>
					i18n.t('EXPLORER.MULTI_SELECT_LABEL').
					replace('{0}', String(selectedRowKeys.length)).
					replace('{1}', String(fileList.length))
				}
				tableAlertOptionRender={
					selectedRowKeys.length===0?
						null:alertOptionRenderer
				}
				options={options}
				columns={columns}
				request={getData}
				pagination={false}
				actionRef={tableRef}
				components={virtualTable}
			/>
			<Button
				style={{right:'59px'}}
				className='header-button'
				icon={<ReloadOutlined />}
				onClick={() => {
					tableRef.current.reload();
				}}
			/>
			<Button
				style={{right:'115px'}}
				className='header-button'
				icon={<UploadOutlined />}
				onClick={uploadFile}
			/>
			<input
				id='file-uploader'
				type='file'
				onChange={onFileChange}
				style={{display: 'none'}}
			/>
			{
				TextEditor &&
				<TextEditor
					path={path}
					file={editingFile}
					device={props.device}
					content={editingContent}
					onCancel={reload=>{
						setEditingFile('');
						setEditingContent('');
						setDraggable(true);
						if (reload) tableRef.current.reload();
					}}
				/>
			}
			<FileUploader
				open={uploading}
				path={path}
				file={uploading}
				device={props.device}
				onSuccess={onUploadSuccess}
				onCancel={onUploadCancel}
			/>
			<Image
				preview={{
					visible: preview,
					src: preview,
					onVisibleChange: () => {
						URL.revokeObjectURL(preview);
						setPreview('');
					}
				}}
			/>
		</DraggableModal>
	)
}

function Navigator(props) {
	let separator = isWindows ? '\\' : '/';
	let path = [];
	let pathItems = [];
	let tempPath = props.path;
	if (tempPath.endsWith(separator)) {
		tempPath = tempPath.substring(0, tempPath.length - 1);
	}
	if (tempPath.length > 0 && tempPath !== '/' && tempPath !== '\\') {
		path = tempPath.split(separator);
	}
	for (let i = 0; i < path.length; i++) {
		let name = path[i];
		if (i === 0 && isWindows) {
			if (name.endsWith(':')) {
				name = name.substring(0, name.length - 1);
			}
		}
		pathItems.push({
			name: name,
			path: path.slice(0, i + 1).join(separator) + separator
		});
	}
	if (path.length > 0 && isWindows) {
		let first = path[0];
		if (first.endsWith(':')) {
			first = first.substring(0, first.length - 1);
		}
		path[0] = first;
	}
	pathItems.pop();

	return (
		<Breadcrumb
			style={{marginLeft: '10px', marginRight: '10px'}}
			disabled={props.loading}
		>
			<Breadcrumb.Item
				style={{cursor: 'pointer'}}
				onClick={props.onClick.bind(null, '/')}
			>
				<HomeOutlined/>
			</Breadcrumb.Item>
			{pathItems.map(item => (
				<Breadcrumb.Item
					key={item.path}
					style={{cursor: 'pointer'}}
					onClick={props.onClick.bind(null, item.path)}
				>
					{item.name}
				</Breadcrumb.Item>
			))}
			{path.length > 0 ? (
				<Breadcrumb.Item>
					{path[path.length - 1]}
				</Breadcrumb.Item>
			) : null}
		</Breadcrumb>
	)
}

export default FileBrowser;