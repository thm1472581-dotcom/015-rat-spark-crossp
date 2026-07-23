//go:build linux
// +build linux

package process

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
)

func listProcessesPlatform(keyword string) ([]Process, error) {
	kw := strings.TrimSpace(keyword)
	result, err := listFromPs(kw)
	if err == nil {
		if kw != "" || len(result) > 0 {
			return result, nil
		}
	}
	fallback, fbErr := listFromProc(kw)
	if fbErr == nil && len(fallback) > 0 {
		return fallback, nil
	}
	if err != nil {
		return nil, err
	}
	return result, nil
}

func listFromPs(keyword string) ([]Process, error) {
	cmd := exec.Command("ps", "-eo", "user,pid,pcpu,pmem,vsz,rss,tty,stat,time,args", "--no-headers")
	cmd.Env = append(os.Environ(), "COLUMNS=8192")
	out, err := cmd.Output()
	if err != nil {
		cmd = exec.Command("ps", "auxww")
		out, err = cmd.Output()
		if err != nil {
			return nil, err
		}
		return parsePsAuxOutput(string(out), keyword), nil
	}
	return parsePsEoOutput(string(out), keyword), nil
}

func parsePsAuxOutput(out, keyword string) []Process {
	lines := strings.Split(out, "\n")
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
	return result
}

func parsePsEoOutput(out, keyword string) []Process {
	lines := strings.Split(out, "\n")
	result := make([]Process, 0, len(lines))
	kw := strings.ToLower(strings.TrimSpace(keyword))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		proc, ok := parsePsEoLine(line)
		if !ok {
			continue
		}
		if kw != "" && !matchKeyword(proc, kw) {
			continue
		}
		result = append(result, proc)
	}
	return result
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

func parsePsEoLine(line string) (Process, bool) {
	fields := strings.Fields(line)
	if len(fields) < 10 {
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
		Name: strings.Join(fields[9:], " "),
	}, true
}

func listFromProc(keyword string) ([]Process, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	result := make([]Process, 0, len(entries))
	kw := strings.ToLower(strings.TrimSpace(keyword))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid64, err := strconv.ParseInt(entry.Name(), 10, 32)
		if err != nil {
			continue
		}
		pid := int32(pid64)
		name := readProcName(entry.Name())
		proc := Process{Pid: pid, Name: name}
		if kw != "" && !matchKeyword(proc, kw) {
			continue
		}
		result = append(result, proc)
	}
	return result, nil
}

func readProcName(pid string) string {
	data, err := os.ReadFile("/proc/" + pid + "/comm")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
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