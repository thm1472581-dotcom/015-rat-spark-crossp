import os
ROOT = r"A:\000-work\001-project\158-remote-control\102-rat-spark-crossp"

def w(rel, content):
    p = os.path.join(ROOT, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("W", rel)

def patch(rel, old, new):
    p = os.path.join(ROOT, rel.replace("/", os.sep))
    s = open(p, encoding="utf-8").read()
    if old not in s:
        raise SystemExit("MISSING " + rel + ": " + repr(old[:60]))
    open(p, "w", encoding="utf-8", newline="\n").write(s.replace(old, new, 1))
    print("P", rel)

DEVICE_META_JS = r"""import {request} from './utils';

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
"""

w("web/src/utils/deviceMeta.js", DEVICE_META_JS)

patch("web/src/components/overview/deviceShared.jsx",
    "import {getDisplayName, loadDeviceMeta} from '../../utils/deviceMeta';",
    "import {ensureDeviceMeta, getDisplayName, loadDeviceMeta} from '../../utils/deviceMeta';")

patch("web/src/components/overview/deviceShared.jsx",
    "export async function loadDeviceList(keyword = '') {\n\tconst res = await request('/api/device/list', {current: 1, pageSize: 0, keyword: String(keyword || '').trim()});",
    "export async function loadDeviceList(keyword = '') {\n\tawait ensureDeviceMeta();\n\tconst res = await request('/api/device/list', {current: 1, pageSize: 0, keyword: String(keyword || '').trim()});")

patch("web/src/components/overview/deviceGroup.jsx",
    "\tDEFAULT_GROUP_KEY,\n\tgetAlias,",
    "\tDEFAULT_GROUP_KEY,\n\tensureDeviceMeta,\n\tgetAlias,")

patch("web/src/components/overview/deviceGroup.jsx",
    "\tconst [meta, setMeta] = useState(() => loadDeviceMeta());",
    "\tconst [meta, setMeta] = useState(() => loadDeviceMeta());\n\n\tuseEffect(() => {\n\t\tensureDeviceMeta().then(setMeta);\n\t}, []);")

patch("web/src/components/overview/deviceGroup.jsx",
    "\tfunction refreshMeta() {\n\t\tsetMeta(loadDeviceMeta());\n\t}",
    "\tfunction refreshMeta() {\n\t\tsetMeta({...loadDeviceMeta()});\n\t}")

patch("web/src/components/overview/deviceGroup.jsx",
    "\t\t\tonOk: () => {\n\t\t\t\tconst input = document.getElementById('spark-alias-input');\n\t\t\t\tsetAlias(device, input?.value || '');\n\t\t\t\trefreshMeta();\n\t\t\t\tmessage.success(i18n.t('OVERVIEW.ALIAS_SAVED'));\n\t\t\t},",
    "\t\t\tonOk: async () => {\n\t\t\t\tconst input = document.getElementById('spark-alias-input');\n\t\t\t\ttry {\n\t\t\t\t\tawait setAlias(device, input?.value || '');\n\t\t\t\t\trefreshMeta();\n\t\t\t\t\tmessage.success(i18n.t('OVERVIEW.ALIAS_SAVED'));\n\t\t\t\t} catch (e) {\n\t\t\t\t\tmessage.error(String(e.message || e));\n\t\t\t\t}\n\t\t\t},")

patch("web/src/components/overview/deviceGroup.jsx",
    "\t\t\tonOk: () => {\n\t\t\t\tconst input = document.getElementById('spark-group-input');\n\t\t\t\tconst value = (input?.value || '').trim();\n\t\t\t\tsetGroup(device, value || DEFAULT_GROUP_KEY);\n\t\t\t\trefreshMeta();\n\t\t\t\tmessage.success(i18n.t('OVERVIEW.GROUP_SAVED'));\n\t\t\t},",
    "\t\t\tonOk: async () => {\n\t\t\t\tconst input = document.getElementById('spark-group-input');\n\t\t\t\tconst value = (input?.value || '').trim();\n\t\t\t\ttry {\n\t\t\t\t\tawait setGroup(device, value || DEFAULT_GROUP_KEY);\n\t\t\t\t\trefreshMeta();\n\t\t\t\t\tmessage.success(i18n.t('OVERVIEW.GROUP_SAVED'));\n\t\t\t\t} catch (e) {\n\t\t\t\t\tmessage.error(String(e.message || e));\n\t\t\t\t}\n\t\t\t},")

patch("web/src/pages/overview.jsx",
    "import {ComponentMap, loadComponent} from '../components/overview/deviceShared';",
    "import {ComponentMap, loadComponent} from '../components/overview/deviceShared';\nimport {ensureDeviceMeta} from '../utils/deviceMeta';")

patch("web/src/pages/overview.jsx",
    "\tuseEffect(() => {\n\t\tlocalStorage.setItem(VIEW_STORAGE_KEY, viewMode);\n\t}, [viewMode]);",
    "\tuseEffect(() => {\n\t\tlocalStorage.setItem(VIEW_STORAGE_KEY, viewMode);\n\t}, [viewMode]);\n\n\tuseEffect(() => {\n\t\tensureDeviceMeta();\n\t}, []);")

patch("scripts/gen-config.ps1",
    "    log    = @{ level = 'info'; path = './logs'; days = 7 }",
    "    log    = @{ level = 'info'; path = './logs'; days = 7 }\n    data   = './data'")

patch("server/handler/utility/devicemeta.go",
    "\tif !touchAlias && !touchGroup {\n\t\ttouchAlias = true\n\t\ttouchGroup = true\n\t}",
    "\tif !touchAlias && !touchGroup {\n\t\tctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})\n\t\treturn\n\t}")

patch("server/handler/utility/devicemeta.go",
    "\tkey := strings.TrimSpace(form.Key)\n\tif key == \"\" {\n\t\tkey = devicemeta.DeviceKey(form.WAN, form.ID)\n\t\tif key == \"id:\" && strings.TrimSpace(form.ID) == \"\" && strings.TrimSpace(form.WAN) == \"\" {\n\t\t\tctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})\n\t\t\treturn\n\t\t}\n\t}",
    "\tinfo := devicemeta.DeviceInfo{\n\t\tWAN: form.WAN, ID: form.ID, MAC: form.MAC, LAN: form.LAN, Hostname: form.Hostname,\n\t}\n\tkey := strings.TrimSpace(form.Key)\n\tif key == \"\" {\n\t\tkey = devicemeta.ResolveKey(info)\n\t}\n\tif key == \"\" || key == \"id:\" {\n\t\tctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})\n\t\treturn\n\t}")

patch("server/devicemeta/store.go",
    "\tif touchGroup {\n\t\tif group != \"\" {\n\t\t\tstore.Groups[key] = group\n\t\t} else {\n\t\t\tstore.Groups[key] = DefaultGroupKey\n\t\t}\n\t}",
    "\tif touchGroup {\n\t\tgroup = strings.TrimSpace(group)\n\t\tif group == \"\" || group == DefaultGroupKey {\n\t\t\tdelete(store.Groups, key)\n\t\t} else {\n\t\t\tstore.Groups[key] = group\n\t\t}\n\t}")

patch("server/devicemeta/store.go",
    "\t\t\tv = strings.TrimSpace(v)\n\t\t\tif v == \"\" {\n\t\t\t\tstore.Groups[k] = DefaultGroupKey\n\t\t\t} else {\n\t\t\t\tstore.Groups[k] = v\n\t\t\t}",
    "\t\t\tv = strings.TrimSpace(v)\n\t\t\tif v == \"\" || v == DefaultGroupKey {\n\t\t\t\tdelete(store.Groups, k)\n\t\t\t} else {\n\t\t\t\tstore.Groups[k] = v\n\t\t\t}")

bat_path = os.path.join(ROOT, "scripts", "make.deploy.bat")
bat = open(bat_path, encoding="utf-8").read()
if "DATA_BACKUP" not in bat:
    bat = bat.replace(
        'set "KTHREAD_BACKUP=%TEMP%\\spark_kthread_backup"',
        'set "KTHREAD_BACKUP=%TEMP%\\spark_kthread_backup"\nset "DATA_BACKUP=%TEMP%\\spark_data_backup"')
    bat = bat.replace(
        'if exist "%DEPLOY_DIR%\\kthread" (\n    copy /y "%DEPLOY_DIR%\\kthread" "%KTHREAD_BACKUP%" >nul\n    echo        Will preserve existing deploy\\kthread (Web UI generated)\n)',
        'if exist "%DEPLOY_DIR%\\kthread" (\n    copy /y "%DEPLOY_DIR%\\kthread" "%KTHREAD_BACKUP%" >nul\n    echo        Will preserve existing deploy\\kthread (Web UI generated)\n)\n\nif exist "%DEPLOY_DIR%\\data" (\n    if exist "%DATA_BACKUP%" rmdir /s /q "%DATA_BACKUP%"\n    xcopy /e /i /y /q "%DEPLOY_DIR%\\data" "%DATA_BACKUP%\\" >nul\n    echo        Will preserve existing deploy\\data\n)')
    bat = bat.replace(
        'mkdir "%DEPLOY_DIR%\\logs"',
        'mkdir "%DEPLOY_DIR%\\logs"\nmkdir "%DEPLOY_DIR%\\data"')
    bat = bat.replace(
        'echo   logs\\            - log output directory',
        'echo   logs\\            - log output directory\necho   data\\            - device groups/aliases (device_meta.json)')
    bat = bat.replace(
        'if exist "%KTHREAD_BACKUP%" (\n    copy /y "%KTHREAD_BACKUP%" "%DEPLOY_DIR%\\kthread" >nul\n    del "%KTHREAD_BACKUP%" >nul 2>&1\n    echo        Restored Web UI generated kthread\n)',
        'if exist "%KTHREAD_BACKUP%" (\n    copy /y "%KTHREAD_BACKUP%" "%DEPLOY_DIR%\\kthread" >nul\n    del "%KTHREAD_BACKUP%" >nul 2>&1\n    echo        Restored Web UI generated kthread\n)\n\nif exist "%DATA_BACKUP%" (\n    xcopy /e /i /y /q "%DATA_BACKUP%\\*" "%DEPLOY_DIR%\\data\\" >nul\n    rmdir /s /q "%DATA_BACKUP%" >nul 2>&1\n    echo        Restored existing data directory\n) else (\n    echo {"aliases":{},"groups":{}}> "%DEPLOY_DIR%\\data\\device_meta.json"\n    echo        Created default data\\device_meta.json\n)')
    open(bat_path, "w", encoding="utf-8", newline="\r\n").write(bat)
    print("P scripts/make.deploy.bat")

print("done")