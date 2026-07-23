import os
ROOT = r"A:\000-work\001-project\158-remote-control\102-rat-spark-crossp"
p = os.path.join(ROOT, "server/handler/handler.go")
s = open(p, encoding="utf-8").read()
old = "\t\tgroup.POST(`/device/revision`, utility.GetDeviceRevision)\n\t\tgroup.POST(`/device/:act`, utility.CallDevice)"
new = "\t\tgroup.POST(`/device/revision`, utility.GetDeviceRevision)\n\t\tgroup.POST(`/device/meta/get`, utility.GetDeviceMeta)\n\t\tgroup.POST(`/device/meta/set`, utility.SetDeviceMeta)\n\t\tgroup.POST(`/device/meta/import`, utility.ImportDeviceMeta)\n\t\tgroup.POST(`/device/:act`, utility.CallDevice)"
if old not in s: raise SystemExit("missing handler block")
open(p, "w", encoding="utf-8", newline="\n").write(s.replace(old, new, 1))
print("handler ok")