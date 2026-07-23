package utility

import (
	"Spark/modules"
	"Spark/server/common"
	"Spark/server/config"
	"Spark/utils"
	"Spark/utils/melody"
	"bytes"
	"context"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"os"
	"strconv"
	"sort"
	"strings"
	"time"
)

type Sender func(pack modules.Packet, session *melody.Session) bool

// CheckForm checks if the form contains the required fields.
// Every request must contain connection UUID or device ID.
func CheckForm(ctx *gin.Context, form any) (string, bool) {
	var base struct {
		Conn   string `json:"uuid" yaml:"uuid" form:"uuid"`
		Device string `json:"device" yaml:"device" form:"device"`
	}
	if form != nil && ctx.ShouldBind(form) != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
		return ``, false
	}
	if ctx.ShouldBind(&base) != nil || (len(base.Conn) == 0 && len(base.Device) == 0) {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
		return ``, false
	}
	connUUID, ok := common.CheckDevice(base.Device, base.Conn)
	if !ok {
		ctx.AbortWithStatusJSON(http.StatusBadGateway, modules.Packet{Code: 1, Msg: `${i18n|COMMON.DEVICE_NOT_EXIST}`})
		return ``, false
	}
	ctx.Request = ctx.Request.WithContext(context.WithValue(ctx.Request.Context(), `ConnUUID`, connUUID))
	return connUUID, true
}

// OnDevicePack handles events about device info.
// Such as websocket handshake and update device info.
func OnDevicePack(data []byte, session *melody.Session) error {
	var pack struct {
		Code   int            `json:"code,omitempty"`
		Act    string         `json:"act,omitempty"`
		Msg    string         `json:"msg,omitempty"`
		Device modules.Device `json:"data"`
	}
	err := utils.JSON.Unmarshal(data, &pack)
	if err != nil {
		session.Close()
		return err
	}

	addr, ok := session.Get(`Address`)
	if ok {
		pack.Device.WAN = addr.(string)
	} else {
		pack.Device.WAN = `Unknown`
	}

	if pack.Act == `DEVICE_UP` {
		// Check if this device has already connected.
		// If so, then find the session and let client quit.
		// This will keep only one connection remained per device.
		exSession := ``
		common.Devices.IterCb(func(uuid string, device *modules.Device) bool {
			if device.ID == pack.Device.ID {
				exSession = uuid
				target, ok := common.Melody.GetSessionByUUID(uuid)
				if ok {
					common.SendPack(modules.Packet{Act: `OFFLINE`}, target)
					target.Close()
				}
				return false
			}
			return true
		})
		if len(exSession) > 0 {
			common.Devices.Remove(exSession)
			common.BumpDeviceRevision()
		}
		common.Devices.Set(session.UUID, &pack.Device)
		common.BumpDeviceRevision()
		common.Info(nil, `CLIENT_ONLINE`, ``, ``, map[string]any{
			`device`: map[string]any{
				`name`: pack.Device.Hostname,
				`ip`:   pack.Device.WAN,
			},
		})
	} else {
		device, ok := common.Devices.Get(session.UUID)
		if ok {
			device.CPU = pack.Device.CPU
			device.RAM = pack.Device.RAM
			device.Net = pack.Device.Net
			device.Disk = pack.Device.Disk
			device.Uptime = pack.Device.Uptime
		}
	}
	common.SendPack(modules.Packet{Code: 0}, session)
	return nil
}

