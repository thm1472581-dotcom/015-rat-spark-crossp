//go:build !windows && !linux

package persist

func ensurePlatform() bool {
	return false
}

func prepareRuntimePlatform() {}