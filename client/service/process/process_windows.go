//go:build windows
// +build windows

package process

import (
	"bytes"
	"encoding/csv"
	"os/exec"
	"strconv"
	"strings"
)

func listProcessesPlatform(keyword string) ([]Process, error) {
	cmd := exec.Command("cmd", "/c", "tasklist", "/v", "/fo", "csv")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	reader := csv.NewReader(bytes.NewReader(out))
	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	result := make([]Process, 0, len(records))
	kw := strings.ToLower(strings.TrimSpace(keyword))
	for i, rec := range records {
		if i == 0 || len(rec) < 8 {
			continue
		}
		pid, err := strconv.ParseInt(rec[1], 10, 32)
		if err != nil {
			continue
		}
		proc := Process{
			Name:        rec[0],
			Pid:         int32(pid),
			Session:     rec[2],
			MemUsage:    rec[4],
			Status:      rec[5],
			User:        rec[6],
			CPUTime:     rec[7],
			WindowTitle: pickWindowTitle(rec),
		}
		if kw != "" && !matchKeyword(proc, kw) {
			continue
		}
		result = append(result, proc)
	}
	return result, nil
}

func pickWindowTitle(rec []string) string {
	if len(rec) > 8 {
		return rec[8]
	}
	return ""
}

func matchKeyword(proc Process, kw string) bool {
	for _, s := range []string{
		proc.Name, proc.User, proc.Session, proc.MemUsage, proc.Status,
		proc.CPUTime, proc.WindowTitle,
		strconv.Itoa(int(proc.Pid)),
	} {
		if strings.Contains(strings.ToLower(s), kw) {
			return true
		}
	}
	return false
}
