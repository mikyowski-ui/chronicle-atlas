//go:build windows

package main

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"
)

var (
	user32         = syscall.NewLazyDLL("user32.dll")
	kernel32       = syscall.NewLazyDLL("kernel32.dll")
	shell32        = syscall.NewLazyDLL("shell32.dll")
	gdi32          = syscall.NewLazyDLL("gdi32.dll")
	procMessageBox = user32.NewProc("MessageBoxW")
	procDefWindow  = user32.NewProc("DefWindowProcW")
	procDestroy    = user32.NewProc("DestroyWindow")
	procPostQuit   = user32.NewProc("PostQuitMessage")
	browserAddress string
)

func wide(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }
func showError(message string) {
	procMessageBox.Call(0, uintptr(unsafe.Pointer(wide(message))), uintptr(unsafe.Pointer(wide("Chronicle Explorer"))), 0x10)
}
func openBrowser() {
	code, _, _ := shell32.NewProc("ShellExecuteW").Call(0, uintptr(unsafe.Pointer(wide("open"))), uintptr(unsafe.Pointer(wide(browserAddress))), 0, 0, 1)
	if code <= 32 {
		showError("Could not open your default browser. Open this address manually:\n" + browserAddress)
	}
}

type windowClass struct {
	Size        uint32
	Style       uint32
	Procedure   uintptr
	ClassExtra  int32
	WindowExtra int32
	Instance    uintptr
	Icon        uintptr
	Cursor      uintptr
	Background  uintptr
	MenuName    *uint16
	ClassName   *uint16
	IconSmall   uintptr
}
type point struct{ X, Y int32 }
type message struct {
	Window  uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Point   point
	Private uint32
}

func windowProcedure(hwnd uintptr, msg uint32, wparam, lparam uintptr) uintptr {
	switch msg {
	case 0x0111: // WM_COMMAND
		switch wparam & 0xffff {
		case 1001:
			openBrowser()
			return 0
		case 1002:
			procDestroy.Call(hwnd)
			return 0
		}
	case 0x0010: // WM_CLOSE
		procDestroy.Call(hwnd)
		return 0
	case 0x0002: // WM_DESTROY
		procPostQuit.Call(0)
		return 0
	}
	result, _, _ := procDefWindow.Call(hwnd, uintptr(msg), wparam, lparam)
	return result
}

func platformRun(address string) error {
	// A Win32 window and its message loop must stay on the creating OS thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	browserAddress = address
	instance, _, _ := kernel32.NewProc("GetModuleHandleW").Call(0)
	cursor, _, _ := user32.NewProc("LoadCursorW").Call(0, 32512)
	className := wide("ChronicleExplorerLocalLauncher")
	callback := syscall.NewCallback(windowProcedure)
	class := windowClass{Size: uint32(unsafe.Sizeof(windowClass{})), Procedure: callback, Instance: instance, Cursor: cursor, Background: 16, ClassName: className}
	registered, _, err := user32.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&class)))
	if registered == 0 {
		return fmt.Errorf("register launcher window: %v", err)
	}
	create := user32.NewProc("CreateWindowExW")
	hwnd, _, err := create.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(wide("Chronicle Explorer · Teaching Atlas"))), 0x00CA0000, 0x80000000, 0x80000000, 520, 242, 0, 0, instance, 0)
	if hwnd == 0 {
		return fmt.Errorf("create launcher window: %v", err)
	}
	font, _, _ := gdi32.NewProc("GetStockObject").Call(17)
	child := func(kind, label string, style uintptr, x, y, width, height int, id uintptr) {
		control, _, _ := create.Call(0, uintptr(unsafe.Pointer(wide(kind))), uintptr(unsafe.Pointer(wide(label))), 0x50000000|style, uintptr(x), uintptr(y), uintptr(width), uintptr(height), hwnd, id, instance, 0)
		user32.NewProc("SendMessageW").Call(control, 0x0030, font, 1)
	}
	child("STATIC", "Chronicle Explorer is running on this computer.", 0, 22, 22, 470, 24, 0)
	child("STATIC", address, 0, 22, 54, 470, 24, 0)
	child("STATIC", "The map opens in your default browser.\nKeep this window open while exploring; Quit stops the local server.", 0, 22, 86, 465, 42, 0)
	child("BUTTON", "Open Explorer", 0x00010000, 22, 149, 156, 34, 1001)
	child("BUTTON", "Quit", 0x00010000, 340, 149, 140, 34, 1002)
	user32.NewProc("ShowWindow").Call(hwnd, 1)
	user32.NewProc("UpdateWindow").Call(hwnd)
	openBrowser()
	var msg message
	getMessage := user32.NewProc("GetMessageW")
	translate := user32.NewProc("TranslateMessage")
	dispatch := user32.NewProc("DispatchMessageW")
	dialogMessage := user32.NewProc("IsDialogMessageW")
	for {
		result, _, err := getMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) == -1 {
			procDestroy.Call(hwnd)
			return fmt.Errorf("launcher message loop: %v", err)
		}
		if result == 0 {
			break
		}
		consumed, _, _ := dialogMessage.Call(hwnd, uintptr(unsafe.Pointer(&msg)))
		if consumed == 0 {
			translate.Call(uintptr(unsafe.Pointer(&msg)))
			dispatch.Call(uintptr(unsafe.Pointer(&msg)))
		}
	}
	runtime.KeepAlive(className)
	runtime.KeepAlive(callback)
	return nil
}
