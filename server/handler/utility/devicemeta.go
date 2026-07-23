package utility

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
	info := devicemeta.DeviceInfo{
		WAN: form.WAN, ID: form.ID, MAC: form.MAC, LAN: form.LAN, Hostname: form.Hostname,
	}
	key := strings.TrimSpace(form.Key)
	if key == "" {
		key = devicemeta.ResolveKey(info)
	}
	if key == "" || key == "id:" {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
		return
	}
	touchAlias := form.SetAlias
	touchGroup := form.SetGroup
	if !touchAlias && !touchGroup {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, modules.Packet{Code: -1, Msg: `${i18n|COMMON.INVALID_PARAMETER}`})
		return
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
