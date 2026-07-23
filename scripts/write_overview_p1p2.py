from pathlib import Path

path = Path(r"A:/000-work/001-project/158-remote-control/102-rat-spark-crossp/web/src/pages/overview.jsx")
t = path.read_text(encoding="utf-8")

# imports
t = t.replace(
    "import React, {useEffect, useRef, useState} from 'react';",
    "import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';",
)
t = t.replace(
    "import i18n from \"../locale/locale\";",
    "import i18n from \"../locale/locale\";\nimport {VList} from \"virtuallist-antd\";",
)

# constants
t = t.replace(
    "const POLL_INTERVAL = 10000;\nconst DEFAULT_PAGE_SIZE = 50;",
    "const REVISION_POLL = 3000;\nconst FALLBACK_POLL = 60000;\nconst DEFAULT_PAGE_SIZE = 25;\nconst TABLE_HEIGHT = 560;",
)

# expand helper
if "function expandDeviceRows" not in t:
    helper = """

function expandDeviceRows(list) {
\tconst result = [];
\tfor (let i = 0; i < list.length; i++) {
\t\tconst row = Object.assign({}, list[i]);
\t\tfor (const k in row) {
\t\t\tif (row[k] && typeof row[k] === 'object' && !Array.isArray(row[k])) {
\t\t\t\tfor (const key in row[k]) {
\t\t\t\t\trow[k + '_' + key] = row[k][key];
\t\t\t\t}
\t\t\t}
\t\t}
\t\tresult.push(row);
\t}
\treturn result;
}

"""
    t = t.replace("function overview(props) {", helper + "function overview(props) {")

# remove dataSource state
t = t.replace("\tconst [dataSource, setDataSource] = useState([]);\n", "")

# add lastRevisionRef after tableRef
if "lastRevisionRef" not in t:
    t = t.replace(
        "\tconst tableRef = useRef();",
        "\tconst tableRef = useRef();\n\tconst lastRevisionRef = useRef(null);\n\tconst virtualTable = useMemo(() => VList({ height: TABLE_HEIGHT }), []);",
    )

# search column at start of columns
if "dataIndex: 'keyword'" not in t:
    t = t.replace(
        "\tconst columns = [\n\t\t{\n\t\t\tkey: 'hostname',",
        "\tconst columns = useMemo(() => [\n\t\t{\n\t\t\tkey: 'keyword',\n\t\t\ttitle: i18n.t('OVERVIEW.SEARCH'),\n\t\t\tdataIndex: 'keyword',\n\t\t\thideInTable: true,\n\t\t\tfieldProps: {\n\t\t\t\tplaceholder: i18n.t('OVERVIEW.SEARCH_PLACEHOLDER'),\n\t\t\t\tallowClear: true,\n\t\t\t},\n\t\t},\n\t\t{\n\t\t\tkey: 'hostname',",
    )
    t = t.replace(
        "\t\t\twidth: 170\n\t\t},\n\t];",
        "\t\t\twidth: 170\n\t\t},\n\t], []);",
    )

# mac/wan default hidden in columnsState
t = t.replace(
    "\t\t\t\tcolumnsState={{\n\t\t\t\t\tpersistenceKey: 'columnsState',\n\t\t\t\t\tpersistenceType: 'localStorage'\n\t\t\t\t}}",
    "\t\t\t\tcolumnsState={{\n\t\t\t\t\tpersistenceKey: 'columnsState',\n\t\t\t\t\tpersistenceType: 'localStorage',\n\t\t\t\t\tdefaultValue: {\n\t\t\t\t\t\tmac: { show: false },\n\t\t\t\t\t\twan: { show: false },\n\t\t\t\t\t},\n\t\t\t\t}}",
)

# polling effect
old_effect = """\tuseEffect(() => {
\t\t// auto update is only available when all modal are closed.
\t\tif (!execute && !desktop && !procMgr && !explorer && !generate && !terminal) {
\t\t\tlet id = setInterval(() => {
\t\t\t\ttableRef.current?.reload?.();
\t\t\t}, POLL_INTERVAL);
\t\t\treturn () => {
\t\t\t\tclearInterval(id);
\t\t\t};
\t\t}
\t}, [execute, desktop, procMgr, explorer, generate, terminal]);"""

new_effect = """\tuseEffect(() => {
\t\tif (execute || desktop || procMgr || explorer || generate || terminal) {
\t\t\treturn undefined;
\t\t}
\t\tconst checkRevision = async () => {
\t\t\ttry {
\t\t\t\tconst res = await request('/api/device/revision');
\t\t\t\tif (res.data?.code !== 0) {
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst rev = res.data.data?.revision;
\t\t\t\tif (lastRevisionRef.current != null && rev !== lastRevisionRef.current) {
\t\t\t\t\ttableRef.current?.reload?.();
\t\t\t\t}
\t\t\t\tlastRevisionRef.current = rev;
\t\t\t} catch (e) {}
\t\t};
\t\tconst revisionId = setInterval(checkRevision, REVISION_POLL);
\t\tconst fallbackId = setInterval(() => tableRef.current?.reload?.(), FALLBACK_POLL);
\t\treturn () => {
\t\t\tclearInterval(revisionId);
\t\t\tclearInterval(fallbackId);
\t\t};
\t}, [execute, desktop, procMgr, explorer, generate, terminal]);"""
t = t.replace(old_effect, new_effect)

