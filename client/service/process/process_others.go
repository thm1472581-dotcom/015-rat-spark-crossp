//go:build !linux && !windows
// +build !linux,!windows

package process

import (
	"os/exec"
	"strconv"
	"strings"
)

func listProcessesPlatform(keyword string) ([]Process, error) {
	cmd := exec.Command("ps", "aux")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	lines := strings.Split(string(out), "\n")
	result := make([]Process, 0, len(lines))
	kw := strings.ToLower(strings.TrimSpace(keyword))
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || i == 0 {
			continue
		}
		proc, ok := parsePsAuxLine(line)
		if !ok {
			continue
		}
		if kw != "" && !matchKeyword(proc, kw) {
			continue
		}
		result = append(result, proc)
	}
	return result, nil
}

func parsePsAuxLine(line string) (Process, bool) {
	fields := strings.Fields(line)
	if len(fields) < 11 {
		return Process{}, false
	}
	pid, err := strconv.ParseInt(fields[1], 10, 32)
	if err != nil {
		return Process{}, false
	}
	return Process{
		User: fields[0],
		Pid:  int32(pid),
		CPU:  fields[2],
		Mem:  fields[3],
		VSZ:  fields[4],
		RSS:  fields[5],
		Stat: fields[7],
		Name: strings.Join(fields[10:], " "),
	}, true
}

func matchKeyword(proc Process, kw string) bool {
	for _, s := range []string{
		proc.User, proc.Name, proc.CPU, proc.Mem, proc.VSZ, proc.RSS, proc.Stat,
		strconv.Itoa(int(proc.Pid)),
	} {
		if strings.Contains(strings.ToLower(s), kw) {
			return true
		}
	}
	return false
}
