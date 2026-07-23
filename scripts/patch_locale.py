from pathlib import Path

for name, search, placeholder in [
    ("en.js", "Search", "Hostname, user, IP, OS, MAC..."),
    ("zh-CN.js", "搜索", "主机名、用户、IP、系统、MAC..."),
]:
    p = Path(r"A:/000-work/001-project/158-remote-control/102-rat-spark-crossp/web/src/locale") / name
    t = p.read_text(encoding="utf-8")
    if "OVERVIEW.SEARCH" not in t:
        insert = f'\t"OVERVIEW.SEARCH": "{search}",\n\t"OVERVIEW.SEARCH_PLACEHOLDER": "{placeholder}",\n\t'
        t = t.replace('\t"OVERVIEW.GENERATE":', insert + '"OVERVIEW.GENERATE":')
        p.write_text(t, encoding="utf-8")
        print("updated", name)

ov = Path(r"A:/000-work/001-project/158-remote-control/102-rat-spark-crossp/web/src/pages/overview.jsx")
ot = ov.read_text(encoding="utf-8")
if "useCallback," in ot and "useCallback(" not in ot:
    ot = ot.replace("useCallback, ", "")
    ov.write_text(ot, encoding="utf-8")
    print("removed unused useCallback")
print("locale done")