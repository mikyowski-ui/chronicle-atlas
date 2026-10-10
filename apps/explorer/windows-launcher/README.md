# Chronicle Teaching Atlas Windows launcher

Double-click `Chronicle-Teaching-Atlas-Windows-x64.exe`. It opens the bundled Explorer in your default browser and leaves a small launcher window open. **Quit** or closing that window stops only this application's local server. No Node installation, administrator access, installer, registry changes, or internet download is required to launch.

This unsigned Windows x64 executable contains the exact built web application. Windows execution, SmartScreen behavior and physical-GPU performance require testing on Windows and are not established by Linux cross-compilation.

The server listens only on `127.0.0.1:4173`; if occupied, the operating system assigns one free loopback port. The launcher does not scan ports or stop other processes. Payload files are validated against the embedded archive SHA-256 and per-file hashes, then cached under `%LOCALAPPDATA%\Chronicle Explorer`. Extraction is sequential, capped at 400 MiB and 20,000 entries. Archives/executables are capped at 128 MiB. Serving is read-only, supports PMTiles byte ranges, and disables directory listings. Closing a browser tab alone does not stop the server; use the launcher window.

## Rebuild

Use Go 1.26.1, with no third-party Go dependencies. Regenerate `payload.zip` and `payload.sha256` from the exact reviewed runnable distribution using `make-payload.py`, then run from this directory:

```sh
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 GOMAXPROCS=2 GOMEMLIMIT=1GiB go build -buildvcs=false -p 1 -trimpath -ldflags="-s -w -H=windowsgui" -o Chronicle-Teaching-Atlas-Windows-x64.exe .
```

`--verify-payload` validates the embedded archive and prints JSON without extracting or opening a network listener. `--extract-only` additionally validates/extracts the local cache, prints JSON, and exits without opening a listener. Validation output can be redirected to a file when invoking the GUI binary.

The existing historical/publication boundaries, data and application behavior are unchanged. The launcher does not publish or modify the public ledger.