// CheckUpdate will check if client need update and return latest client if so.
func CheckUpdate(ctx *gin.Context) {
	var form struct {
		OS     string `form:"os" binding:"required"`
		Arch   string `form:"arch" binding:"required"`
		Commit string `form:"commit" binding:"required"`
	}
	if err := ctx.ShouldBind(&form); err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
		return
	}
	if form.Commit == config.Commit {
		ctx.JSON(http.StatusOK, modules.Packet{Code: 0})
		common.Warn(ctx, `CLIENT_UPDATE`, `success`, `latest`, map[string]any{
			`client`: map[string]any{
				`os`:     form.OS,
				`arch`:   form.Arch,
				`commit`: form.Commit,
			},
			`server`: config.Commit,
		})
		return
	}
	tpl, err := os.Open(fmt.Sprintf(config.BuiltPath, form.OS, form.Arch))
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusNotFound, modules.Packet{Code: 1, Msg: `${i18n|GENERATOR.NO_PREBUILT_FOUND}`})
		common.Warn(ctx, `CLIENT_UPDATE`, `fail`, `no prebuild asset`, map[string]any{
			`client`: map[string]any{
				`os`:     form.OS,
				`arch`:   form.Arch,
				`commit`: form.Commit,
			},
			`server`: config.Commit,
		})
		return
	}
	defer tpl.Close()

	const MaxBodySize = 384 // This is size of client config buffer.
	if ctx.Request.ContentLength > MaxBodySize {
		ctx.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, modules.Packet{Code: 1})
		common.Warn(ctx, `CLIENT_UPDATE`, `fail`, `config too large`, map[string]any{
			`client`: map[string]any{
				`os`:     form.OS,
				`arch`:   form.Arch,
				`commit`: form.Commit,
			},
			`server`: config.Commit,
		})
		return
	}
	body, err := ctx.GetRawData()
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: 1})
		common.Warn(ctx, `CLIENT_UPDATE`, `fail`, `read config fail`, map[string]any{
			`client`: map[string]any{
				`os`:     form.OS,
				`arch`:   form.Arch,
				`commit`: form.Commit,
			},
			`server`: config.Commit,
		})
		return
	}
	session := common.CheckClientReq(ctx)
	if session == nil {
		ctx.AbortWithStatusJSON(http.StatusUnauthorized, modules.Packet{Code: 1})
		common.Warn(ctx, `CLIENT_UPDATE`, `fail`, `check config fail`, map[string]any{
			`client`: map[string]any{
				`os`:     form.OS,
				`arch`:   form.Arch,
				`commit`: form.Commit,
			},
			`server`: config.Commit,
		})
		return
	}

	common.Info(ctx, `CLIENT_UPDATE`, `success`, `updating`, map[string]any{
		`client`: map[string]any{
			`os`:     form.OS,
			`arch`:   form.Arch,
			`commit`: form.Commit,
		},
		`server`: config.Commit,
	})

	ctx.Header(`Spark-Commit`, config.Commit)
	ctx.Header(`Accept-Ranges`, `none`)
	ctx.Header(`Content-Transfer-Encoding`, `binary`)
	ctx.Header(`Content-Type`, `application/octet-stream`)
	if stat, err := tpl.Stat(); err == nil {
		ctx.Header(`Content-Length`, strconv.FormatInt(stat.Size(), 10))
	}
	cfgBuffer := bytes.Repeat([]byte{'\x19'}, 384)
	prevBuffer := make([]byte, 0)
	for {
		thisBuffer := make([]byte, 1024)
		n, err := tpl.Read(thisBuffer)
		thisBuffer = thisBuffer[:n]
		tempBuffer := append(prevBuffer, thisBuffer...)
		bufIndex := bytes.Index(tempBuffer, cfgBuffer)
		if bufIndex > -1 {
			tempBuffer = bytes.Replace(tempBuffer, cfgBuffer, body, -1)
		}
		ctx.Writer.Write(tempBuffer[:len(prevBuffer)])
		prevBuffer = tempBuffer[len(prevBuffer):]
		if err != nil {
			break
		}
	}
	if len(prevBuffer) > 0 {
		ctx.Writer.Write(prevBuffer)
		prevBuffer = []byte{}
	}
}

