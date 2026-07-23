import os
ROOT = r"A:\000-work\001-project\158-remote-control\102-rat-spark-crossp"

def patch(rel, old, new):
    p = os.path.join(ROOT, rel.replace("/", os.sep))
    s = open(p, encoding="utf-8").read()
    if old not in s:
        raise SystemExit("MISSING " + rel)
    open(p, "w", encoding="utf-8", newline="\n").write(s.replace(old, new, 1))
    print("P", rel)

patch("server/config/config.go", '\t"os"\n)', '\t"os"\n\t"strings"\n)')
patch("server/config/config.go",
    '\tLog       *log              `json:"log"`\n\tSaltBytes []byte            `json:"-"`',
    '\tLog       *log              `json:"log"`\n\tData      string            `json:"data"`\n\tSaltBytes []byte            `json:"-"`')
patch("server/config/config.go",
    "\tif len(Config.Salt) > 24 {",
    '\tif strings.TrimSpace(Config.Data) == "" {\n\t\tConfig.Data = "./data"\n\t}\n\n\tif len(Config.Salt) > 24 {')
patch("server/main.go",
    '\t"Spark/server/config"\n\t"Spark/server/handler"',
    '\t"Spark/server/config"\n\t"Spark/server/devicemeta"\n\t"Spark/server/handler"')
patch("server/main.go",
    "func main() {\n\twebFS, err := fs.NewWithNamespace(`web`)",
    "func main() {\n\tif err := devicemeta.Init(config.Config.Data); err != nil {\n\t\tcommon.Fatal(nil, `DEVICE_META_INIT`, `fail`, err.Error(), nil)\n\t\treturn\n\t}\n\twebFS, err := fs.NewWithNamespace(`web`)")
print("config/main ok")