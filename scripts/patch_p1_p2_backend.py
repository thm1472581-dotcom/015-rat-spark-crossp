# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"A:/000-work/001-project/158-remote-control/102-rat-spark-crossp")

common_path = ROOT / "server/common/common.go"
common = common_path.read_text(encoding="utf-8")
if "BumpDeviceRevision" not in common:
    if "sync/atomic" not in common:
        common = common.replace("import (", 'import (\n\t"sync/atomic\n', 1)
    insert = """

var deviceRevision uint64

func BumpDeviceRevision() {
	atomic.AddUint64(&deviceRevision, 1)
}

func DeviceRevision() uint64 {
	return atomic.LoadUint64(&deviceRevision)
}
"""
    common = common.replace("var Devices = cmap.New[*modules.Device]()", "var Devices = cmap.New[*modules.Device]()" + insert)
    common_path.write_text(common, encoding="utf-8")
    print("patched common.go")

util_path = ROOT / "server/handler/utility/utility.go"
util = util_path.read_text(encoding="utf-8")
if "sort" not in util.split("import (")[1].split(")")[0]:
    util = util.replace('\t"strings"\n', '\t"sort"\n\t"strings"\n', 1)
util = util.replace(
    "\t\tif len(exSession) > 0 {\n\t\t\tcommon.Devices.Remove(exSession)\n\t\t}\n\t\tcommon.Devices.Set(session.UUID, &pack.Device)",
    "\t\tif len(exSession) > 0 {\n\t\t\tcommon.Devices.Remove(exSession)\n\t\t\tcommon.BumpDeviceRevision()\n\t\t}\n\t\tcommon.Devices.Set(session.UUID, &pack.Device)\n\t\tcommon.BumpDeviceRevision()",
)
old_get = "// GetDevices will return all info about all clients.\nfunc GetDevices(ctx *gin.Context) {\n\tdevices := map[string]any{}\n\tcommon.Devices.IterCb(func(uuid string, device *modules.Device) bool {\n\t\tdevices[uuid] = *device\n\t\treturn true\n\t})\n\tctx.JSON(http.StatusOK, modules.Packet{Code: 0, Data: devices})\n}"
new_get = open(ROOT / "scripts/_getdevices_new.go.txt", encoding="utf-8").read()
if old_get in util:
    util = util.replace(old_get, new_get)
    util_path.write_text(util, encoding="utf-8")
    print("patched utility.go")
else:
    print("WARN GetDevices not found")

main_path = ROOT / "server/main.go"
main = main_path.read_text(encoding="utf-8")
if "BumpDeviceRevision" not in main:
    main = main.replace("\tcommon.Devices.Remove(session.UUID)\n}", "\tcommon.Devices.Remove(session.UUID)\n\tcommon.BumpDeviceRevision()\n}")
    main_path.write_text(main, encoding="utf-8")
    print("patched main.go")

handler_path = ROOT / "server/handler/handler.go"
handler = handler_path.read_text(encoding="utf-8")
if "device/revision" not in handler:
    handler = handler.replace("\t\tgroup.POST(`/device/list`, utility.GetDevices)", "\t\tgroup.POST(`/device/list`, utility.GetDevices)\n\t\tgroup.POST(`/device/revision`, utility.GetDeviceRevision)")
    handler_path.write_text(handler, encoding="utf-8")
    print("patched handler.go")
print("backend done")