// ExecDeviceCmd execute command on device.
func ExecDeviceCmd(ctx *gin.Context) {
	var form struct {
		Cmd  string `json:"cmd" yaml:"cmd" form:"cmd" binding:"required"`
		Args string `json:"args" yaml:"args" form:"args"`
	}
	target, ok := CheckForm(ctx, &form)
	if !ok {
		return
	}
	if len(form.Cmd) == 0 {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
		return
	}
	trigger := utils.GetStrUUID()
	common.SendPackByUUID(modules.Packet{Act: `COMMAND_EXEC`, Data: gin.H{`cmd`: form.Cmd, `args`: form.Args}, Event: trigger}, target)
	ok = common.AddEventOnce(func(p modules.Packet, _ *melody.Session) {
		if p.Code != 0 {
			common.Warn(ctx, `EXEC_COMMAND`, `fail`, p.Msg, map[string]any{
				`cmd`:  form.Cmd,
				`args`: form.Args,
			})
			ctx.AbortWithStatusJSON(http.StatusInternalServerError, modules.Packet{Code: 1, Msg: p.Msg})
		} else {
			common.Info(ctx, `EXEC_COMMAND`, `success`, ``, map[string]any{
				`cmd`:  form.Cmd,
				`args`: form.Args,
			})
			ctx.JSON(http.StatusOK, modules.Packet{Code: 0})
		}
	}, target, trigger, 5*time.Second)
	if !ok {
		common.Warn(ctx, `EXEC_COMMAND`, `fail`, `timeout`, map[string]any{
			`cmd`:  form.Cmd,
			`args`: form.Args,
		})
		ctx.AbortWithStatusJSON(http.StatusGatewayTimeout, modules.Packet{Code: 1, Msg: `${i18n|COMMON.RESPONSE_TIMEOUT}`})
	}
}

func deviceFieldContains(device *modules.Device, kw string) bool {
	if kw == "" || device == nil {
		return true
	}
	fields := []string{
		device.Hostname,
		device.Username,
		device.OS,
		device.Arch,
		device.LAN,
		device.WAN,
		device.MAC,
		device.ID,
	}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), kw) {
			return true
		}
	}
	return false
}

func deviceMatchesFilters(device *modules.Device, keyword, hostname, wan string) bool {
	if device == nil {
		return false
	}
	if keyword != "" {
		if !deviceFieldContains(device, strings.ToLower(keyword)) {
			return false
		}
	}
	if hostname != "" {
		if !strings.Contains(strings.ToLower(device.Hostname), strings.ToLower(hostname)) {
			return false
		}
	}
	if wan != "" {
		if !strings.Contains(strings.ToLower(device.WAN), strings.ToLower(wan)) {
			return false
		}
	}
	return true
}

type deviceEntry struct {
	Conn   string
	Device modules.Device
}

func deviceWANKey(device *modules.Device) string {
	if device == nil {
		return ""
	}
	wan := strings.TrimSpace(device.WAN)
	if wan != "" {
		return "wan:" + strings.ToLower(wan)
	}
	mac := strings.TrimSpace(device.MAC)
	if mac != "" {
		return "mac:" + strings.ToLower(mac)
	}
	lan := strings.TrimSpace(device.LAN)
	host := strings.TrimSpace(device.Hostname)
	if lan != "" && host != "" {
		return "host:" + strings.ToLower(lan + "|" + host)
	}
	return "id:" + device.ID
}

func dedupeDevicesByWAN(entries []deviceEntry) []deviceEntry {
	if len(entries) == 0 {
		return entries
	}
	best := make(map[string]deviceEntry, len(entries))
	for _, entry := range entries {
		key := deviceWANKey(&entry.Device)
		if key == "" {
			continue
		}
		prev, ok := best[key]
		if !ok || entry.Device.Latency < prev.Device.Latency {
			best[key] = entry
			continue
		}
		if entry.Device.Latency == prev.Device.Latency && strings.Compare(entry.Device.ID, prev.Device.ID) > 0 {
			best[key] = entry
		}
	}
	result := make([]deviceEntry, 0, len(best))
	for _, entry := range best {
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool {
		return compareDevices(&result[i].Device, &result[j].Device) < 0
	})
	return result
}

