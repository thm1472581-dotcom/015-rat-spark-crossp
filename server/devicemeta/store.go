package devicemeta

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
		group = strings.TrimSpace(group)
		if group == "" || group == DefaultGroupKey {
			delete(store.Groups, key)
		} else {
			store.Groups[key] = group
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
			if v == "" || v == DefaultGroupKey {
				delete(store.Groups, k)
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