# getData
old_get = """\tasync function getData(params = {}) {
\t\tlet res = await request('/api/device/list');
\t\tlet data = res.data;
\t\tif (data.code === 0) {
\t\t\tlet result = [];
\t\t\tfor (const uuid in data.data) {
\t\t\t\tlet temp = data.data[uuid];
\t\t\t\ttemp.conn = uuid;
\t\t\t\tresult.push(temp);
\t\t\t}
\t\t\t// Iterate all object and expand them.
\t\t\tfor (let i = 0; i < result.length; i++) {
\t\t\t\tfor (const k in result[i]) {
\t\t\t\t\tif (typeof result[i][k] === 'object') {
\t\t\t\t\t\tfor (const key in result[i][k]) {
\t\t\t\t\t\t\tresult[i][k + '_' + key] = result[i][k][key];
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t\tresult = result.sort((first, second) => {
\t\t\t\tlet firstEl = (first.hostname || '').toUpperCase();
\t\t\t\tlet secondEl = (second.hostname || '').toUpperCase();
\t\t\t\tif (firstEl < secondEl) return -1;
\t\t\t\tif (firstEl > secondEl) return 1;
\t\t\t\treturn 0;
\t\t\t});
\t\t\tresult = result.sort((first, second) => {
\t\t\t\tlet firstEl = (first.os || '').toUpperCase();
\t\t\t\tlet secondEl = (second.os || '').toUpperCase();
\t\t\t\tif (firstEl < secondEl) return -1;
\t\t\t\tif (firstEl > secondEl) return 1;
\t\t\t\treturn 0;
\t\t\t});
\t\t\tsetDataSource(result);
\t\t\treturn ({
\t\t\t\tdata: result,
\t\t\t\tsuccess: true,
\t\t\t\ttotal: result.length
\t\t\t});
\t\t}
\t\treturn ({data: [], success: false, total: 0});
\t}"""

new_get = """\tasync function getData(params = {}) {
\t\tconst current = Math.max(1, parseInt(params.current, 10) || 1);
\t\tconst pageSize = Math.max(1, parseInt(params.pageSize, 10) || DEFAULT_PAGE_SIZE);
\t\tconst keyword = (params.keyword || '').trim();
\t\tlet res = await request('/api/device/list', { current, pageSize, keyword });
\t\tlet data = res.data;
\t\tif (data.code === 0) {
\t\t\tconst payload = data.data || {};
\t\t\tconst list = expandDeviceRows(payload.list || []);
\t\t\tif (payload.revision != null) {
\t\t\t\tlastRevisionRef.current = payload.revision;
\t\t\t}
\t\t\treturn ({
\t\t\t\tdata: list,
\t\t\t\tsuccess: true,
\t\t\t\ttotal: payload.total || 0,
\t\t\t});
\t\t}
\t\treturn ({data: [], success: false, total: 0});
\t}"""
t = t.replace(old_get, new_get)

# ProTable props
t = t.replace("\t\t\t\tsearch={false}", "\t\t\t\tsearch={{\n\t\t\t\t\tlabelWidth: 'auto',\n\t\t\t\t\tdefaultCollapsed: false,\n\t\t\t\t}}")
t = t.replace(
    "\t\t\t\tscroll={{\n\t\t\t\t\tx: 'max-content',\n\t\t\t\t\tscrollToFirstRowOnChange: true\n\t\t\t\t}}",
    "\t\t\t\tscroll={{\n\t\t\t\t\tx: 'max-content',\n\t\t\t\t\ty: TABLE_HEIGHT,\n\t\t\t\t\tscrollToFirstRowOnChange: true,\n\t\t\t\t}}",
)
t = t.replace(
    "\t\t\t\tpagination={{\n\t\t\t\t\tpageSize: DEFAULT_PAGE_SIZE,\n\t\t\t\t\tdefaultPageSize: DEFAULT_PAGE_SIZE,\n\t\t\t\t\tshowSizeChanger: true,\n\t\t\t\t\tpageSizeOptions: ['20', '50', '100'],\n\t\t\t\t}}",
    "\t\t\t\tpagination={{\n\t\t\t\t\tpageSize: DEFAULT_PAGE_SIZE,\n\t\t\t\t\tdefaultPageSize: DEFAULT_PAGE_SIZE,\n\t\t\t\t\tshowSizeChanger: true,\n\t\t\t\t\tpageSizeOptions: ['25', '50', '100'],\n\t\t\t\t}}",
)
if "components={virtualTable}" not in t:
    t = t.replace("\t\t\t\ttoolBarRender={toolBar}\n", "\t\t\t\ttoolBarRender={toolBar}\n\t\t\t\tcomponents={virtualTable}\n")

# remove dataSource props if still present
import re
t = re.sub(r"\n[\t ]*dataSource=\{dataSource\}\n[\t ]*onDataSourceChange=\{setDataSource\}\n", "\n", t)

# fix wrapper
t = t.replace("function wrapper(props) {\n\tlet Component = overview;\n\treturn (<Component {...props} key={Math.random()}/>)\n}\n\nexport default wrapper;", "export default overview;")

path.write_text(t, encoding="utf-8")
print("overview.jsx patched")