func compareDevices(a, b *modules.Device) int {
	if v := strings.Compare(strings.ToLower(a.OS), strings.ToLower(b.OS)); v != 0 {
		return v
	}
	return strings.Compare(strings.ToLower(a.Hostname), strings.ToLower(b.Hostname))
}

func wsSessionStats() (total, registered int) {
	common.Melody.IterSessions(func(uuid string, _ *melody.Session) bool {
		total++
		if common.Devices.Has(uuid) {
			registered++
		}
		return true
	})
	return
}

func GetDeviceRevision(ctx *gin.Context) {
	sessions, registered := wsSessionStats()
	ctx.JSON(http.StatusOK, modules.Packet{Code: 0, Data: map[string]any{
		"revision":   common.DeviceRevision(),
		"count":      common.Devices.Count(),
		"sessions":   sessions,
		"registered": registered,
		"pending":    sessions - registered,
	}})
}

func GetDevices(ctx *gin.Context) {
	var form struct {
		Current  int    `json:"current" yaml:"current" form:"current"`
		PageSize int    `json:"pageSize" yaml:"pageSize" form:"pageSize"`
		Keyword  string `json:"keyword" yaml:"keyword" form:"keyword"`
		Hostname string `json:"hostname" yaml:"hostname" form:"hostname"`
		WAN      string `json:"wan" yaml:"wan" form:"wan"`
	}
	_ = ctx.ShouldBind(&form)
	if form.Current < 1 {
		if v, err := strconv.Atoi(strings.TrimSpace(ctx.DefaultPostForm("current", "1"))); err == nil && v > 0 {
			form.Current = v
		} else {
			form.Current = 1
		}
	}
	if form.PageSize == 0 {
		if v, err := strconv.Atoi(strings.TrimSpace(ctx.DefaultPostForm("pageSize", "0"))); err == nil {
			form.PageSize = v
		}
	}
	allDevices := form.PageSize == 0
	if !allDevices && form.PageSize < 1 {
		form.PageSize = 25
	}
	if !allDevices && form.PageSize > 200 {
		form.PageSize = 200
	}
	keyword := strings.TrimSpace(form.Keyword)
	if keyword == "" {
		keyword = strings.TrimSpace(ctx.DefaultPostForm("keyword", ""))
	}
	keyword = strings.ToLower(keyword)
	hostname := strings.TrimSpace(form.Hostname)
	if hostname == "" {
		hostname = strings.TrimSpace(ctx.DefaultPostForm("hostname", ""))
	}
	wan := strings.TrimSpace(form.WAN)
	if wan == "" {
		wan = strings.TrimSpace(ctx.DefaultPostForm("wan", ""))
	}

	entries := make([]deviceEntry, 0)
	common.Devices.IterCb(func(uuid string, device *modules.Device) bool {
		if !deviceMatchesFilters(device, keyword, hostname, wan) {
			return true
		}
		entries = append(entries, deviceEntry{Conn: uuid, Device: *device})
		return true
	})

	entries = dedupeDevicesByWAN(entries)

	total := len(entries)
	start := 0
	end := total
	if !allDevices {
		start = (form.Current - 1) * form.PageSize
		if start > total {
			start = total
		}
		end = start + form.PageSize
		if end > total {
			end = total
		}
	} else if total > 500 {
		end = 500
		total = 500
	}

	list := make([]map[string]any, 0, end-start)
	for _, entry := range entries[start:end] {
		list = append(list, map[string]any{
			"conn":     entry.Conn,
			"id":       entry.Device.ID,
			"hostname": entry.Device.Hostname,
			"username": entry.Device.Username,
			"os":       entry.Device.OS,
			"arch":     entry.Device.Arch,
			"lan":      entry.Device.LAN,
			"wan":      entry.Device.WAN,
			"mac":      entry.Device.MAC,
			"latency":  entry.Device.Latency,
			"uptime":   entry.Device.Uptime,
			"cpu":      entry.Device.CPU,
			"ram":      entry.Device.RAM,
			"disk":     entry.Device.Disk,
			"net":      entry.Device.Net,
		})
	}

	ctx.JSON(http.StatusOK, modules.Packet{Code: 0, Data: map[string]any{
		"list":     list,
		"total":    total,
		"revision": common.DeviceRevision(),
	}})
}

