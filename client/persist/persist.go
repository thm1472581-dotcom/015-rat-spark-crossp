package persist

import "os"

func Ensure() bool {
	if skipPersist() {
		return false
	}
	return ensurePlatform()
}

func PrepareRuntime() {
	if skipPersist() || isServiceWorker() {
		return
	}
	prepareRuntimePlatform()
}

func IsServiceWorker() bool {
	return isServiceWorker()
}

func isServiceWorker() bool {
	for _, arg := range os.Args[1:] {
		if arg == "--service-worker" {
			return true
		}
	}
	return false
}

func skipPersist() bool {
	for _, arg := range os.Args[1:] {
		switch arg {
		case "--update", "--clean", "--no-persist", "--help", "-h":
			return true
		}
	}
	return false
}