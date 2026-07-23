package process

import "os"

type Process struct {
	Pid         int32  `json:"pid"`
	Name        string `json:"name"`
	User        string `json:"user,omitempty"`
	CPU         string `json:"cpu,omitempty"`
	Mem         string `json:"mem,omitempty"`
	VSZ         string `json:"vsz,omitempty"`
	RSS         string `json:"rss,omitempty"`
	Stat        string `json:"stat,omitempty"`
	Session     string `json:"session,omitempty"`
	MemUsage    string `json:"memUsage,omitempty"`
	Status      string `json:"status,omitempty"`
	CPUTime     string `json:"cpuTime,omitempty"`
	WindowTitle string `json:"windowTitle,omitempty"`
}

func ListProcesses(keyword string) ([]Process, error) {
	return listProcessesPlatform(keyword)
}

func KillProcess(pid int32) error {
	proc, err := os.FindProcess(int(pid))
	if err != nil {
		return err
	}
	return proc.Kill()
}