// CallDevice will call client with command from browser.
func CallDevice(ctx *gin.Context) {
	act := strings.ToUpper(ctx.Param(`act`))
	if len(act) == 0 {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
		return
	}
	{
		actions := []string{`LOCK`, `LOGOFF`, `HIBERNATE`, `SUSPEND`, `RESTART`, `SHUTDOWN`, `OFFLINE`}
		ok := false
		for _, v := range actions {
			if v == act {
				ok = true
				break
			}
		}
		if !ok {
			common.Warn(ctx, `CALL_DEVICE`, `fail`, `invalid act`, map[string]any{
				`act`: act,
			})
			ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
			return
		}
	}
	connUUID, ok := CheckForm(ctx, nil)
	if !ok {
		return
	}
	trigger := utils.GetStrUUID()
	common.SendPackByUUID(modules.Packet{Act: act, Event: trigger}, connUUID)
	ok = common.AddEventOnce(func(p modules.Packet, _ *melody.Session) {
		if p.Code != 0 {
			common.Warn(ctx, `CALL_DEVICE`, `fail`, p.Msg, map[string]any{
				`act`: act,
			})
			ctx.AbortWithStatusJSON(http.StatusInternalServerError, modules.Packet{Code: 1, Msg: p.Msg})
		} else {
			common.Info(ctx, `CALL_DEVICE`, `success`, ``, map[string]any{
				`act`: act,
			})
			ctx.JSON(http.StatusOK, modules.Packet{Code: 0})
		}
	}, connUUID, trigger, 5*time.Second)
	if !ok {
		//This means the client is offline.
		//So we take this as a success.
		common.Info(ctx, `CALL_DEVICE`, `success`, ``, map[string]any{
			`act`: act,
		})
		ctx.JSON(http.StatusOK, modules.Packet{Code: 0})
	}
}

func SimpleEncrypt(data []byte, session *melody.Session) []byte {
	temp, ok := session.Get(`Secret`)
	if !ok {
		return nil
	}
	secret := temp.([]byte)
	return utils.XOR(data, secret)
}

func SimpleDecrypt(data []byte, session *melody.Session) []byte {
	temp, ok := session.Get(`Secret`)
	if !ok {
		return nil
	}
	secret := temp.([]byte)
	return utils.XOR(data, secret)
}

func WSHealthCheck(container *melody.Melody, sender Sender) {
	const MaxIdleSeconds = 300
	ping := func(uuid string, s *melody.Session) {
		if !sender(modules.Packet{Act: `PING`}, s) {
			s.Close()
		}
	}
	for now := range time.NewTicker(60 * time.Second).C {
		timestamp := now.Unix()
		// stores sessions to be disconnected
		queue := make([]*melody.Session, 0)
		container.IterSessions(func(uuid string, s *melody.Session) bool {
			go ping(uuid, s)
			val, ok := s.Get(`LastPack`)
			if !ok {
				queue = append(queue, s)
				return true
			}
			lastPack, ok := val.(int64)
			if !ok {
				queue = append(queue, s)
				return true
			}
			if timestamp-lastPack > MaxIdleSeconds {
				queue = append(queue, s)
			}
			return true
		})
		for i := 0; i < len(queue); i++ {
			queue[i].Close()
		}
	}
}
