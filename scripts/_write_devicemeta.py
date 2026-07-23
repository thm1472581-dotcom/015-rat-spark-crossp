import os
ROOT = r"A:\000-work\001-project\158-remote-control\102-rat-spark-crossp"

def w(rel, content):
    p = os.path.join(ROOT, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("W", rel)

STORE_GO = r'''package devicemeta

import (
	"Spark/utils"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const DefaultGroupKey = "__default__"
const fileName = "device_meta.json"

type Snapshot struct {
	Aliases map[string]string `json:"aliases"`
	Groups  map[string]string `json:"groups"`
}

type DeviceInfo struct {
	WAN      string
	MAC      string
	LAN      string
	Hostname string
	ID       string
}

var (
	mu       sync.RWMutex
	dataDir  string
	filePath string
	store    Snapshot
)

func Init(dir string) error {
	dataDir = strings.TrimSpace(dir)
	if dataDir == "" {
		dataDir = "./data"
	}
	filePath = filepath.Join(dataDir, fileName)
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}
	store = Snapshot{
		Aliases: map[string]string{},
		Groups:  map[string]string{},
	}
	raw, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return saveLocked()
		}
		return err
	}
	if len(raw) > 0 {
		var loaded Snapshot
		if err := utils.JSON.Unmarshal(raw, &loaded); err != nil {
			return err
		}
		if loaded.Aliases != nil {
			store.Aliases = loaded.Aliases
		}
		if loaded.Groups != nil {
			store.Groups = loaded.Groups
		}
	}
	return nil
}

func Get() Snapshot {
	mu.RLock()
	defer mu.RUnlock()
	return cloneLocked()
}

func cloneLocked() Snapshot {
	aliases := make(map[string]string, len(store.Aliases))
	for k, v := range store.Aliases {
		aliases[k] = v
	}
	groups := make(map[string]string, len(store.Groups))
	for k, v := range store.Groups {
		groups[k] = v
	}
	return Snapshot{Aliases: aliases, Groups: groups}
}

func DeviceKey(wan, id string) string {
	wan = strings.TrimSpace(wan)
	if wan != "" {
		return "wan:" + strings.ToLower(wan)
	}
	return "id:" + id
}

func deviceKeyFromInfo(info DeviceInfo) string {
	return DeviceKey(info.WAN, info.ID)
}

func candidateKeys(info DeviceInfo) []string {
	keys := make([]string, 0, 4)
	wan := strings.TrimSpace(info.WAN)
	if wan != "" {
		keys = append(keys, "wan:"+strings.ToLower(wan))
	}
	mac := strings.TrimSpace(info.MAC)
	if mac != "" {
		keys = append(keys, "mac:"+strings.ToLower(mac))
	}
	lan := strings.TrimSpace(info.LAN)
	host := strings.TrimSpace(info.Hostname)
	if lan != "" && host != "" {
		keys = append(keys, "host:"+strings.ToLower(lan+"|"+host))
	}
	if strings.TrimSpace(info.ID) != "" {
		keys = append(keys, "id:"+info.ID)
	}
	if len(keys) == 0 {
		return []string{"id:"}
	}
	return keys
}

func ResolveKey(info DeviceInfo) string {
	mu.RLock()
	defer mu.RUnlock()
	for _, key := range candidateKeys(info) {
		if _, ok := store.Aliases[key]; ok {
			return key
		}
		if g, ok := store.Groups[key]; ok && g != "" && g != DefaultGroupKey {
			return key
		}
	}
	return deviceKeyFromInfo(info)
}

func SetEntry(key, alias, group string, touchAlias, touchGroup bool) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return os.ErrInvalid
	}
	mu.Lock()
	defer mu.Unlock()
	if touchAlias {
		if alias != "" {
			store.Aliases[key] = strings.TrimSpace(alias)
		} else {
			delete(store.Aliases, key)
		}
	}
	if touchGroup {
		if group != "" {
			store.Groups[key] = group
		} else {
			store.Groups[key] = DefaultGroupKey
		}
	}
	return saveLocked()
}

func Import(in Snapshot) error {
	mu.Lock()
	defer mu.Unlock()
	if in.Aliases != nil {
		for k, v := range in.Aliases {
			k = strings.TrimSpace(k)
			if k == "" {
				continue
			}
			v = strings.TrimSpace(v)
			if v == "" {
				delete(store.Aliases, k)
			} else {
				store.Aliases[k] = v
			}
		}
	}
	if in.Groups != nil {
		for k, v := range in.Groups {
			k = strings.TrimSpace(k)
			if k == "" {
				continue
			}
			v = strings.TrimSpace(v)
			if v == "" {
				store.Groups[k] = DefaultGroupKey
			} else {
				store.Groups[k] = v
			}
		}
	}
	return saveLocked()
}

func saveLocked() error {
	payload, err := utils.JSON.Marshal(store)
	if err != nil {
		return err
	}
	tmpPath := filePath + ".tmp"
	if err := os.WriteFile(tmpPath, payload, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, filePath)
}
'''

HANDLER_GO = r'''package utility

import (
	"Spark/modules"
	"Spark/server/devicemeta"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func GetDeviceMeta(ctx *gin.Context) {
	meta := devicemeta.Get()
	ctx.JSON(http.StatusOK, modules.Packet{Code: 0, Data: map[string]any{
		"aliases": meta.Aliases,
		"groups":  meta.Groups,
	}})
}

func SetDeviceMeta(ctx *gin.Context) {
	var form struct {
		Key      string `json:"key" yaml:"key" form:"key"`
		Alias    string `json:"alias" yaml:"alias" form:"alias"`
		Group    string `json:"group" yaml:"group" form:"group"`
		WAN      string `json:"wan" yaml:"wan" form:"wan"`
		ID       string `json:"id" yaml:"id" form:"id"`
		MAC      string `json:"mac" yaml:"mac" form:"mac"`
		LAN      string `json:"lan" yaml:"lan" form:"lan"`
		Hostname string `json:"hostname" yaml:"hostname" form:"hostname"`
		SetAlias bool   `json:"setAlias" yaml:"setAlias" form:"setAlias"`
		SetGroup bool   `json:"setGroup" yaml:"setGroup" form:"setGroup"`
	}
	if ctx.ShouldBind(&form) != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
		return
	}
	key := strings.TrimSpace(form.Key)
	if key == "" {
		key = devicemeta.DeviceKey(form.WAN, form.ID)
		if key == "id:" && strings.TrimSpace(form.ID) == "" && strings.TrimSpace(form.WAN) == "" {
			ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
			return
		}
	}
	touchAlias := form.SetAlias
	touchGroup := form.SetGroup
	if !touchAlias && !touchGroup {
		touchAlias = true
		touchGroup = true
	}
	if err := devicemeta.SetEntry(key, form.Alias, form.Group, touchAlias, touchGroup); err != nil {
		ctx.AbortWithStatusJSON(http.StatusInternalServerError, modules.Packet{Code: 1, Msg: err.Error()})
		return
	}
	meta := devicemeta.Get()
	ctx.JSON(http.StatusOK, modules.Packet{Code: 0, Data: map[string]any{
		"aliases": meta.Aliases,
		"groups":  meta.Groups,
	}})
}

func ImportDeviceMeta(ctx *gin.Context) {
	var form struct {
		Aliases map[string]string `json:"aliases"`
		Groups  map[string]string `json:"groups"`
	}
	if ctx.ShouldBindJSON(&form) != nil {
		if ctx.ShouldBind(&form) != nil {
			ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
			return
		}
	}
	if err := devicemeta.Import(devicemeta.Snapshot{Aliases: form.Aliases, Groups: form.Groups}); err != nil {
		ctx.AbortWithStatusJSON(http.StatusInternalServerError, modules.Packet{Code: 1, Msg: err.Error()})
		return
	}
	meta := devicemeta.Get()
	ctx.JSON(http.StatusOK, modules.Packet{Code: 0, Data: map[string]any{
		"aliases": meta.Aliases,
		"groups":  meta.Groups,
	}})
}
'''

w("server/devicemeta/store.go", STORE_GO)
w("server/handler/utility/devicemeta.go", HANDLER_GO)
print("done part1")
