//go:build !windows

package main

import (
	"fmt"
	"os"
)

func showError(message string) { fmt.Fprintln(os.Stderr, message) }
func platformRun(address string) error {
	return fmt.Errorf("desktop launcher requires Windows; validation commands work on this platform")
}
