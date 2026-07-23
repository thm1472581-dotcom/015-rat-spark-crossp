//go:build windows
// +build windows

package file

import (
	"context"
	"os/exec"
	"time"
)

func searchFilesPlatform(root, keyword string) ([]File, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
	defer cancel()
	pattern := "*" + keyword + "*"
	cmd := exec.CommandContext(ctx, "where", "/r", root, pattern)
	out, err := cmd.Output()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, err
		}
		if len(out) == 0 {
			return nil, err
		}
	}
	return parseSearchOutput(root, string(out)), nil
}