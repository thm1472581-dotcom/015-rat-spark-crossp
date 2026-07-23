package process

import (
	"Spark/modules"
	"Spark/server/common"
	"Spark/server/handler/utility"
	"Spark/utils"
	"Spark/utils/melody"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"time"
)

func processKeyword(ctx *gin.Context, bound string) string {
	kw := strings.TrimSpace(bound)
	if kw == "" {
		kw = strings.TrimSpace(ctx.DefaultPostForm("keyword", ""))
	}
	return kw
}

func processMatches(proc map[string]any, kw string) bool {
	if kw == "" {
		return true
	}
	for _, key := range []string{"name", "user", "pid", "cpu", "mem", "rss", "stat", "memUsage", "status", "windowTitle", "session", "cpuTime", "vsz"} {
		if strings.Contains(strings.ToLower(fmt.Sprint(proc[key])), kw) {
			return true
		}
	}
	return false
}

func filterProcessData(data map[string]any, keyword string) map[string]any {
	if data == nil {
		return data
	}
	kw := strings.ToLower(strings.TrimSpace(keyword))
	if kw == "" {
		return data
	}
	raw, ok := data[`processes`]
	if !ok || raw == nil {
		return data
	}
	list, ok := raw.([]any)
	if !ok {
		return data
	}
	filtered := make([]any, 0, len(list))
	for _, item := range list {
		proc, ok := item.(map[string]any)
		if !ok || !processMatches(proc, kw) {
			continue
		}
		filtered = append(filtered, item)
	}
	data[`processes`] = filtered
	return data
}

// ListDeviceProcesses will list processes on remote client
func ListDeviceProcesses(ctx *gin.Context) {
	var form struct {
		Keyword string `json:"keyword" yaml:"keyword" form:"keyword"`
	}
	connUUID, ok := utility.CheckForm(ctx, &form)
	if !ok {
		return
	}
	keyword := processKeyword(ctx, form.Keyword)
	trigger := utils.GetStrUUID()
	common.SendPackByUUID(modules.Packet{Act: `PROCESSES_LIST`, Event: trigger, Data: map[string]any{`keyword`: keyword}}, connUUID)
	ok = common.AddEventOnce(func(p modules.Packet, _ *melody.Session) {
		if p.Code != 0 {
			ctx.AbortWithStatusJSON(http.StatusInternalServerError, modules.Packet{Code: 1, Msg: p.Msg})
		} else {
			data := filterProcessData(p.Data, keyword)
			ctx.JSON(http.StatusOK, modules.Packet{Code: 0, Data: data})
		}
	}, connUUID, trigger, 15*time.Second)
	if !ok {
		ctx.AbortWithStatusJSON(http.StatusGatewayTimeout, modules.Packet{Code: 1, Msg: `${i18n|COMMON.RESPONSE_TIMEOUT}`})
	}
}

// KillDeviceProcess will try to get send a packet to
// client and let it kill the process specified.
func KillDeviceProcess(ctx *gin.Context) {
	var form struct {
		Pid int32 `json:"pid" yaml:"pid" form:"pid" binding:"required"`
	}
	target, ok := utility.CheckForm(ctx, &form)
	if !ok {
		return
	}
	trigger := utils.GetStrUUID()
	common.SendPackByUUID(modules.Packet{Act: `PROCESS_KILL`, Data: gin.H{`pid`: form.Pid}, Event: trigger}, target)
	ok = common.AddEventOnce(func(p modules.Packet, _ *melody.Session) {
		if p.Code != 0 {
			ctx.AbortWithStatusJSON(http.StatusInternalServerError, modules.Packet{Code: 1, Msg: p.Msg})
			common.Warn(ctx, `PROCESS_KILL`, `fail`, p.Msg, map[string]any{
				`pid`: form.Pid,
			})
		} else {
			ctx.JSON(http.StatusOK, modules.Packet{Code: 0})
			common.Info(ctx, `PROCESS_KILL`, `success`, ``, map[string]any{
				`pid`: form.Pid,
			})
		}
	}, target, trigger, 5*time.Second)
	if !ok {
		ctx.AbortWithStatusJSON(http.StatusGatewayTimeout, modules.Packet{Code: 1, Msg: `${i18n|COMMON.RESPONSE_TIMEOUT}`})
		common.Warn(ctx, `PROCESS_KILL`, `fail`, `timeout`, map[string]any{
			`pid`: form.Pid,
		})
	}
}
